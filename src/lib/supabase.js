import { createClient } from "@supabase/supabase-js";

import { assertCoreEnv, env } from "./env.js";

let client;

export function getSupabase() {
  if (!client) {
    assertCoreEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
  }
  return client;
}
