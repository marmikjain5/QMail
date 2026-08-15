import { encryptSecret, randomId, randomKeyBase64 } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";

export async function seedMockKeys() {
  const supabase = getSupabase();
  const alice = await getClientByCode("client1");
  const bob = await getClientByCode("client2");

  const { count, error: countError } = await supabase.from("kme_keys").select("id", { count: "exact", head: true });
  if (countError) throw mapSupabaseError(countError, "Failed to inspect key pool.");
  if ((count || 0) > 0) {
    return { seeded: false, reason: "Keys already exist" };
  }

  const rows = [];
  for (let index = 0; index < 100; index += 1) {
    const isOtp = index >= 80;
    const sizeBytes = isOtp ? 2048 : 32;
    const keyId = randomId("qkey");
    const pairId = randomId("pair");
    const keyMaterialBase64 = randomKeyBase64(sizeBytes);
    const encrypted = encryptSecret(keyMaterialBase64);

    for (const [owner, peer] of [[alice, bob], [bob, alice]]) {
      rows.push({
        key_id: keyId,
        pair_id: pairId,
        owner_client_id: owner.id,
        peer_client_id: peer.id,
        key_material_encrypted: encrypted,
        key_size_bytes: sizeBytes,
        algorithm_usage: isOtp ? "OTP" : "AES256_GCM",
        source_type: "MOCK_PRE_SHARED",
        status: "AVAILABLE"
      });
    }
  }

  const { error } = await supabase.from("kme_keys").insert(rows);
  if (error) throw mapSupabaseError(error, "Failed to seed mock keys.");
  return { seeded: true, pairs: 100, records: 200 };
}
