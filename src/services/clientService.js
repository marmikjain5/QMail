import { getSupabase } from "../lib/supabase.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";

const DEFAULT_CLIENTS = [
  { code: "client1", display_name: "Alice", email_address: "alice@example.com" },
  { code: "client2", display_name: "Bob", email_address: "bob@example.com" }
];

const DEFAULT_CLIENTS_BY_CODE = new Map(DEFAULT_CLIENTS.map((client) => [client.code, client]));

export async function ensureDefaultClients() {
  const supabase = getSupabase();

  for (const client of DEFAULT_CLIENTS) {
    const { data: existing, error: fetchError } = await supabase
      .from("clients")
      .select("id")
      .eq("code", client.code)
      .maybeSingle();
    if (fetchError) throw mapSupabaseError(fetchError, "Failed to check default clients.");

    if (existing) {
      continue;
    }

    const { error } = await supabase.from("clients").insert(client);
    if (error) throw mapSupabaseError(error, "Failed to ensure default clients.");
  }
}

async function withConnectedEmails(clientRows) {
  if (!clientRows.length) {
    return clientRows;
  }

  const supabase = getSupabase();
  const clientIds = clientRows.map((row) => row.id);
  const { data: accounts, error } = await supabase
    .from("provider_accounts")
    .select("client_id, provider_account_email")
    .eq("provider", "gmail")
    .in("client_id", clientIds);
  if (error) throw mapSupabaseError(error, "Failed to load connected Gmail accounts.");

  const emailByClient = new Map();
  for (const account of accounts || []) {
    if (account.provider_account_email) {
      emailByClient.set(account.client_id, account.provider_account_email);
    }
  }

  return clientRows.map((row) => ({
    ...row,
    placeholder_email_address: DEFAULT_CLIENTS_BY_CODE.get(row.code)?.email_address || row.email_address,
    connected_email_address: emailByClient.get(row.id) || null,
    email_address: emailByClient.get(row.id) || DEFAULT_CLIENTS_BY_CODE.get(row.code)?.email_address || row.email_address,
    gmail_connected: emailByClient.has(row.id)
  }));
}

export async function listClients() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("clients").select("id, code, display_name, email_address").order("code");
  if (error) throw mapSupabaseError(error, "Failed to list clients.");
  return withConnectedEmails(data);
}

export async function getClientByCode(code) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("clients").select("id, code, display_name, email_address").eq("code", code).single();
  if (error) throw new AppError(`Unknown client code: ${code}`, 404);
  const hydrated = await withConnectedEmails([data]);
  return hydrated[0];
}

export async function getClientById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("clients").select("id, code, display_name, email_address").eq("id", id).single();
  if (error) throw new AppError(`Unknown client id: ${id}`, 404);
  const hydrated = await withConnectedEmails([data]);
  return hydrated[0];
}
