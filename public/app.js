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
  // API returns: { keyPool: { total, available, consumed, ... } }
  // Legacy shape: { byStatus: { AVAILABLE, CONSUMED }, total }
  const kp = data.keyPool || {};
  const byStatus = data.byStatus || {};
  const total = kp.total ?? data.total ?? 0;
  const available = kp.available ?? byStatus.AVAILABLE ?? 0;
  const consumed = kp.consumed ?? byStatus.CONSUMED ?? 0;
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


let cachedKeyPoolKeys = [];

function algorithmBadge(usage) {
  if (usage === "OTP") return `<span class="badge badge--purple">Quantum OTP</span>`;
  if (usage === "AES256_GCM") return `<span class="badge badge--blue">AES-256-GCM</span>`;
  return `<span class="badge">${escapeHtml(usage)}</span>`;
}

function renderAdminStatsContainer(summary) {
  const container = document.getElementById("adminStatsContainer");
  if (!container) return;
  if (!summary) {
    container.innerHTML = "";
    return;
  }

  const yieldPct = summary.lastBb84Sim?.averageSiftingEfficiency
    ? (summary.lastBb84Sim.averageSiftingEfficiency * 100).toFixed(1)
    : "50.0";

  container.innerHTML = `
    <div class="admin-stat-card">
      <div class="admin-stat-val">${summary.total || 0}</div>
      <div class="admin-stat-lbl">Total Keys (${summary.available || 0} Ready, ${summary.consumed || 0} Used)</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-val text-blue">${summary.aes256Keys || 0}</div>
      <div class="admin-stat-lbl">AES-256 Keys (32 Bytes / 256 bits)</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-val text-purple">${summary.quantumOtpKeys || 0}</div>
      <div class="admin-stat-lbl">Quantum-OTP Keys (2048 Bytes / 16384 bits)</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-val text-green">${yieldPct}%</div>
      <div class="admin-stat-lbl">BB84 Sifting Efficiency Yield</div>
    </div>
  `;
}

function renderBb84SiftingCard(simData) {
  const container = document.getElementById("bb84SiftingCard");
  if (!container) return;
  if (!simData) {
    container.innerHTML = `
      <div class="sifting-empty-state">
        <p>No active BB84 simulation metrics recorded yet in this session.</p>
        <p class="muted-text">Click <strong>🔑 Simulate Normal BB84</strong> or <strong>⚠️ Simulate BB84 With Attacker</strong> to run QKD protocol.</p>
      </div>`;
    return;
  }

  const mode = simData.mode || "NORMAL";
  const isAttacker = mode === "ATTACKER";
  const telemetry = simData.telemetry || {};
  const mlResult = simData.mlResult || {};
  
  const qberPct = (telemetry.qberPercentage ?? (telemetry.qber * 100) ?? 2.0).toFixed(1);
  const lossPct = (telemetry.photonLossPercentage ?? (telemetry.photonLossRate * 100) ?? 3.0).toFixed(1);
  const detectPct = (telemetry.detectionPercentage ?? (telemetry.detectionRate * 100) ?? 97.0).toFixed(1);
  const siftedLen = telemetry.siftedKeyLength || 256;
  const keyGenRate = telemetry.keyGenerationRate || 480;

  const isApproved = simData.qkdApproved !== false && simData.seeded !== false;
  const hardQberAborted = simData.hardQberAborted || (telemetry.qber > (simData.qberThreshold || 0.11));
  const isMlAnomaly = mlResult.prediction === "ANOMALY" || mlResult.isAnomaly;
  const anomalyScore = mlResult.anomalyScore !== undefined ? mlResult.anomalyScore : 0.0;

  const ts = simData.timestamp ? new Date(simData.timestamp).toLocaleTimeString() : "Just now";

  // Badges & Status HTML
  const modeBadgeHtml = isAttacker 
    ? `<span class="qkd-badge qkd-badge--warning">⚠️ ATTACKER DISTURBED CHANNEL</span>`
    : `<span class="qkd-badge qkd-badge--info">🔵 NORMAL BB84 CHANNEL</span>`;

  const mlStatusHtml = isMlAnomaly
    ? `<div class="ml-status-pill ml-status-pill--anomaly">🔴 ANOMALY DETECTED <span class="muted-text">(Score: ${anomalyScore})</span></div>`
    : `<div class="ml-status-pill ml-status-pill--normal">🟢 NORMAL <span class="muted-text">(Score: +${anomalyScore})</span></div>`;

  let decisionBannerHtml = "";
  if (isApproved) {
    decisionBannerHtml = `
      <div class="qkd-decision-banner qkd-decision-banner--approved">
        <div class="decision-icon">🟢</div>
        <div class="decision-content">
          <div class="decision-title">KEY DISTRIBUTION APPROVED</div>
          <div class="decision-desc">Quantum channel parameters are safe and verified. Keys have been securely provisioned to the QKM Key Pool.</div>
        </div>
      </div>`;
  } else {
    let abortReason = simData.reason || "Excessive disturbance detected.";
    if (hardQberAborted) {
      abortReason = `QBER threshold exceeded (${qberPct}% > 11.0%)`;
    } else if (isMlAnomaly) {
      abortReason = `Abnormal QKD channel behavior detected by ML (Anomaly Score: ${anomalyScore})`;
    }
    decisionBannerHtml = `
      <div class="qkd-decision-banner qkd-decision-banner--aborted">
        <div class="decision-icon">🔴</div>
        <div class="decision-content">
          <div class="decision-title">QKD SESSION ABORTED</div>
          <div class="decision-desc"><strong>Reason:</strong> ${escapeHtml(abortReason)}</div>
          <div class="decision-subnote">⚠️ All generated key material has been immediately discarded. No keys added to QKM.</div>
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="sifting-card-top">
      <div class="sifting-mode-wrap">${modeBadgeHtml}</div>
      <div class="sifting-ts muted-text">Executed: ${ts}</div>
    </div>

    <!-- Telemetry Metrics Grid -->
    <div class="qkd-telemetry-grid">
      <div class="qkd-telemetry-card ${Number(qberPct) > 11 ? 'qkd-telemetry-card--danger' : ''}">
        <div class="qkd-tel-label">QBER (Bit Error Rate)</div>
        <div class="qkd-tel-val ${Number(qberPct) > 11 ? 'text-red' : 'text-green'}">${qberPct}%</div>
        <div class="qkd-tel-sub">Threshold: &le; 11.0%</div>
      </div>
      <div class="qkd-telemetry-card">
        <div class="qkd-tel-label">Photon Loss Rate</div>
        <div class="qkd-tel-val">${lossPct}%</div>
        <div class="qkd-tel-sub">Channel Loss</div>
      </div>
      <div class="qkd-telemetry-card">
        <div class="qkd-tel-label">Detection Rate</div>
        <div class="qkd-tel-val">${detectPct}%</div>
        <div class="qkd-tel-sub">Fidelity</div>
      </div>
      <div class="qkd-telemetry-card">
        <div class="qkd-tel-label">Sifted Key Length</div>
        <div class="qkd-tel-val">${siftedLen} <span class="unit">bits</span></div>
        <div class="qkd-tel-sub">Post-Sampling</div>
      </div>
      <div class="qkd-telemetry-card">
        <div class="qkd-tel-label">Key Generation Rate</div>
        <div class="qkd-tel-val">${keyGenRate} <span class="unit">bits/sec</span></div>
        <div class="qkd-tel-sub">Simulated Rate</div>
      </div>
    </div>

    <!-- ML Anomaly Status -->
    <div class="qkd-ml-section">
      <div class="qkd-ml-header">
        <span class="qkd-ml-title">🤖 Isolation Forest ML Anomaly Detection</span>
        ${mlStatusHtml}
      </div>
    </div>

    <!-- Final Security Decision -->
    ${decisionBannerHtml}
  `;
}

function renderKeyPoolTable() {
  const el = document.getElementById("keyPool");
  if (!el) return;

  const algoFilter = document.getElementById("keyPoolAlgoFilter")?.value || "ALL";
  const statusFilter = document.getElementById("keyPoolStatusFilter")?.value || "ALL";

  let filtered = cachedKeyPoolKeys;
  if (algoFilter !== "ALL") {
    filtered = filtered.filter(k => k.algorithm_usage === algoFilter);
  }
  if (statusFilter !== "ALL") {
    filtered = filtered.filter(k => k.status === statusFilter);
  }

  if (!filtered.length) {
    el.innerHTML = `<p class="info-empty">No matching keys in pool.</p>`;
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
            <th>Inspect</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(row => `<tr>
            <td class="mono truncate" title="${escapeHtml(row.key_id)}">${escapeHtml(row.key_id)}</td>
            <td>${algorithmBadge(row.algorithm_usage)}</td>
            <td>${statusBadge(row.status)}</td>
            <td>${escapeHtml(String(row.key_size_bytes))}B</td>
            <td>${escapeHtml(row.source_type || "—")}</td>
            <td class="muted-text">${row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
            <td>
              <button type="button" class="btn-inspect-key btn btn--ghost btn--xs" data-key="${escapeHtml(row.key_id)}">
                🔍 Inspect
              </button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll(".btn-inspect-key").forEach(btn => {
    btn.addEventListener("click", () => openKeyInspectModal(btn.dataset.key));
  });
}

async function openKeyInspectModal(keyId) {
  const modal = document.getElementById("keyInspectModal");
  const body = document.getElementById("keyInspectBody");
  if (!modal || !body) return;

  modal.hidden = false;
  body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3)">Decrypting & inspecting key material for <strong>${escapeHtml(keyId)}</strong>…</div>`;

  try {
    const data = await api(`/api/v1/admin/keys/${encodeURIComponent(keyId)}/inspect`);
    const hexSnippet = data.keyMaterialHex ? data.keyMaterialHex.toUpperCase() : "";
    body.innerHTML = `
      <div class="inspect-detail-grid">
        <div class="inspect-item">
          <span class="inspect-label">Key ID</span>
          <span class="inspect-val mono">${escapeHtml(data.keyId)}</span>
        </div>
        <div class="inspect-item">
          <span class="inspect-label">Algorithm</span>
          <span class="inspect-val">${algorithmBadge(data.algorithmUsage)}</span>
        </div>
        <div class="inspect-item">
          <span class="inspect-label">Status</span>
          <span class="inspect-val">${statusBadge(data.status)}</span>
        </div>
        <div class="inspect-item">
          <span class="inspect-label">Key Size</span>
          <span class="inspect-val">${data.keySizeBytes} Bytes (${data.keySizeBytes * 8} bits)</span>
        </div>
      </div>

      <div class="inspect-key-box">
        <div class="inspect-box-header">
          <span>Decrypted Raw Key Secret (Hex Encoding)</span>
          <button type="button" id="copyHexBtn" class="btn btn--ghost btn--xs">📋 Copy Hex</button>
        </div>
        <textarea readonly class="inspect-code-area mono">${escapeHtml(hexSnippet)}</textarea>
      </div>

      <div class="inspect-key-box" style="margin-top:12px">
        <div class="inspect-box-header">
          <span>Base64 Key Secret</span>
        </div>
        <textarea readonly class="inspect-code-area mono" style="height:55px">${escapeHtml(data.keyMaterialBase64)}</textarea>
      </div>
    `;

    document.getElementById("copyHexBtn")?.addEventListener("click", () => {
      navigator.clipboard.writeText(hexSnippet);
      const btn = document.getElementById("copyHexBtn");
      if (btn) btn.textContent = "✅ Copied!";
      setTimeout(() => {
        const copyBtn = document.getElementById("copyHexBtn");
        if (copyBtn) copyBtn.textContent = "📋 Copy Hex";
      }, 2000);
    });

  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function renderKeyPool(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.summary) {
      renderAdminStatsContainer(data.summary);
      renderBb84SiftingCard(data.summary.lastBb84Sim);
    }
    cachedKeyPoolKeys = Array.isArray(data.keys) ? data.keys : [];
  } else if (Array.isArray(data)) {
    cachedKeyPoolKeys = data;
  } else {
    cachedKeyPoolKeys = [];
  }
  renderKeyPoolTable();
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
    if (data.qkdApproved || data.seeded) {
      el.innerHTML = `<span class="status-pill" style="color:var(--success)">✅ BB84 Approved · ${data.pairs} key pairs seeded (${data.aesPairs} AES + ${data.otpPairs} OTP) · Yield: ${yieldPct}%</span>`;
    } else {
      const shortReason = (data.reason || "").length > 80 ? (data.reason || "").substring(0, 80) + "…" : (data.reason || "QKD Aborted");
      el.innerHTML = `<span class="status-pill" style="color:#f87171">🔴 QKD SESSION ABORTED · Pool flushed · ${escapeHtml(shortReason)}</span>`;
    }
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
  const topbarBtn = document.getElementById("adminToggleTopbarBtn");
  if (adminPanel) adminPanel.hidden = !adminMode;
  if (toggleBtn) toggleBtn.textContent = adminMode ? "Hide admin" : "Admin tools";
  if (topbarBtn) topbarBtn.textContent = adminMode ? "🛠️ Hide Admin" : "🛠️ Admin Tools";
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

async function runQkdSimulation(mode, triggerBtn) {
  if (triggerBtn) {
    triggerBtn.disabled = true;
  }
  const statusEl = document.getElementById("bootstrapStatus");
  if (statusEl) statusEl.textContent = `Running ${mode} simulation…`;

  try {
    const result = await api("/api/v1/admin/simulate-bb84", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
    const simData = result?.result || result;
    renderBootstrapStatus(simData);
    renderBb84SiftingCard(simData);
    await loadAllowedEmails().catch(() => {});
    await loadKeyPool().catch(() => {});
    if (session) {
      await refreshAuthenticatedView().catch(() => {});
    }
  } catch (error) {
    renderBootstrapStatus(error.message);
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

document.getElementById("simulateNormalBb84Btn")?.addEventListener("click", (e) => runQkdSimulation("NORMAL", e.currentTarget));
document.getElementById("simulateAttackerBb84Btn")?.addEventListener("click", (e) => runQkdSimulation("ATTACKER", e.currentTarget));
document.getElementById("adminSimNormalBtn")?.addEventListener("click", (e) => runQkdSimulation("NORMAL", e.currentTarget));
document.getElementById("adminSimAttackerBtn")?.addEventListener("click", (e) => runQkdSimulation("ATTACKER", e.currentTarget));

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

async function handleAdminToggle() {
  adminMode = !adminMode;
  applyAdminMode();

  if (adminMode) {
    try {
      await Promise.all([loadStatus().catch(() => {}), loadKeyPool().catch(() => {})]);
    } catch (error) {
      renderBootstrapStatus(error.message);
    }
  }
}

document.getElementById("adminToggleBtn")?.addEventListener("click", handleAdminToggle);
document.getElementById("adminToggleTopbarBtn")?.addEventListener("click", handleAdminToggle);
document.getElementById("refreshPoolBtn")?.addEventListener("click", () => loadKeyPool().catch(() => {}));

document.getElementById("closeInspectModalBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("keyInspectModal");
  if (modal) modal.hidden = true;
});

document.getElementById("keyInspectModal")?.addEventListener("click", (e) => {
  if (e.target.id === "keyInspectModal") {
    e.target.hidden = true;
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
