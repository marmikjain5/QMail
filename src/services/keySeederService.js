import { simulateBb84Channel } from "../lib/qkdChannelSimulator.js";
import { encryptSecret, randomId } from "../lib/crypto.js";
import { mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode } from "./clientService.js";
import { predictQkdAnomaly } from "./qkdMlService.js";

let lastSimMetrics = null;

/**
 * Simulates BB84 Quantum Key Distribution between client1 (Alice) and client2 (Bob).
 * Incorporates QBER Calculation, Hard QBER Threshold Check, and ML Anomaly Detection.
 *
 * Decision Engine:
 * 1. Calculate QBER & Telemetry from quantum channel simulation.
 * 2. Check Hard QBER Threshold (qber > 0.11 -> Abort).
 * 3. Run IsolationForest ML Anomaly Detection on Telemetry.
 * 4. IF approved -> seed 100 key pairs (200 records in kme_keys).
 *    IF aborted -> DISCARD all generated key material, DO NOT insert into database.
 *
 * @param {object} options
 * @param {boolean} options.force - Clear old keys if approved
 * @param {'NORMAL'|'ATTACKER'} options.mode - Simulation channel mode
 * @param {number} options.qberThreshold - Hard QBER threshold (default 0.11 / 11%)
 */
export async function simulateBb84KeyPool({ force = false, mode = "NORMAL", qberThreshold = 0.11 } = {}) {
  const supabase = getSupabase();
  const alice = await getClientByCode("client1");
  const bob = await getClientByCode("client2");

  const rows = [];
  let totalRawPhotons = 0;
  let totalMatchedBases = 0;
  let totalQberAcc = 0;
  let totalLossAcc = 0;
  let totalDetectionAcc = 0;
  let totalKeyGenRateAcc = 0;
  let representativeTelemetry = null;

  // Run the 100 BB84 channel sessions (80 AES-256-GCM, 20 OTP)
  for (let index = 0; index < 100; index += 1) {
    const isOtp = index >= 80;
    const sizeBytes = isOtp ? 2048 : 32;
    const keyId = randomId("qkey");
    const pairId = randomId("bb84_pair");

    // Execute quantum channel simulation for this key pair
    const qkdResult = simulateBb84Channel({ keySizeBytes: sizeBytes, mode });
    const tel = qkdResult.telemetry;

    totalRawPhotons += qkdResult.rawBitsCount;
    totalMatchedBases += qkdResult.matchedBasesCount;
    totalQberAcc += tel.qber;
    totalLossAcc += tel.photonLossRate;
    totalDetectionAcc += tel.detectionRate;
    totalKeyGenRateAcc += tel.keyGenerationRate;

    if (index === 0) {
      representativeTelemetry = tel;
    }

    const encrypted = encryptSecret(qkdResult.keyBase64);

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

  // Aggregate overall Telemetry object
  const avgQber = Number((totalQberAcc / 100).toFixed(4));
  const avgLoss = Number((totalLossAcc / 100).toFixed(4));
  const avgDetection = Number((totalDetectionAcc / 100).toFixed(4));
  const avgKeyGenRate = Number((totalKeyGenRateAcc / 100).toFixed(1));

  const telemetry = {
    qber: avgQber,
    qberPercentage: Number((avgQber * 100).toFixed(2)),
    photonLossRate: avgLoss,
    photonLossPercentage: Number((avgLoss * 100).toFixed(2)),
    detectionRate: avgDetection,
    detectionPercentage: Number((avgDetection * 100).toFixed(2)),
    siftedKeyLength: representativeTelemetry ? representativeTelemetry.siftedKeyLength : 256,
    keyGenerationRate: avgKeyGenRate,
    rawBitsCount: totalRawPhotons,
    matchedBasesCount: totalMatchedBases,
    mode
  };

  // 1. Hard QBER Threshold Check
  const hardQberAborted = avgQber > qberThreshold;

  // 2. ML Anomaly Detection (Isolation Forest)
  const mlResult = await predictQkdAnomaly(telemetry);

  // 3. Security Decision Logic
  let qkdApproved = false;
  let status = "ABORTED";
  let reason = "";

  if (hardQberAborted) {
    qkdApproved = false;
    status = "ABORTED";
    reason = `QBER threshold exceeded (${telemetry.qberPercentage}% > ${(qberThreshold * 100).toFixed(1)}%)`;
  } else if (mlResult.prediction === "ANOMALY" || mlResult.isAnomaly) {
    qkdApproved = false;
    status = "ABORTED";
    reason = `Abnormal QKD channel behavior detected by ML (Anomaly Score: ${mlResult.anomalyScore})`;
  } else {
    qkdApproved = true;
    status = "APPROVED";
    reason = "QKD session approved: Channel verified healthy by QBER safety threshold and ML model.";
  }

  // 4. Key Material Handling
  //
  // NORMAL mode (force=true):
  //   APPROVED  → clear existing pool → insert 200 fresh keys
  //   ABORTED   → keep existing pool intact (extremely unlikely with Normal channel)
  //
  // ATTACKER mode (always force=true from UI):
  //   ABORTED   → SECURITY FLUSH: clear existing key pool immediately
  //               (existing keys may have been observed by attacker during QKD)
  //               → do NOT insert any new keys → pool ends up at 0
  //
  if (qkdApproved) {
    // Approved — clear old keys and insert fresh ones
    if (force) {
      const { error: deleteError } = await supabase
        .from("kme_keys")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (deleteError) throw mapSupabaseError(deleteError, "Failed to clear previous key pool.");
    }

    const { error } = await supabase.from("kme_keys").insert(rows);
    if (error) throw mapSupabaseError(error, "Failed to store approved QKD keys.");

  } else if (mode === "ATTACKER" || force) {
    // Aborted from Attacker mode → security flush: clear the existing pool
    // (Compromised channel means existing pre-shared key material may be tainted)
    console.warn(`[QKD Security Gate] SESSION ABORTED! Reason: ${reason}. Flushing key pool for security.`);
    const { error: flushError } = await supabase
      .from("kme_keys")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (flushError) {
      console.error("[QKD Security Gate] Failed to flush key pool:", flushError.message);
    }
  } else {
    // Aborted but not forced — keep existing keys, just discard new material
    console.warn(`[QKD Security Gate] SESSION ABORTED! Reason: ${reason}. Key material discarded.`);
  }

  const resultPayload = {
    seeded: qkdApproved,
    qkdApproved,
    status,
    reason,
    mode,
    qberThreshold,
    hardQberAborted,
    telemetry,
    mlResult,
    protocol: "BB84",
    pairs: qkdApproved ? 100 : 0,
    records: qkdApproved ? 200 : 0,
    aesPairs: qkdApproved ? 80 : 0,
    otpPairs: qkdApproved ? 20 : 0,
    sourceType: "SIMULATED_QKD",
    totalRawPhotonsTransmitted: totalRawPhotons,
    totalMatchedBasesSifted: totalMatchedBases,
    averageSiftingEfficiency: Number((totalMatchedBases / totalRawPhotons).toFixed(3)),
    timestamp: new Date().toISOString()
  };

  lastSimMetrics = resultPayload;
  return resultPayload;
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
      status: "INITIAL",
      reason: "No simulation executed yet.",
      telemetry: {
        qber: 0.02,
        qberPercentage: 2.0,
        photonLossRate: 0.03,
        photonLossPercentage: 3.0,
        detectionRate: 0.97,
        detectionPercentage: 97.0,
        siftedKeyLength: 256,
        keyGenerationRate: 480
      },
      mlResult: {
        prediction: "NORMAL",
        anomalyScore: 0.22,
        isAnomaly: false
      },
      timestamp: null
    };
  }
  return lastSimMetrics;
}

export async function seedMockKeys(options = {}) {
  return simulateBb84KeyPool(options);
}
