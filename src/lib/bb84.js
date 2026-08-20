import { simulateBb84Channel } from "./qkdChannelSimulator.js";

export { simulateBb84Channel };

/**
 * Legacy wrapper for simulateBb84. Delegates to simulateBb84Channel in NORMAL mode.
 *
 * @param {object} options
 * @param {number} options.keySizeBytes
 * @returns {object}
 */
export function simulateBb84({ keySizeBytes }) {
  const result = simulateBb84Channel({ keySizeBytes, mode: "NORMAL" });
  return {
    keyBase64: result.keyBase64,
    rawBitsCount: result.rawBitsCount,
    matchedBasesCount: result.matchedBasesCount,
    siftingEfficiency: Number((result.matchedBasesCount / result.rawBitsCount).toFixed(3)),
    keySizeBytes: result.keySizeBytes,
    telemetry: result.telemetry
  };
}
