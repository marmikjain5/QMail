import crypto from "node:crypto";

/**
 * Simulates the BB84 Quantum Key Distribution (QKD) protocol
 * between Alice (transmitter) and Bob (receiver).
 *
 * Steps simulated:
 * 1. Alice generates random raw bits and selects random polarization bases (+ or x).
 * 2. Alice encodes and transmits polarized photons.
 * 3. Bob chooses random measurement bases (+ or x) and measures the photons.
 *    - Matching basis -> deterministic detection of Alice's bit.
 *    - Mismatched basis -> quantum indeterminacy (50% random collapse).
 * 4. Classical sifting phase: Alice and Bob publicly announce and compare bases.
 * 5. Reconciled matching bits are retained and packed into byte buffer.
 *
 * @param {number} keySizeBytes - Desired key length in bytes (e.g. 32 for AES-256, 2048 for OTP)
 * @returns {{ keyBase64: string, rawBitsCount: number, matchedBasesCount: number, siftingEfficiency: number, keySizeBytes: number }}
 */
export function simulateBb84({ keySizeBytes }) {
  const targetBits = keySizeBytes * 8;
  const siftedBits = [];
  let totalRawBits = 0;
  let totalMatchedBases = 0;

  // Run in chunks if needed until targetBits are collected
  while (siftedBits.length < targetBits) {
    const bitsNeeded = targetBits - siftedBits.length;
    // Generate ~2.4x raw bits to guarantee enough matching bases (~50% yield)
    const rawCount = Math.max(Math.ceil(bitsNeeded * 2.4) + 64, 128);
    totalRawBits += rawCount;

    // 1. Alice generates random bits and random bases ('+' = rectilinear, 'x' = diagonal)
    const aliceBits = new Uint8Array(rawCount);
    const aliceBases = new Uint8Array(rawCount); // 0 = '+', 1 = 'x'
    const randomAlice = crypto.randomBytes(rawCount * 2);
    for (let i = 0; i < rawCount; i++) {
      aliceBits[i] = randomAlice[i] & 1;
      aliceBases[i] = (randomAlice[rawCount + i] & 1);
    }

    // 2. Bob selects random measurement bases
    const bobBases = new Uint8Array(rawCount);
    const randomBob = crypto.randomBytes(rawCount);
    for (let i = 0; i < rawCount; i++) {
      bobBases[i] = randomBob[i] & 1;
    }

    // 3. Bob measures the quantum states
    // If bases match: Bob receives Alice's bit with 100% fidelity (noiseless QKD channel).
    // If bases differ: Bob's measurement collapses randomly to 0 or 1.
    const bobBits = new Uint8Array(rawCount);
    const randomNoise = crypto.randomBytes(rawCount);
    for (let i = 0; i < rawCount; i++) {
      if (aliceBases[i] === bobBases[i]) {
        bobBits[i] = aliceBits[i];
      } else {
        bobBits[i] = randomNoise[i] & 1;
      }
    }

    // 4. Sifting Phase: Alice & Bob publicly compare bases and discard mismatches
    for (let i = 0; i < rawCount; i++) {
      if (aliceBases[i] === bobBases[i]) {
        totalMatchedBases++;
        siftedBits.push(aliceBits[i]);
        if (siftedBits.length === targetBits) {
          break;
        }
      }
    }
  }

  // 5. Pack the sifted bits into bytes
  const buffer = Buffer.alloc(keySizeBytes);
  for (let byteIdx = 0; byteIdx < keySizeBytes; byteIdx++) {
    let byteVal = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const bit = siftedBits[byteIdx * 8 + bitIdx];
      byteVal = (byteVal << 1) | bit;
    }
    buffer[byteIdx] = byteVal;
  }

  return {
    keyBase64: buffer.toString("base64"),
    rawBitsCount: totalRawBits,
    matchedBasesCount: totalMatchedBases,
    siftingEfficiency: Number((totalMatchedBases / totalRawBits).toFixed(3)),
    keySizeBytes
  };
}
