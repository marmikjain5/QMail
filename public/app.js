let config = null;
let supabaseClient = null;
let session = null;
let currentProfile = null;
let allowedEmails = [];
let adminMode = false;

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
  const el = document.getElementById("kmeStatus");
  if (!el) return;
  if (typeof data === "string") { el.textContent = data; return; }
  const byStatus = data.byStatus || {};
  const byAlgo = data.byAlgorithm || {};
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(data.total ?? 0))}</div>
        <div class="stat-label">Total keys</div>
      </div>
      ${Object.entries(byStatus).map(([k, v]) => `
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(v))}</div>
        <div class="stat-label">${escapeHtml(k)}</div>
      </div>`).join("")}
      ${Object.entries(byAlgo).map(([k, v]) => `
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(v))}</div>
        <div class="stat-label">${escapeHtml(k)}</div>
      </div>`).join("")}
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
  if (typeof data === "string") { el.textContent = data; return; }
  const rows = [
    ["Message ID", data.messageId],
    ["Key ID", data.keyId || "n/a (Standard)"],
    ["Security level", data.securityLevel],
    ["Transport", data.transportMode],
    data.transportMessageId ? ["Transport message ID", data.transportMessageId] : null
  ].filter(Boolean);
  el.innerHTML = `
    <div class="result-card result-card--success">
      <div class="result-card__title">Message sent</div>
      <dl class="result-dl">
        ${rows.map(([k, v]) => `<div class="result-dl__row"><dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(String(v))}</dd></div>`).join("")}
      </dl>
    </div>`;
}

function renderDecryptResult(data) {
  const el = document.getElementById("decryptResult");
  if (!el) return;
  if (typeof data === "string") { el.textContent = data; return; }
  const rows = [
    ["Message ID", data.messageId],
    ["Key ID", data.keyId || "n/a"],
    ["Subject", data.decryptedSubject]
  ];
  el.innerHTML = `
    <div class="result-card">
      <div class="result-card__title">Decrypted message</div>
      <dl class="result-dl">
        ${rows.map(([k, v]) => `<div class="result-dl__row"><dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(String(v ?? ""))}</dd></div>`).join("")}
      </dl>
      <div class="result-body">${escapeHtml(data.decryptedBody ?? "")}</div>
    </div>`;

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
  list.innerHTML = attachments.map(att => {
    const sizeKb = (att.byte_size / 1024).toFixed(1);
    const downloadUrl = `/api/v1/me/messages/${encodeURIComponent(data.messageId)}/attachments/${encodeURIComponent(att.id)}/download`;
    return `<li class="attachment-item">
      <span class="attachment-icon">📄</span>
      <span class="attachment-name">${escapeHtml(att.filename)}</span>
      <span class="attachment-size muted-text">${sizeKb} KB</span>
      <a class="attachment-download btn-link" href="${downloadUrl}" download="${escapeHtml(att.filename)}" data-attachment-id="${escapeHtml(att.id)}" data-message-id="${escapeHtml(data.messageId)}">
        ⬇ Download (decrypted)
      </a>
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
}

function renderAllowedEmailsList() {
  const el = document.getElementById("allowedEmails");
  if (!el) return;
  if (!allowedEmails.length) {
    el.innerHTML = `<p class="info-empty">No allowed Gmail users found yet. Connect the two Gmail accounts first.</p>`;
    return;
  }
  el.innerHTML = `<div class="email-pill-list">${allowedEmails.map(e => `<span class="email-pill">${escapeHtml(e)}</span>`).join("")}</div>`;
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
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  el.innerHTML = `<span class="status-pill">${escapeHtml(text)}</span>`;
}

function toggleApp(isLoggedIn) {
  document.getElementById("authPanel").hidden = isLoggedIn;
  document.getElementById("appShell").hidden = !isLoggedIn;
  document.getElementById("logoutBtn").hidden = !isLoggedIn;
  document.getElementById("adminToggleBtn").hidden = !isLoggedIn;
}

function applyAdminMode() {
  document.getElementById("adminPanel").hidden = !adminMode;
  document.getElementById("adminToggleBtn").textContent = adminMode ? "Hide admin tools" : "Show admin tools";
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
  if (!currentProfile) {
    root.innerHTML = "<div class='client-card'>Log in to load your QuMail client.</div>";
    return;
  }

  root.innerHTML = `
    <div class="client-card">
      <strong>${escapeHtml(currentProfile.displayName)}</strong>
      <div>${escapeHtml(currentProfile.clientCode)}</div>
      <div>${escapeHtml(displayAddress(currentProfile))}</div>
      <div>${escapeHtml(displayConnectionNote(currentProfile))}</div>
      <button id="gmailConnectBtn" type="button">${currentProfile.gmailConnected ? "Reconnect Gmail" : "Connect Gmail"}</button>
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
  setText("decryptResult", "Decrypting email...");
  const section = document.getElementById("attachmentsSection");
  if (section) section.hidden = true;
  try {
    const result = await api("/api/v1/me/messages/decrypt", {
      method: "POST",
      body: JSON.stringify({ messageId })
    }, true);
    renderDecryptResult(result);
  } catch (error) {
    setText("decryptResult", error.message);
  }
}

async function loadInbox() {
  const root = document.getElementById("inboxList");
  if (!currentProfile) {
    root.innerHTML = "<div class='message-card'>Log in to view your inbox.</div>";
    return;
  }

  const messages = await api("/api/v1/me/messages", {}, true);
  if (!messages.length) {
    root.innerHTML = "<div class='message-card'>No messages yet.</div>";
    return;
  }

  root.innerHTML = messages
    .map(
      (message) => `
        <div class="message-card">
          <div><strong>${escapeHtml(message.message_id)}</strong></div>
          <div>${escapeHtml(message.subject_hint)}</div>
          <div>${escapeHtml(message.encryption_mode)}</div>
          <div>${escapeHtml(message.sent_at || message.received_at || "Pending timestamp")}</div>
          <button data-message="${escapeHtml(message.message_id)}" class="check-email" type="button">Check email</button>
        </div>`
    )
    .join("");

  document.querySelectorAll(".check-email").forEach((button) => {
    button.addEventListener("click", async () => {
      await checkEmail(button.dataset.message);
    });
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
  document.getElementById("senderEmail").value = currentProfile.connectedEmailAddress || currentProfile.email;
  document.getElementById("recipientEmail").placeholder = allowedEmails.find((email) => email !== currentProfile.email) || "recipient@gmail.com";
  document.getElementById("inboxIdentity").value = `${currentProfile.displayName} (${currentProfile.clientCode})`;
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

document.getElementById("bootstrapBtn").addEventListener("click", async () => {
  try {
    const result = await api("/api/v1/admin/bootstrap", { method: "POST" });
    renderBootstrapStatus(result?.result || result);
    await loadAllowedEmails();
    if (session) {
      await refreshAuthenticatedView();
    } else {
      await loadStatus().catch(() => {});
    }
  } catch (error) {
    renderBootstrapStatus(error.message);
  }
});

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
  try {
    const form = event.currentTarget;
    const formData = new FormData();
    // Append text fields
    formData.append("recipientEmail", form.recipientEmail.value);
    formData.append("subject", form.subject.value);
    formData.append("body", form.body.value);
    formData.append("securityLevel", form.securityLevel.value);
    formData.append("transportMode", form.transportMode.value);
    // Append files
    const files = document.getElementById("attachFiles")?.files || [];
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    const result = await api("/api/v1/me/messages/send", {
      method: "POST",
      body: formData
    }, true);
    renderComposeResult(result);
    setText("decryptResult", "No email opened yet.");
    // Reset attachments
    if (attachFilesInput) attachFilesInput.value = "";
    if (attachPreview) attachPreview.innerHTML = "";
    await loadInbox();
    await loadKeyPool();
  } catch (error) {
    setText("composeResult", error.message);
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
await loadAllowedEmails().catch((error) => setText("allowedEmails", error.message));
await bootstrapFrontendAuth().catch((error) => setText("loginStatus", error.message));

const oauthResult = readOAuthResult();
if (oauthResult) {
  setText("bootstrapStatus", oauthResult);
  if (session) {
    await refreshAuthenticatedView().catch(() => {});
  }
}
