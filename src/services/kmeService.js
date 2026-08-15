import { decryptSecret } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";

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
    .select("algorithm_usage, status")
    .order("algorithm_usage");
  if (error) throw mapSupabaseError(error, "Failed to read KME status.");

  const summary = data.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
      acc.byAlgorithm[row.algorithm_usage] = (acc.byAlgorithm[row.algorithm_usage] || 0) + 1;
      return acc;
    },
    { total: 0, byStatus: {}, byAlgorithm: {} }
  );

  return summary;
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
  return data;
}
