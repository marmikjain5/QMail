import dotenv from "dotenv";

dotenv.config();

function requireValue(name, fallback = "") {
  return process.env[name] || fallback;
}

export const env = {
  PORT: Number(process.env.PORT || 3000),
  APP_BASE_URL: requireValue("APP_BASE_URL", "http://localhost:3000"),
  SUPABASE_URL: requireValue("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: requireValue("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_ANON_KEY: requireValue("SUPABASE_ANON_KEY"),
  APP_MASTER_KEY: requireValue("APP_MASTER_KEY"),
  GOOGLE_CLIENT_ID: requireValue("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: requireValue("GOOGLE_CLIENT_SECRET"),
  GOOGLE_OAUTH_REDIRECT_URI: requireValue(
    "GOOGLE_OAUTH_REDIRECT_URI",
    "http://localhost:3000/api/v1/providers/gmail/oauth/callback"
  )
};

export function assertCoreEnv() {
  const missing = [];
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_MASTER_KEY"]) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(env.APP_MASTER_KEY)) {
    throw new Error("APP_MASTER_KEY must be a 64-character hex string.");
  }
}
