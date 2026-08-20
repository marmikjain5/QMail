import crypto from "node:crypto";

/**
 * Quantum Channel Simulator with QBER estimation and telemetry generation for BB84 QKD.
 * Supports two channel conditions:
 * - NORMAL mode: Low background noise, low loss, low QBER, high key generation rate.
 * - ATTACKER mode: Channel disturbance/interception, higher bit errors, photon loss, low key rate.
 *
 * @param {object} options
 * @param {number} options.keySizeBytes - Desired usable key length in bytes
 * @param {'NORMAL'|'ATTACKER'} options.mode - Channel mode
 * @returns {object} { keyBase64, telemetry, usableKeySizeBytes }
 */
export function simulateBb84Channel({ keySizeBytes = 32, mode = "NORMAL" } = {}) {
  const isAttacker = mode === "ATTACKER";
  
  // Dynamic channel parameters based on mode
  // Normal mode: ~2-5% photon loss, ~1-3.5% bit flip noise
  // Attacker mode: ~25-42% photon loss, ~18-32% bit error (eavesdropping disturbance)
  const photonLossRate = isAttacker
    ? 0.25 + Math.random() * 0.17
    : 0.02 + Math.random() * 0.035;
    
  const bitErrorRate = isAttacker
    ? 0.18 + Math.random() * 0.14
    : 0.01 + Math.random() * 0.025;
    
  const detectionRate = 1.0 - photonLossRate;
  
  // Base key generation rate (bps)
  const baseKeyGenRate = isAttacker
    ? 140 + Math.random() * 100
    : 450 + Math.random() * 70;

  const targetBits = keySizeBytes * 8;
  const siftedAliceBits = [];
  const siftedBobBits = [];
  
  let totalRawPhotons = 0;
  let totalMatchedBases = 0;
  let totalPhotonsDetected = 0;

  // Run simulation loops until we gather enough sifted bits
  while (siftedAliceBits.length < targetBits + 64) {
    const chunkSize = 256;
    totalRawPhotons += chunkSize;
    
    // 1. Alice generates random bits and random bases (0='+', 1='x')
    const aliceBits = new Uint8Array(chunkSize);
    const aliceBases = new Uint8Array(chunkSize);
    const randAlice = crypto.randomBytes(chunkSize * 2);
    for (let i = 0; i < chunkSize; i++) {
      aliceBits[i] = randAlice[i] & 1;
      aliceBases[i] = randAlice[chunkSize + i] & 1;
    }
    
    // 2. Quantum Channel Transmission with Loss and Error
    const bobBases = new Uint8Array(chunkSize);
    const bobBits = new Uint8Array(chunkSize);
    const photonDetected = new Uint8Array(chunkSize);
    
    const randBobBases = crypto.randomBytes(chunkSize);
    const randLoss = crypto.randomBytes(chunkSize);
    const randError = crypto.randomBytes(chunkSize);
    const randRandomCollapse = crypto.randomBytes(chunkSize);
    
    for (let i = 0; i < chunkSize; i++) {
      bobBases[i] = randBobBases[i] & 1;
      
      // Determine photon loss
      const lossProb = randLoss[i] / 255.0;
      if (lossProb > photonLossRate) {
        photonDetected[i] = 1;
        totalPhotonsDetected++;
      } else {
        photonDetected[i] = 0;
        continue;
      }
      
      // Photons detected by Bob
      if (aliceBases[i] === bobBases[i]) {
        // Matching basis: bit is Alice's bit unless distorted by channel noise
        const errProb = randError[i] / 255.0;
        if (errProb < bitErrorRate) {
          bobBits[i] = aliceBits[i] ^ 1; // Bit flip
        } else {
          bobBits[i] = aliceBits[i];
        }
      } else {
        // Mismatched basis: quantum indeterminacy (50/50)
        bobBits[i] = randRandomCollapse[i] & 1;
      }
    }
    
    // 3. Sifting Phase: Alice & Bob publicly compare bases (only for detected photons)
    for (let i = 0; i < chunkSize; i++) {
      if (photonDetected[i] === 1 && aliceBases[i] === bobBases[i]) {
        totalMatchedBases++;
        siftedAliceBits.push(aliceBits[i]);
        siftedBobBits.push(bobBits[i]);
      }
    }
  }

  // 4. QBER Calculation & Sampling
  // Sample 15% of the sifted key (minimum 32 bits)
  const totalSiftedCount = siftedAliceBits.length;
  const sampleSize = Math.max(32, Math.floor(totalSiftedCount * 0.15));
  
  let mismatchedSampleBits = 0;
  // Pick deterministic/random indices for public sample comparison
  const sampleIndices = new Set();
  while (sampleIndices.size < sampleSize) {
    const idx = Math.floor(Math.random() * totalSiftedCount);
    sampleIndices.add(idx);
  }
  
  for (const idx of sampleIndices) {
    if (siftedAliceBits[idx] !== siftedBobBits[idx]) {
      mismatchedSampleBits++;
    }
  }
  
  const qber = Number((mismatchedSampleBits / sampleSize).toFixed(4));
  
  // Remove sampled bits from usable key material
  const usableSiftedBits = [];
  for (let i = 0; i < totalSiftedCount; i++) {
    if (!sampleIndices.has(i) && usableSiftedBits.length < targetBits) {
      usableSiftedBits.push(siftedBobBits[i]); // Usable sifted key
    }
  }

  // Pad usable bits if needed (fill up to targetBits)
  while (usableSiftedBits.length < targetBits) {
    usableSiftedBits.push(siftedBobBits[usableSiftedBits.length % siftedBobBits.length]);
  }

  // 5. Pack usable bits into Byte Buffer
  const keyBuffer = Buffer.alloc(keySizeBytes);
  for (let byteIdx = 0; byteIdx < keySizeBytes; byteIdx++) {
    let byteVal = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const bit = usableSiftedBits[byteIdx * 8 + bitIdx];
      byteVal = (byteVal << 1) | bit;
    }
    keyBuffer[byteIdx] = byteVal;
  }

  // Derived key generation rate accounting for loss and sifting yield
  const keyGenRate = Number((baseKeyGenRate * (1.0 - (qber * 0.5))).toFixed(1));

  // Telemetry object as required
  const telemetry = {
    qber,
    qberPercentage: Number((qber * 100).toFixed(2)),
    photonLossRate: Number(photonLossRate.toFixed(4)),
    photonLossPercentage: Number((photonLossRate * 100).toFixed(2)),
    detectionRate: Number(detectionRate.toFixed(4)),
    detectionPercentage: Number((detectionRate * 100).toFixed(2)),
    siftedKeyLength: usableSiftedBits.length,
    keyGenerationRate: keyGenRate,
    rawPhotonsTransmitted: totalRawPhotons,
    matchedBasesCount: totalMatchedBases,
    sampleSizeBits: sampleSize,
    mismatchedSampleBits,
    mode
  };

  return {
    keyBase64: keyBuffer.toString("base64"),
    telemetry,
    rawBitsCount: totalRawPhotons,
    matchedBasesCount: totalMatchedBases,
    keySizeBytes
  };
}
