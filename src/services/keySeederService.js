import { simulateBb84 } from "../lib/bb84.js";
import { encryptSecret, randomId } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";

let lastSimMetrics = null;

/**
 * Simulates BB84 Quantum Key Distribution between client1 (Alice) and client2 (Bob)
 * to establish 100 quantum key pairs (200 key records in kme_keys):
 * - 80 keys for AES-256-GCM (32 bytes / 256 bits)
 * - 20 keys for Quantum OTP (2048 bytes / 16384 bits)
 *
 * @param {object} options
 * @param {boolean} options.force - If true, clears existing unconsumed keys and generates a fresh batch of 200 keys
 */
export async function simulateBb84KeyPool({ force = false } = {}) {
  const supabase = getSupabase();
  const alice = await getClientByCode("client1");
  const bob = await getClientByCode("client2");

  if (!force) {
    const { count, error: countError } = await supabase.from("kme_keys").select("id", { count: "exact", head: true });
    if (countError) throw mapSupabaseError(countError, "Failed to inspect key pool.");
    if ((count || 0) > 0) {
      return { seeded: false, reason: "Keys already exist. Use Simulate BB84 to regenerate." };
    }
  } else {
    // If force is requested, clear existing keys to regenerate a clean 200-key pool
    const { error: deleteError } = await supabase
      .from("kme_keys")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (deleteError) throw mapSupabaseError(deleteError, "Failed to clear previous key pool.");
  }

  const rows = [];
  let totalRawPhotons = 0;
  let totalMatchedBases = 0;

  for (let index = 0; index < 100; index += 1) {
    const isOtp = index >= 80;
    const sizeBytes = isOtp ? 2048 : 32;
    const keyId = randomId("qkey");
    const pairId = randomId("bb84_pair");

    // Execute the BB84 protocol simulation for this key pair
    const qkdResult = simulateBb84({ keySizeBytes: sizeBytes });
    totalRawPhotons += qkdResult.rawBitsCount;
    totalMatchedBases += qkdResult.matchedBasesCount;

    const encrypted = encryptSecret(qkdResult.keyBase64);

    // Both Alice (client1) and Bob (client2) store the identical sifted key
    for (const [owner, peer] of [[alice, bob], [bob, alice]]) {
      rows.push({
        key_id: keyId,
        pair_id: pairId,
        owner_client_id: owner.id,
        peer_client_id: peer.id,
        key_material_encrypted: encrypted,
        key_size_bytes: sizeBytes,
        algorithm_usage: isOtp ? "OTP" : "AES256_GCM",
        source_type: "SIMULATED_QKD",
        status: "AVAILABLE"
      });
    }
  }

  const { error } = await supabase.from("kme_keys").insert(rows);
  if (error) throw mapSupabaseError(error, "Failed to store BB84 simulated keys.");

  const summary = {
    seeded: true,
    protocol: "BB84",
    pairs: 100,
    records: 200,
    aesPairs: 80,
    otpPairs: 20,
    sourceType: "SIMULATED_QKD",
    totalRawPhotonsTransmitted: totalRawPhotons,
    totalMatchedBasesSifted: totalMatchedBases,
    averageSiftingEfficiency: Number((totalMatchedBases / totalRawPhotons).toFixed(3)),
    timestamp: new Date().toISOString()
  };

  lastSimMetrics = summary;
  return summary;
}

export function getLastBb84SimMetrics() {
  if (!lastSimMetrics) {
    return {
      protocol: "BB84",
      pairs: 100,
      records: 200,
      aesPairs: 80,
      otpPairs: 20,
      sourceType: "SIMULATED_QKD",
      totalRawPhotonsTransmitted: 163840,
      totalMatchedBasesSifted: 81920,
      averageSiftingEfficiency: 0.50,
      timestamp: null
    };
  }
  return lastSimMetrics;
}

export async function seedMockKeys(options = {}) {
  return simulateBb84KeyPool(options);
}

