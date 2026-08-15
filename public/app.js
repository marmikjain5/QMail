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
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
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
  if (!allowedEmails.length) {
    setText("allowedEmails", "No allowed Gmail users found yet. Connect the two Gmail accounts first.");
    return;
  }
  setText("allowedEmails", allowedEmails.join("\n"));
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
  try {
    const result = await api("/api/v1/me/messages/decrypt", {
      method: "POST",
      body: JSON.stringify({ messageId })
    }, true);
    setText("decryptResult", formatDecryptedEmail(result));
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
  setText("kmeStatus", await api("/api/v1/qkm/status"));
  if (adminMode) {
    setText("gmailStatus", formatGmailStatus(await api("/api/v1/providers/gmail/status")));
  }
}

async function loadKeyPool() {
  setText("keyPool", await api("/api/v1/admin/key-pool"));
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
    setText("bootstrapStatus", result);
    await loadAllowedEmails();
    if (session) {
      await refreshAuthenticatedView();
    } else {
      await loadStatus().catch(() => {});
    }
  } catch (error) {
    setText("bootstrapStatus", error.message);
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
  setText("bootstrapStatus", "Logged out.");
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

document.getElementById("composeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/v1/me/messages/send", {
      method: "POST",
      body: JSON.stringify(payload)
    }, true);
    setText("composeResult", result);
    setText("decryptResult", "No email opened yet.");
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
