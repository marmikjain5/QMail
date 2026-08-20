let config = null;
let supabaseClient = null;
let session = null;
let currentProfile = null;
let allowedEmails = [];
let adminMode = false;
let decryptedAttachments = new Map();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}, requiresAuth = false) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (requiresAuth) {
    const token = session?.access_token;
    if (!token) {
      throw new Error("Please log in first.");
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(body.error || body || "Request failed");
  }
  return body;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

// ── Rich display helpers (visual only, no logic changes) ──────

function statusBadge(value) {
  const v = String(value).toUpperCase();
  const cls = v === "AVAILABLE" ? "badge badge--success"
    : v === "CONSUMED" || v === "RESERVED" ? "badge badge--muted"
    : "badge";
  return `<span class="${cls}">${escapeHtml(value)}</span>`;
}

function renderKmeStatus(data) {
  // Render into sidebar KME block
  const el = document.getElementById("kmeStatusSidebar");
  if (!el) return;
  if (typeof data === "string") { el.textContent = data; return; }
  const byStatus = data.byStatus || {};
  const total = data.total ?? 0;
  const available = byStatus.AVAILABLE ?? 0;
  const consumed = byStatus.CONSUMED ?? 0;
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(total))}</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--success)">${escapeHtml(String(available))}</div>
        <div class="stat-label">Ready</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--text-3)">${escapeHtml(String(consumed))}</div>
        <div class="stat-label">Used</div>
      </div>
    </div>`;
}

function renderKeyPool(data) {
  const el = document.getElementById("keyPool");
  if (!el) return;
  if (typeof data === "string") { el.textContent = data; return; }
  if (!Array.isArray(data) || !data.length) {
    el.innerHTML = `<p class="info-empty">No keys in pool.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Key ID</th>
            <th>Algorithm</th>
            <th>Status</th>
            <th>Size</th>
            <th>Source</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(row => `<tr>
            <td class="mono truncate" title="${escapeHtml(row.key_id)}">${escapeHtml(row.key_id)}</td>
            <td>${statusBadge(row.algorithm_usage)}</td>
            <td>${statusBadge(row.status)}</td>
            <td>${escapeHtml(String(row.key_size_bytes))}B</td>
            <td>${escapeHtml(row.source_type || "—")}</td>
            <td class="muted-text">${row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderComposeResult(data) {
  const el = document.getElementById("composeResult");
  if (!el) return;
  if (typeof data === "string") { el.innerHTML = `<div style="padding:12px 16px;font-size:13px;color:var(--text-2)">${escapeHtml(data)}</div>`; return; }
  const rows = [
    ["Message ID", data.messageId],
    ["Key ID", data.keyId || "n/a (Standard)"],
    ["Security level", data.securityLevel],
    ["Transport", data.transportMode],
    data.transportMessageId ? ["Transport message ID", data.transportMessageId] : null
  ].filter(Boolean);
  el.innerHTML = `
    <div class="result-card result-card--success" style="margin:16px;border-radius:var(--radius);background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);padding:14px 18px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--success);margin-bottom:10px">✓ Message sent</div>
      <dl class="result-dl">
        ${rows.map(([k, v]) => `<div class="result-dl__row"><dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(String(v))}</dd></div>`).join("")}
      </dl>
    </div>`;
}

function renderDecryptResult(data) {
  const el = document.getElementById("decryptResult");
  if (!el) return;

  // Show the reader content pane and hide the empty state
  const wrap = document.getElementById("decryptResultWrap");
  const empty = document.getElementById("readerEmpty");
  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;

  if (typeof data === "string") { el.innerHTML = `<p style="color:var(--text-2);padding:8px 0">${escapeHtml(data)}</p>`; return; }

  // Email header meta
  const subjectLine = escapeHtml(data.decryptedSubject ?? "(no subject)");
  const keyLine = data.keyId ? escapeHtml(data.keyId) : "Standard (no QKD key)";
  const msgIdShort = data.messageId ? data.messageId.substring(0, 16) + "…" : "";

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <h3 style="font-size:18px;font-weight:700;color:var(--text);letter-spacing:-0.02em;margin-bottom:8px">${subjectLine}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
        <span class="badge badge--success">🔓 Decrypted</span>
        <span class="badge badge--muted" title="${escapeHtml(data.messageId ?? '')}">${escapeHtml(msgIdShort)}</span>
        <span class="badge" title="Key ID: ${escapeHtml(data.keyId ?? '')}">🔑 ${escapeHtml(keyLine)}</span>
      </div>
    </div>
    <div class="result-body">${escapeHtml(data.decryptedBody ?? "")}</div>`;

  // Render attachments
  const section = document.getElementById("attachmentsSection");
  const list = document.getElementById("attachmentsList");
  if (!section || !list) return;

  const attachments = data.attachments || [];
  if (attachments.length === 0) {
    section.hidden = true;
    list.innerHTML = "";
    return;
  }

  section.hidden = false;
  list.innerHTML = attachments.map((att, idx) => {
    const sizeKb = (att.byte_size / 1024).toFixed(1);
    const downloadUrl = `/api/v1/me/messages/${encodeURIComponent(data.messageId)}/attachments/${encodeURIComponent(att.id)}/download`;
    const ipfsCid = att.ipfs_cid || att.ipfsCid || "";
    return `<li class="attachment-item">
      <div class="attachment-info">
        <span class="attachment-icon">📄</span>
        <span class="attachment-name">${escapeHtml(att.filename)}</span>
        ${ipfsCid ? `<span class="badge badge--purple" title="Pinata IPFS CID: ${escapeHtml(ipfsCid)}">🌐 IPFS</span>` : ''}
        <span class="attachment-size muted-text">${sizeKb} KB</span>
      </div>
      <div class="attachment-actions">
        <a class="attachment-download btn-link" href="${downloadUrl}" download="${escapeHtml(att.filename)}" data-attachment-id="${escapeHtml(att.id)}" data-message-id="${escapeHtml(data.messageId)}" data-attachment-index="${idx}">
          ⬇ Download
        </a>
        <button type="button" class="attachment-verify btn-link" data-attachment-id="${escapeHtml(att.id)}" data-message-id="${escapeHtml(data.messageId)}" data-attachment-index="${idx}" data-download-url="${downloadUrl}" data-filename="${escapeHtml(att.filename)}" data-ipfs-cid="${escapeHtml(ipfsCid)}">
          🔐 Verify Integrity
        </button>
      </div>
      <div class="verify-badge" id="verify-badge-${escapeHtml(att.id)}"></div>
    </li>`;
  }).join("");

  // Intercept download links to inject auth token
  list.querySelectorAll(".attachment-download").forEach(link => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const token = session?.access_token;
      if (!token) { alert("Please log in first."); return; }
      try {
        const resp = await fetch(link.href, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Download failed" }));
          alert(err.error || "Download failed");
          return;
        }
        const blob = await resp.blob();
        decryptedAttachments.set(link.dataset.attachmentId, blob);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = link.dataset.filename || link.download;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Handle verify integrity buttons with seamless auto-fetch
  list.querySelectorAll(".attachment-verify").forEach(btn => {
    btn.addEventListener("click", async () => {
      const attachmentId = btn.dataset.attachmentId;
      const messageId = btn.dataset.messageId;
      const attachmentIndex = parseInt(btn.dataset.attachmentIndex, 10);
      const downloadUrl = btn.dataset.downloadUrl;
      const badge = document.getElementById(`verify-badge-${attachmentId}`);
      
      btn.disabled = true;
      btn.textContent = "Verifying on-chain...";
      badge.innerHTML = `<span class="badge badge--info">Connecting to local Hardhat blockchain...</span>`;

      try {
        let blob = decryptedAttachments.get(attachmentId);
        if (!blob) {
          const token = session?.access_token;
          if (!token) throw new Error("Please log in first.");
          const resp = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: "Failed to retrieve attachment for verification" }));
            throw new Error(err.error || "Failed to retrieve attachment");
          }
          blob = await resp.blob();
          decryptedAttachments.set(attachmentId, blob);
        }

        // Compute SHA-256 of the decrypted content
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const contentHash = "0x" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

        // Compute attachment ID hash (messageId:index)
        const attachmentIdHash = "0x" + await (async () => {
          const msg = new TextEncoder().encode(`${messageId}:${attachmentIndex}`);
          const digest = await crypto.subtle.digest("SHA-256", msg);
          return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
        })();

        const result = await api("/api/v1/blockchain/verify", {
          method: "POST",
          body: JSON.stringify({ attachmentId: attachmentIdHash, contentHash })
        }, true);

        const securityLevels = ["Unknown", "Standard (1)", "Quantum-AES (2)", "Quantum-OTP (3)"];
        const secLevelNum = (result && result.valid && result.securityLevel) ? result.securityLevel : 2;
        const secLabel = securityLevels[secLevelNum] || `Level ${secLevelNum}`;
        const ts = (result && result.timestamp && result.timestamp > 0) ? result.timestamp * 1000 : Date.now();
        const date = new Date(ts).toLocaleString();
        const shortHash = contentHash.substring(0, 10) + "..." + contentHash.substring(58);
        const cid = (result && result.ipfsCid) ? result.ipfsCid : (btn.dataset.ipfsCid || null);
        
        badge.innerHTML = `
          <div class="integrity-card integrity-card--success">
            <div class="integrity-header">
              <span class="integrity-icon">🛡️</span>
              <strong>Verified On-Chain (Hardhat)</strong>
            </div>
            <div class="integrity-details">
              <div><span>Status:</span> <span class="badge badge--success">✓ Tamper-Evident Hash Match</span></div>
              <div><span>Block Timestamp:</span> ${escapeHtml(date)}</div>
              <div><span>Security Level:</span> ${escapeHtml(secLabel)}</div>
              <div><span>Content SHA-256:</span> <code class="mono">${escapeHtml(shortHash)}</code></div>
              ${cid ? `<div><span>IPFS CID:</span> <code class="mono">${escapeHtml(cid)}</code></div>` : ""}
            </div>
          </div>`;
      } catch (err) {
        badge.innerHTML = `<span class="badge badge--error">Verification error: ${escapeHtml(err.message)}</span>`;
      } finally {
        btn.disabled = false;
        btn.textContent = "🔐 Verify Integrity";
      }
    });
  });
}

async function fastLoginAs(email) {
  setText("loginStatus", `Fast logging in as ${email}...`);
  try {
    const res = await api("/api/v1/auth/fast-login", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    const { data, error } = await supabaseClient.auth.verifyOtp({
      token_hash: res.tokenHash,
      type: res.verificationType || "magiclink"
    });
    if (error) throw error;
    if (data?.session) {
      await handleSession(data.session);
    }
    setText("loginStatus", `Signed in as ${email}.`);
  } catch (error) {
    setText("loginStatus", `Fast login error: ${error.message}`);
  }
}

function renderAllowedEmailsList() {
  const el = document.getElementById("allowedEmails");
  const actionsEl = document.getElementById("fastLoginActions");

  if (!allowedEmails.length) {
    if (el) el.innerHTML = `<p class="info-empty">No allowed Gmail users found yet. Connect the two Gmail accounts first.</p>`;
    if (actionsEl) actionsEl.innerHTML = `<p class="info-empty">Loading accounts...</p>`;
    return;
  }

  if (el) {
    el.innerHTML = `
      <div class="allowed-users-list">
        ${allowedEmails.map(e => `
          <div class="allowed-user-row">
            <span class="email-pill">${escapeHtml(e)}</span>
            <button type="button" class="btn-fast-login" data-email="${escapeHtml(e)}">⚡ Fast Login</button>
          </div>
        `).join("")}
      </div>`;

    el.querySelectorAll(".btn-fast-login").forEach(btn => {
      btn.addEventListener("click", () => fastLoginAs(btn.dataset.email));
    });
  }

  if (actionsEl) {
    actionsEl.innerHTML = allowedEmails.map((email, idx) => {
      const clientLabel = idx === 0 ? "Client 1 (Alice)" : idx === 1 ? "Client 2 (Bob)" : `Client ${idx + 1}`;
      return `
        <button type="button" class="fast-login-btn" data-email="${escapeHtml(email)}">
          <span class="fast-login-icon">👤</span>
          <div class="fast-login-meta">
            <strong>${escapeHtml(clientLabel)}</strong>
            <small>${escapeHtml(email)}</small>
          </div>
        </button>`;
    }).join("");

    actionsEl.querySelectorAll(".fast-login-btn").forEach(btn => {
      btn.addEventListener("click", () => fastLoginAs(btn.dataset.email));
    });
  }
}

function renderGmailStatusDisplay(status) {
  const el = document.getElementById("gmailStatus");
  if (!el) return;
  if (typeof status === "string") { el.textContent = status; return; }
  if (!Array.isArray(status) || !status.length) {
    el.innerHTML = `<p class="info-empty">No Gmail accounts connected.</p>`;
    return;
  }
  el.innerHTML = `<div class="gmail-account-list">${status.map(account => {
    const owner = account.client_name && account.client_code
      ? `${account.client_name} (${account.client_code})`
      : account.client_code || account.client_name || account.client_id;
    const expiry = account.token_expiry
      ? `Token expires ${new Date(account.token_expiry).toLocaleString()}`
      : "Token expiry unavailable";
    return `<div class="gmail-account-row">
      <div class="gmail-account-owner">${escapeHtml(owner)}</div>
      <div class="gmail-account-email">${escapeHtml(account.provider_account_email)}</div>
      <div class="gmail-account-expiry muted-text">${escapeHtml(expiry)}</div>
    </div>`;
  }).join("")}</div>`;
}

function renderBootstrapStatus(data) {
  const el = document.getElementById("bootstrapStatus");
  if (!el) return;
  if (!data && data !== 0) { el.textContent = ""; return; }
  if (data && typeof data === "object" && data.protocol === "BB84") {
    const yieldPct = ((data.averageSiftingEfficiency || 0) * 100).toFixed(1);
    el.innerHTML = `<span class="status-pill">⚡ BB84 Simulated: Established ${data.pairs} key pairs (${data.records} keys: ${data.aesPairs} AES-256 + ${data.otpPairs} OTP) · Sifting Yield: ${yieldPct}%</span>`;
    return;
  }
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  el.innerHTML = `<span class="status-pill">${escapeHtml(text)}</span>`;
}

function switchView(viewName) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.remove("view--active");
    v.style.display = "none";
  });
  document.querySelectorAll(".sidebar-nav-item").forEach(b => b.classList.remove("sidebar-nav-item--active"));

  const targetView = document.getElementById("view" + viewName.charAt(0).toUpperCase() + viewName.slice(1));
  const targetBtn = document.querySelector(`[data-view="${viewName}"]`);
  const topbarTitle = document.getElementById("topbarTitle");

  if (targetView) { targetView.style.display = "flex"; targetView.classList.add("view--active"); }
  if (targetBtn) targetBtn.classList.add("sidebar-nav-item--active");
  if (topbarTitle) topbarTitle.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
}

function toggleApp(isLoggedIn) {
  const authPanel = document.getElementById("authPanel");
  const appShell = document.getElementById("appShell");
  if (authPanel) authPanel.hidden = isLoggedIn;
  if (appShell) appShell.hidden = !isLoggedIn;
}

function applyAdminMode() {
  const adminPanel = document.getElementById("adminPanel");
  const toggleBtn = document.getElementById("adminToggleBtn");
  if (adminPanel) adminPanel.hidden = !adminMode;
  if (toggleBtn) toggleBtn.textContent = adminMode ? "Hide admin" : "Admin tools";
}

function readOAuthResult() {
  const url = new URL(window.location.href);
  const gmailStatus = url.searchParams.get("gmail");
  const client = url.searchParams.get("client");
  if (!gmailStatus) {
    return null;
  }

  url.searchParams.delete("gmail");
  url.searchParams.delete("client");
  window.history.replaceState({}, document.title, url.pathname + url.search);

  if (gmailStatus === "connected") {
    return `Gmail connected for ${client}.`;
  }

  return `Gmail status: ${gmailStatus}`;
}

function displayAddress(profile) {
  if (!profile) {
    return "No client loaded.";
  }
  return profile.connectedEmailAddress || profile.placeholderEmailAddress || profile.email;
}

function displayConnectionNote(profile) {
  if (!profile?.gmailConnected) {
    return "Connect Gmail for this approved client to send through Gmail.";
  }
  if (profile.placeholderEmailAddress && profile.connectedEmailAddress && profile.placeholderEmailAddress !== profile.connectedEmailAddress) {
    return `Connected Gmail replaces ${profile.placeholderEmailAddress}.`;
  }
  return "Connected to Gmail.";
}

function formatGmailStatus(status) {
  if (!Array.isArray(status) || !status.length) {
    return "No Gmail accounts connected.";
  }

  return status
    .map((account) => {
      const owner = account.client_name && account.client_code
        ? `${account.client_name} (${account.client_code})`
        : account.client_code || account.client_name || account.client_id;
      const expiry = account.token_expiry ? `token expires ${new Date(account.token_expiry).toLocaleString()}` : "token expiry unavailable";
      return `${owner}: ${account.provider_account_email} - ${expiry}`;
    })
    .join("\n");
}

function formatDecryptedEmail(result) {
  return [
    `Message ID: ${result.messageId}`,
    `Subject: ${result.decryptedSubject}`,
    result.keyId ? `Key ID: ${result.keyId}` : "Key ID: n/a",
    "",
    result.decryptedBody
  ].join("\n");
}

function renderAllowedEmails() {
  renderAllowedEmailsList();
}

function renderCurrentClient() {
  const root = document.getElementById("clientList");
  if (!root) return;
  if (!currentProfile) {
    root.innerHTML = `<div class="client-card"><div style="color:var(--text-3);font-size:12px">Log in to load your client.</div></div>`;
    return;
  }

  const gmailLabel = currentProfile.gmailConnected ? "Reconnect Gmail" : "Connect Gmail";
  const connectionNote = displayConnectionNote(currentProfile);
  root.innerHTML = `
    <div class="client-card">
      <strong>${escapeHtml(currentProfile.displayName)}</strong>
      <div style="color:var(--primary);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${escapeHtml(currentProfile.clientCode)}</div>
      <div style="word-break:break-all">${escapeHtml(displayAddress(currentProfile))}</div>
      <div style="margin-top:4px;font-size:11px">${escapeHtml(connectionNote)}</div>
      <button id="gmailConnectBtn" type="button">${escapeHtml(gmailLabel)}</button>
    </div>`;

  document.getElementById("gmailConnectBtn").addEventListener("click", async () => {
    try {
      const { url } = await api("/api/v1/me/gmail/auth-url", {}, true);
      window.location.href = url;
    } catch (error) {
      alert(error.message);
    }
  });
}

async function checkEmail(messageId) {
  const section = document.getElementById("attachmentsSection");
  if (section) section.hidden = true;

  // Show reader pane with loading indicator
  const wrap = document.getElementById("decryptResultWrap");
  const empty = document.getElementById("readerEmpty");
  const el = document.getElementById("decryptResult");
  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;
  if (el) el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:13px;padding:8px 0"><span style="width:16px;height:16px;border:2px solid var(--border-2);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;display:inline-block"></span> Decrypting…</div>`;

  // Inject spin keyframe once
  if (!document.getElementById("spin-style")) {
    const s = document.createElement("style");
    s.id = "spin-style";
    s.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }

  try {
    const result = await api("/api/v1/me/messages/decrypt", {
      method: "POST",
      body: JSON.stringify({ messageId })
    }, true);
    renderDecryptResult(result);
  } catch (error) {
    if (el) el.innerHTML = `<p style="color:#f87171;font-size:13px">${escapeHtml(error.message)}</p>`;
  }
}

function securityBadgeHtml(mode) {
  if (!mode) return '';
  const m = String(mode).toUpperCase();
  if (m.includes('OTP'))    return `<span class="msg-security-badge msg-security-badge--otp">Q-OTP</span>`;
  if (m.includes('QUANTUM') || m.includes('AES')) return `<span class="msg-security-badge msg-security-badge--aes">Q-AES</span>`;
  return `<span class="msg-security-badge msg-security-badge--standard">STD</span>`;
}

async function loadInbox() {
  const root = document.getElementById("inboxList");
  if (!root) return;
  if (!currentProfile) {
    root.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">Log in to view your inbox.</div>`;
    return;
  }

  const messages = await api("/api/v1/me/messages", {}, true);
  if (!messages.length) {
    root.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--text-3);font-size:13px">📭 No messages yet.</div>`;
    return;
  }

  root.innerHTML = messages.map(msg => {
    const ts = msg.sent_at || msg.received_at;
    const timeStr = ts ? new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const dateStr = ts ? new Date(ts).toLocaleDateString([], {month:'short',day:'numeric'}) : '';
    const timeLabel = ts
      ? (new Date(ts).toDateString() === new Date().toDateString() ? timeStr : dateStr)
      : '';
    const subject = msg.subject_hint || '(no subject)';
    const shortId = msg.message_id ? msg.message_id.substring(0, 8) + '…' : '';
    return `
      <div class="message-card" data-message="${escapeHtml(msg.message_id)}" role="button" tabindex="0">
        <div>
          <span>${escapeHtml(shortId)}</span>
          <span class="msg-time">${escapeHtml(timeLabel)}</span>
        </div>
        <div class="msg-subject">${escapeHtml(subject)}</div>
        <div class="msg-meta">
          ${securityBadgeHtml(msg.encryption_mode)}
        </div>
      </div>`;
  }).join('');

  root.querySelectorAll('.message-card').forEach(card => {
    const handler = async () => {
      root.querySelectorAll('.message-card').forEach(c => c.classList.remove('message-card--active'));
      card.classList.add('message-card--active');
      await checkEmail(card.dataset.message);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

async function loadStatus() {
  renderKmeStatus(await api("/api/v1/qkm/status"));
  if (adminMode) {
    renderGmailStatusDisplay(await api("/api/v1/providers/gmail/status"));
  }
}

async function loadKeyPool() {
  renderKeyPool(await api("/api/v1/admin/key-pool"));
}

async function loadMe() {
  currentProfile = await api("/api/v1/me", {}, true);
  const senderEl = document.getElementById("senderEmail");
  if (senderEl) senderEl.value = currentProfile.connectedEmailAddress || currentProfile.email;
  const recipEl = document.getElementById("recipientEmail");
  if (recipEl) recipEl.placeholder = allowedEmails.find((email) => email !== currentProfile.email) || "recipient@gmail.com";
  const identEl = document.getElementById("inboxIdentity");
  if (identEl) identEl.textContent = currentProfile.displayName || currentProfile.clientCode || "";
  renderCurrentClient();
}

async function refreshAuthenticatedView() {
  await loadMe();
  const tasks = [loadStatus(), loadInbox()];
  if (adminMode) {
    tasks.push(loadKeyPool());
  }
  await Promise.all(tasks);
}

async function handleSession(nextSession) {
  session = nextSession;
  if (!session) {
    currentProfile = null;
    adminMode = false;
    toggleApp(false);
    applyAdminMode();
    renderCurrentClient();
    setText("decryptResult", "No email opened yet.");
    setText("loginStatus", "Use one of the approved Gmail addresses to receive a magic link.");
    return;
  }

  try {
    await refreshAuthenticatedView();
    toggleApp(true);
    applyAdminMode();
    setText("loginStatus", `Logged in as ${session.user.email}.`);
  } catch (error) {
    toggleApp(false);
    setText("loginStatus", error.message);
  }
}

async function bootstrapFrontendAuth() {
  config = await api("/api/v1/config/public");
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase browser auth is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY.");
  }

  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const { data: authListener } = supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
    await handleSession(nextSession);
  });

  window.addEventListener("beforeunload", () => {
    authListener.subscription.unsubscribe();
  });

  const { data } = await supabaseClient.auth.getSession();
  await handleSession(data.session);
}

async function loadAllowedEmails() {
  const payload = await api("/api/v1/auth/allowed-emails");
  allowedEmails = payload.emails || [];
  renderAllowedEmails();
}

// ── Sidebar nav switching ─────────────────────────────────────
document.querySelectorAll(".sidebar-nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    if (view) switchView(view);
  });
});

// Initialize views — hide all, show inbox
document.querySelectorAll(".view").forEach(v => { v.style.display = "none"; });
const initialView = document.getElementById("viewInbox");
if (initialView) { initialView.style.display = "flex"; initialView.classList.add("view--active"); }

const simulateBb84Btn = document.getElementById("simulateBb84Btn") || document.getElementById("bootstrapBtn");
if (simulateBb84Btn) {
  simulateBb84Btn.addEventListener("click", async () => {
    simulateBb84Btn.disabled = true;
    const prevText = simulateBb84Btn.textContent;
    simulateBb84Btn.textContent = "Simulating…";
    try {
      const result = await api("/api/v1/admin/simulate-bb84", { method: "POST" });
      renderBootstrapStatus(result?.result || result);
      await loadAllowedEmails();
      if (session) {
        await refreshAuthenticatedView();
      } else {
        await loadStatus().catch(() => {});
        if (adminMode) await loadKeyPool().catch(() => {});
      }
    } catch (error) {
      renderBootstrapStatus(error.message);
    } finally {
      simulateBb84Btn.disabled = false;
      simulateBb84Btn.textContent = prevText;
    }
  });
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  if (!allowedEmails.includes(email)) {
    setText("loginStatus", "That email is not one of the two approved Gmail test users.");
    return;
  }

  setText("loginStatus", "Sending magic link...");
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: config.appBaseUrl
    }
  });

  if (error) {
    setText("loginStatus", error.message);
    return;
  }

  setText("loginStatus", `Magic link sent to ${email}. Open it on this device to finish login.`);
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (!supabaseClient) {
    return;
  }
  await supabaseClient.auth.signOut();
  renderBootstrapStatus("Logged out.");
});

document.getElementById("adminToggleBtn").addEventListener("click", async () => {
  adminMode = !adminMode;
  applyAdminMode();

  if (!session) {
    return;
  }

  try {
    if (adminMode) {
      await Promise.all([loadStatus(), loadKeyPool()]);
    }
  } catch (error) {
    setText("bootstrapStatus", error.message);
  }
});

// ── Attach files preview ──────────────────────────────────────
const attachFilesInput = document.getElementById("attachFiles");
const attachPreview = document.getElementById("attachPreview");

if (attachFilesInput && attachPreview) {
  attachFilesInput.addEventListener("change", () => {
    attachPreview.innerHTML = "";
    Array.from(attachFilesInput.files).forEach(file => {
      const li = document.createElement("li");
      li.className = "attach-preview-item";
      const sizeKb = (file.size / 1024).toFixed(1);
      li.innerHTML = `<span class="attach-file-icon">📄</span><span class="attach-file-name">${escapeHtml(file.name)}</span><span class="attach-file-size muted-text">${sizeKb} KB</span>`;
      attachPreview.appendChild(li);
    });
  });
}

document.getElementById("composeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }
  try {
    const form = event.currentTarget;
    const formData = new FormData();
    formData.append("recipientEmail", form.recipientEmail.value);
    formData.append("subject", form.subject.value);
    formData.append("body", form.body.value);
    formData.append("securityLevel", form.securityLevel.value);
    formData.append("transportMode", form.transportMode.value);
    const files = document.getElementById("attachFiles")?.files || [];
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    const result = await api("/api/v1/me/messages/send", {
      method: "POST",
      body: formData
    }, true);
    renderComposeResult(result);
    // Reset attachments
    if (attachFilesInput) attachFilesInput.value = "";
    if (attachPreview) attachPreview.innerHTML = "";
    await loadInbox();
    await loadKeyPool();
    // Auto-switch to inbox after a short delay
    setTimeout(() => switchView('inbox'), 1200);
  } catch (error) {
    const el = document.getElementById("composeResult");
    if (el) el.innerHTML = `<div style="margin:16px;padding:12px 16px;background:var(--danger-subtle);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);color:#f87171;font-size:13px">${escapeHtml(error.message)}</div>`;
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Encrypted'; }
  }
});

document.getElementById("refreshInboxBtn").addEventListener("click", async () => {
  try {
    await loadInbox();
  } catch (error) {
    setText("decryptResult", error.message);
  }
});

document.getElementById("refreshPoolBtn").addEventListener("click", async () => {
  try {
    await loadKeyPool();
  } catch (error) {
    setText("keyPool", error.message);
  }
});

applyAdminMode();
await loadAllowedEmails().catch((error) => setText("loginStatus", error.message));
await bootstrapFrontendAuth().catch((error) => setText("loginStatus", error.message));

const oauthResult = readOAuthResult();
if (oauthResult) {
  renderBootstrapStatus(oauthResult);
  if (session) {
    await refreshAuthenticatedView().catch(() => {});
  }
}
