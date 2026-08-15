async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(body.error || body || "Request failed");
  }
  return body;
}

let clients = [];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasClients() {
  return Array.isArray(clients) && clients.length > 0;
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

function setText(id, value) {
  document.getElementById(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function displayAddress(client) {
  const connected = client.connected_email_address || client.email_address;
  const placeholder = client.placeholder_email_address || client.email_address;
  if (client.gmail_connected) {
    return connected;
  }
  return `${placeholder} (not connected)`;
}

function displayConnectionNote(client) {
  if (!client.gmail_connected) {
    return "Uses demo placeholder until Gmail is connected.";
  }

  const placeholder = client.placeholder_email_address || client.email_address;
  const connected = client.connected_email_address || client.email_address;
  if (placeholder && connected && placeholder !== connected) {
    return `Connected Gmail replaces ${placeholder}.`;
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

function fillClientSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) {
    return;
  }
  select.innerHTML = clients
    .map((client) => `<option value="${escapeHtml(client.code)}">${escapeHtml(client.display_name)} - ${escapeHtml(displayAddress(client))}</option>`)
    .join("");
}

function formatDecryptedEmail(result) {
  return [
    `Message ID: ${result.messageId}`,
    `Subject: ${result.decryptedSubject}`,
    "",
    result.decryptedBody
  ].join("\n");
}

async function checkEmail(messageId, viewerClientCode) {
  setText("decryptResult", "Decrypting email...");
  try {
    const result = await api("/api/v1/qumail/messages/decrypt", {
      method: "POST",
      body: JSON.stringify({ messageId, viewerClientCode })
    });
    setText("decryptResult", formatDecryptedEmail(result));
  } catch (error) {
    setText("decryptResult", error.message);
  }
}

function renderClientCards() {
  const root = document.getElementById("clientList");
  root.innerHTML = clients
    .map(
      (client) => `
        <div class="client-card">
          <strong>${escapeHtml(client.display_name)}</strong>
          <div>${escapeHtml(client.code)}</div>
          <div>${escapeHtml(displayAddress(client))}</div>
          <div>${escapeHtml(displayConnectionNote(client))}</div>
          <button data-client="${escapeHtml(client.code)}" class="gmail-connect">${client.gmail_connected ? "Reconnect Gmail" : "Connect Gmail"}</button>
        </div>`
    )
    .join("");

  document.querySelectorAll(".gmail-connect").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const { url } = await api(`/api/v1/providers/gmail/auth-url/${button.dataset.client}`);
        window.location.href = url;
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function loadClients() {
  clients = await api("/api/v1/clients");
  ["senderClientCode", "recipientClientCode", "inboxClientCode"].forEach(fillClientSelect);
  renderClientCards();
}

async function loadStatus() {
  setText("kmeStatus", await api("/api/v1/qkm/status"));
  try {
    setText("gmailStatus", formatGmailStatus(await api("/api/v1/providers/gmail/status")));
  } catch (error) {
    setText("gmailStatus", error.message);
  }
}

async function loadInbox() {
  if (!hasClients()) {
    document.getElementById("inboxList").innerHTML = "<div class='message-card'>Bootstrap the app after the database schema is ready.</div>";
    return;
  }
  const clientCode = document.getElementById("inboxClientCode").value;
  const messages = await api(`/api/v1/qumail/messages/${clientCode}`);
  const root = document.getElementById("inboxList");
  if (!messages.length) {
    root.innerHTML = "<div class='message-card'>No messages yet.</div>";
    return;
  }
  root.innerHTML = messages
    .map(
      (message) => `
        <div class="message-card">
          <div><strong>${message.message_id}</strong></div>
          <div>${message.subject_hint}</div>
          <div>${message.encryption_mode}</div>
          <div>Key: ${message.key_id || "n/a"}</div>
          <button data-message="${message.message_id}" class="check-email">Check email</button>
        </div>`
    )
    .join("");
  document.querySelectorAll(".check-email").forEach((button) => {
    button.addEventListener("click", async () => {
      await checkEmail(button.dataset.message, clientCode);
    });
  });
}

async function loadKeyPool() {
  setText("keyPool", await api("/api/v1/admin/key-pool"));
}

document.getElementById("bootstrapBtn").addEventListener("click", async () => {
  try {
    const result = await api("/api/v1/admin/bootstrap", { method: "POST" });
    setText("bootstrapStatus", result);
    await Promise.all([loadClients(), loadStatus(), loadKeyPool()]);
  } catch (error) {
    setText("bootstrapStatus", error.message);
  }
});

document.getElementById("composeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  try {
    const result = await api("/api/v1/qumail/messages/send", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setText("composeResult", result);
    await Promise.all([loadStatus(), loadInbox(), loadKeyPool()]);
  } catch (error) {
    setText("composeResult", error.message);
  }
});

document.getElementById("refreshInboxBtn").addEventListener("click", loadInbox);
document.getElementById("inboxClientCode").addEventListener("change", async () => {
  setText("decryptResult", "No email opened yet.");
  await loadInbox();
});
document.getElementById("refreshPoolBtn").addEventListener("click", loadKeyPool);

await loadClients().catch((error) => setText("bootstrapStatus", error.message));
await loadStatus().catch((error) => setText("kmeStatus", error.message));
if (hasClients()) {
  await loadInbox().catch(() => {});
}
await loadKeyPool().catch((error) => setText("keyPool", error.message));

const oauthResult = readOAuthResult();
if (oauthResult) {
  setText("bootstrapStatus", oauthResult);
  await loadClients().catch(() => {});
  await loadStatus().catch(() => {});
}
