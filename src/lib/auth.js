import { AppError } from "./errors.js";
import { getSupabase } from "./supabase.js";

function readBearerToken(req) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new AppError("Authentication required.", 401);
  }
  return header.slice("Bearer ".length).trim();
}

export async function getAuthenticatedUser(req) {
  const token = readBearerToken(req);
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new AppError("Your session is invalid or expired. Please log in again.", 401);
  }
  return data.user;
}
