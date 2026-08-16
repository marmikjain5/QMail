/**
 * BB84 Quantum Key Distribution — Statistical Physical Channel Simulator
 *
 * DISCLAIMER: This module simulates the STATISTICAL BEHAVIOR of a BB84 QKD
 * optical channel. It does NOT perform actual quantum optics computation.
 * No photons are generated, transmitted, or measured. All values are computed
 * using the mathematical formulas from standard QKD security analyses
 * (Shor-Preskill, GLLP, and decoy-state protocols).
 *
 * In a production system, this module would be replaced by telemetry data
 * from real QKD hardware (e.g., Toshiba QKD System, ID Quantique Cerberus).
 *
 * Mathematical references:
 * - Shor & Preskill (2000): "Simple Proof of Security of the BB84 QKD Protocol"
 * - Gobby, Yuan & Shields (2004): "Quantum key distribution over 122 km of standard fiber"
 * - Lo, Ma & Chen (2005): "Decoy State Quantum Key Distribution"
 */

export interface QkdChannelParameters {
  /** Background dark count rate per pulse (Y₀ ~ 10⁻⁶) */
  darkCountRate: number;
  /** Optical misalignment error rate (e_opt ~ 0.015) */
  opticalMisalignmentError: number;
  /** Fiber attenuation in dB/km (α ~ 0.2 dB/km for SMF-28) */
  fiberAttenuationDbPerKm: number;
  /** Link distance in km */
  linkDistanceKm: number;
  /** Single-photon detector efficiency (η_d ~ 0.15) */
  detectorEfficiency: number;
  /** Mean photon number per pulse (μ ~ 0.5 for weak coherent sources) */
  meanPhotonNumber: number;
}

export interface QkdTelemetry {
  timestamp: Date;
  qber: number;
  photonLossDb: number;
  photonDetectionRate: number;
  rawKeyRateBps: number;
  secretKeyRateBps: number;
  channelState: 'HEALTHY' | 'TURBULENCE' | 'ANOMALOUS' | 'DEAD';
  basisMatchingRate: number;
  privacyAmplificationActive: boolean;
  privacyAmplificationRatio?: number;
  sourceNode: string;
  targetNode: string;
}

export type ChannelSimState = 'NORMAL' | 'TURBULENCE' | 'ANOMALOUS' | 'DEAD';

/**
 * Default channel parameters for a 50 km fiber link.
 */
export const DEFAULT_CHANNEL_PARAMS: QkdChannelParameters = {
  darkCountRate: 1e-6,
  opticalMisalignmentError: 0.015,
  fiberAttenuationDbPerKm: 0.2,
  linkDistanceKm: 50,
  detectorEfficiency: 0.15,
  meanPhotonNumber: 0.5,
};

// =============================================================================
// Mathematical Model Functions
// =============================================================================

/**
 * Binary Shannon entropy function H₂(p).
 * H₂(p) = -p·log₂(p) - (1-p)·log₂(1-p)
 */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

/**
 * Calculate overall channel transmittance.
 * η = 10^(-α·L/10) · η_detector
 *
 * @param params - Channel parameters
 */
export function calculateTransmittance(params: QkdChannelParameters): number {
  const fiberLoss = 10 ** (-params.fiberAttenuationDbPerKm * params.linkDistanceKm / 10);
  return fiberLoss * params.detectorEfficiency;
}

/**
 * Calculate Quantum Bit Error Rate (QBER).
 *
 * QBER = (e_detector · Y₀ + e_opt · η · μ) / (Y₀ + η · μ)
 *
 * where:
 *   Y₀ = dark count rate
 *   e_detector = detector dark count error rate (≈ 0.5)
 *   e_opt = optical misalignment error
 *   η = transmittance
 *   μ = mean photon number
 *
 * @param params - Channel parameters
 * @param additionalNoise - Additional noise (simulates eavesdropping or turbulence)
 */
export function calculateQber(
  params: QkdChannelParameters,
  additionalNoise = 0,
): number {
  const eta = calculateTransmittance(params);
  const Y0 = params.darkCountRate;
  const eOpt = params.opticalMisalignmentError;
  const mu = params.meanPhotonNumber;
  const eDetector = 0.5; // Dark count induced error

  const numerator = eDetector * Y0 + eOpt * eta * mu;
  const denominator = Y0 + eta * mu;

  const baseQber = numerator / denominator;
  return Math.min(1, Math.max(0, baseQber + additionalNoise));
}

/**
 * Calculate the secret key rate from BB84 with decoy states.
 *
 * R_secret ≥ q · Q_μ · [1 - H₂(e_phase) - f(QBER) · H₂(QBER)]
 *
 * where:
 *   q = basis sifting efficiency (0.5 for BB84, or higher for efficient BB84)
 *   Q_μ = gain (detection probability per pulse)
 *   e_phase = phase error rate (estimated from QBER statistics)
 *   f(QBER) = error correction inefficiency (≈ 1.16)
 *   H₂ = binary entropy function
 *
 * Security bound: If QBER > 11%, R_secret = 0 (Shor-Preskill bound for BB84).
 *
 * @param params - Channel parameters
 * @param qber - Measured QBER
 */
export function calculateSecretKeyRate(
  params: QkdChannelParameters,
  qber: number,
): number {
  // Security bound: above 11% QBER, no secure key can be extracted
  if (qber >= 0.11) return 0;

  const eta = calculateTransmittance(params);
  const Y0 = params.darkCountRate;
  const mu = params.meanPhotonNumber;

  // Gain (detection probability per pulse)
  const gain = Y0 + eta * mu;

  // Phase error rate estimate (using upper bound for BB84)
  const ePhase = qber;

  // Basis sifting efficiency
  const q = 0.5;

  // Error correction inefficiency (Shannon limit = 1.0, practical ≈ 1.16)
  const f = 1.16;

  const rawRate = q * gain * (1 - binaryEntropy(ePhase) - f * binaryEntropy(qber));
  const pulsesPerSecond = 1e9; // 1 GHz repetition rate (typical)

  return Math.max(0, Math.floor(rawRate * pulsesPerSecond));
}

/**
 * Calculate privacy amplification compression ratio.
 * Returns the fraction of sifted key that survives privacy amplification.
 *
 * Ratio = 1 - H₂(QBER + Δ_confidence)
 *
 * where Δ_confidence is the statistical fluctuation margin (5σ).
 *
 * @param qber - Measured QBER
 * @param confidenceMargin - Statistical fluctuation margin (default = 0.05)
 */
export function calculatePrivacyAmplificationRatio(
  qber: number,
  confidenceMargin = 0.05,
): number {
  const pEstimate = Math.min(1, qber + confidenceMargin);
  const ratio = 1 - binaryEntropy(pEstimate);
  return Math.max(0, ratio);
}

/**
 * Simulate Toeplitz matrix privacy amplification.
 * Compresses the sifted key buffer to a shorter, information-theoretically
 * secure final key by applying a random Toeplitz hash matrix multiplication.
 *
 * Note: In a real implementation this uses fast algorithms (FFT-based
 * matrix multiplication). This simulation approximates the result using
 * a deterministic hash-based compression for demo purposes.
 *
 * @param siftedKey - Input sifted key buffer
 * @param compressionRatio - Target output/input ratio (0–1)
 */
export function applyToeplitzAmplification(
  siftedKey: Buffer,
  compressionRatio: number,
): Buffer {
  if (compressionRatio <= 0) return Buffer.alloc(0);
  if (compressionRatio >= 1) return Buffer.from(siftedKey);

  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const targetBytes = Math.floor(siftedKey.length * compressionRatio);
  const result = Buffer.allocUnsafe(targetBytes);

  // XOR-hash the key in chunks to simulate Toeplitz compression
  for (let i = 0; i < targetBytes; i++) {
    const blockSize = Math.ceil(siftedKey.length / targetBytes);
    let hash = 0;
    for (let j = 0; j < blockSize && i * blockSize + j < siftedKey.length; j++) {
      hash ^= siftedKey[i * blockSize + j];
    }
    result[i] = hash;
  }

  return result;
}
