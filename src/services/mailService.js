import { google } from "googleapis";

import { env } from "../lib/env.js";
import { encryptSecret, decryptSecret, randomId } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly"
];

function oauthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError("Gmail OAuth is not configured.", 500);
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

export function getGmailAuthUrl(clientCode) {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state: clientCode,
    prompt: "consent"
  });
}

export async function storeGmailTokens({ clientCode, code }) {
  const oauth = oauthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const emailAddress = profile.data.emailAddress;
  const client = await getClientByCode(clientCode);
  const supabase = getSupabase();

  const row = {
    client_id: client.id,
    provider: "gmail",
    provider_account_email: emailAddress,
    oauth_access_token_encrypted: tokens.access_token ? encryptSecret(tokens.access_token) : null,
    oauth_refresh_token_encrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scopes: SCOPES
  };

  const { error } = await supabase.from("provider_accounts").upsert(row, { onConflict: "client_id,provider" });
  if (error) throw mapSupabaseError(error, "Failed to store Gmail tokens.");
}

async function getProviderAccount(clientCode) {
  const client = await getClientByCode(clientCode);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("provider_accounts")
    .select("*")
    .eq("client_id", client.id)
    .eq("provider", "gmail")
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Failed to read Gmail connection status.");
  return data;
}

async function getAuthorizedGmailAccount(clientCode) {
  const account = await getProviderAccount(clientCode);
  if (!account) {
    throw new AppError(`No Gmail account connected for ${clientCode}.`, 409);
  }
  if (!account.provider_account_email) {
    throw new AppError(`Connected Gmail account for ${clientCode} is missing an email address. Reconnect Gmail and try again.`, 409);
  }
  const oauth = oauthClient();
  oauth.setCredentials({
    access_token: account.oauth_access_token_encrypted ? decryptSecret(account.oauth_access_token_encrypted) : undefined,
    refresh_token: account.oauth_refresh_token_encrypted ? decryptSecret(account.oauth_refresh_token_encrypted) : undefined
  });
  return {
    account,
    gmail: google.gmail({ version: "v1", auth: oauth })
  };
}

function toRawEmail({ from, to, subject, body }) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendViaGmail({ senderClientCode, recipientEmail, subject, body }) {
  const { account, gmail } = await getAuthorizedGmailAccount(senderClientCode);
  const raw = toRawEmail({ from: account.provider_account_email, to: recipientEmail, subject, body });
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });
  return response.data.id || randomId("gmail");
}

export async function getGmailConnectionStatus() {
  const supabase = getSupabase();
  const { data: accounts, error } = await supabase
    .from("provider_accounts")
    .select("provider, provider_account_email, token_expiry, client_id");
  if (error) throw new AppError(error.message, 500);

  const clientIds = [...new Set((accounts || []).map((account) => account.client_id).filter(Boolean))];
  if (!clientIds.length) {
    return [];
  }

  const { data: clients, error: clientError } = await supabase
    .from("clients")
    .select("id, code, display_name")
    .in("id", clientIds);
  if (clientError) throw mapSupabaseError(clientError, "Failed to load Gmail connection owners.");

  const clientById = new Map((clients || []).map((client) => [client.id, client]));

  return (accounts || []).map((account) => ({
    ...account,
    client_code: clientById.get(account.client_id)?.code || null,
    client_name: clientById.get(account.client_id)?.display_name || null
  }));
}
