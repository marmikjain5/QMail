import { decryptSecret } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";
import { getLastBb84SimMetrics } from "./keySeederService.js";

async function logKeyEvent({ keyId, eventType, actorType, actorId, messageId = null, details = {} }) {
  const supabase = getSupabase();
  await supabase.from("key_usage_events").insert({
    key_id: keyId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    message_id: messageId,
    details_json: details
  });
}

export async function getKmeStatus() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kme_keys")
    .select("status, algorithm_usage");

  if (error) throw mapSupabaseError(error, "Failed to load KME status.");

  const total = data.length;
  const available = data.filter((row) => row.status === "AVAILABLE").length;
  const reserved = data.filter((row) => row.status === "RESERVED").length;
  const consumed = data.filter((row) => row.status === "CONSUMED").length;
  const aesCount = data.filter((row) => row.algorithm_usage === "AES256_GCM").length;
  const otpCount = data.filter((row) => row.algorithm_usage === "OTP").length;

  return {
    service: "QuMail-KME",
    status: available > 0 ? "HEALTHY" : "DEGRADED",
    keyPool: {
      total,
      available,
      reserved,
      consumed,
      aes256Keys: aesCount,
      quantumOtpKeys: otpCount
    },
    lastBb84Sim: getLastBb84SimMetrics()
  };
}

export async function reserveKey({ sourceClientCode, targetClientCode, mode, requestedBytes, purpose }) {
  if (mode === "STANDARD") {
    return { mode, keyId: null, keyMaterialBase64: null, keySizeBytes: 0, purpose };
  }

  const supabase = getSupabase();
  const source = await getClientByCode(sourceClientCode);
  const target = await getClientByCode(targetClientCode);
  const algorithm = mode === "QUANTUM_OTP" ? "OTP" : "AES256_GCM";
  const minimumBytes = mode === "QUANTUM_OTP" ? requestedBytes || 1 : 32;

  const { data, error } = await supabase
    .from("kme_keys")
    .select("id, key_id, key_material_encrypted, key_size_bytes, owner_client_id, peer_client_id, status")
    .eq("owner_client_id", source.id)
    .eq("peer_client_id", target.id)
    .eq("algorithm_usage", algorithm)
    .eq("status", "AVAILABLE")
    .gte("key_size_bytes", minimumBytes)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw mapSupabaseError(error, "Failed to reserve key.");
  if (!data.length) {
    throw new AppError(`No ${algorithm} keys available for ${sourceClientCode} -> ${targetClientCode}.`, 409);
  }

  const key = data[0];
  const { error: updateError } = await supabase
    .from("kme_keys")
    .update({ status: "RESERVED" })
    .eq("id", key.id)
    .eq("status", "AVAILABLE");

  if (updateError) throw mapSupabaseError(updateError, "Failed to update key reservation state.");

  await logKeyEvent({
    keyId: key.key_id,
    eventType: "RESERVED",
    actorType: "APPLICATION",
    actorId: source.code,
    details: { targetClientCode, mode, purpose }
  });

  return {
    mode,
    keyId: key.key_id,
    keyMaterialBase64: decryptSecret(key.key_material_encrypted),
    keySizeBytes: key.key_size_bytes,
    purpose
  };
}

export async function consumeKey({ keyId, ownerClientCode, messageId, consumedBytes = null }) {
  const supabase = getSupabase();
  const owner = await getClientByCode(ownerClientCode);
  const { error } = await supabase
    .from("kme_keys")
    .update({ status: "CONSUMED", used_at: new Date().toISOString() })
    .eq("key_id", keyId)
    .eq("owner_client_id", owner.id)
    .in("status", ["AVAILABLE", "RESERVED"]);
  if (error) throw mapSupabaseError(error, "Failed to consume key.");

  await logKeyEvent({
    keyId,
    eventType: "CONSUMED",
    actorType: "APPLICATION",
    actorId: owner.code,
    messageId,
    details: { consumedBytes }
  });
}

export async function retrievePeerKey({ ownerClientCode, keyId }) {
  const supabase = getSupabase();
  const owner = await getClientByCode(ownerClientCode);
  const { data, error } = await supabase
    .from("kme_keys")
    .select("key_id, key_material_encrypted, key_size_bytes, algorithm_usage, status")
    .eq("owner_client_id", owner.id)
    .eq("key_id", keyId)
    .single();
  if (error) throw new AppError(`Key ${keyId} not available for ${ownerClientCode}.`, 404);

  await logKeyEvent({
    keyId,
    eventType: "RETRIEVED",
    actorType: "APPLICATION",
    actorId: owner.code
  });

  return {
    keyId: data.key_id,
    keyMaterialBase64: decryptSecret(data.key_material_encrypted),
    keySizeBytes: data.key_size_bytes,
    algorithmUsage: data.algorithm_usage,
    status: data.status
  };
}

export async function listKeyPool() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kme_keys")
    .select("key_id, pair_id, algorithm_usage, source_type, status, key_size_bytes, created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw mapSupabaseError(error, "Failed to load key pool.");

  const total = data.length;
  const available = data.filter((k) => k.status === "AVAILABLE").length;
  const reserved = data.filter((k) => k.status === "RESERVED").length;
  const consumed = data.filter((k) => k.status === "CONSUMED").length;
  const aes256Keys = data.filter((k) => k.algorithm_usage === "AES256_GCM").length;
  const quantumOtpKeys = data.filter((k) => k.algorithm_usage === "OTP").length;

  return {
    summary: {
      total,
      available,
      reserved,
      consumed,
      aes256Keys,
      quantumOtpKeys,
      lastBb84Sim: getLastBb84SimMetrics()
    },
    keys: data
  };
}

export async function inspectKeyMaterial(keyId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kme_keys")
    .select("key_id, key_material_encrypted, key_size_bytes, algorithm_usage, status, created_at")
    .eq("key_id", keyId)
    .limit(1)
    .single();

  if (error || !data) throw new AppError(`Key ${keyId} not found.`, 404);

  const rawBase64 = decryptSecret(data.key_material_encrypted);
  const rawBuf = Buffer.from(rawBase64, "base64");

  return {
    keyId: data.key_id,
    algorithmUsage: data.algorithm_usage,
    keySizeBytes: data.key_size_bytes,
    status: data.status,
    createdAt: data.created_at,
    keyMaterialBase64: rawBase64,
    keyMaterialHex: rawBuf.toString("hex")
  };
}

