import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  IKeyManager,
  KeyPoolStatus,
  QuantumKeyMaterial,
  ReserveKeyRequest,
} from './interfaces.js';
import { KeyStatus } from './interfaces.js';
import {
  InsufficientKeyMaterialError,
  KeyAlreadyConsumedError,
  KeyNotFoundError,
  QkmUnavailableError,
} from '../crypto/errors.js';

interface KeyRecord {
  keyId: string;
  keyMaterial: Buffer; // Raw in-memory bytes — never serialized
  startOffset: number;
  lengthBytes: number;
  status: KeyStatus;
  sourceNode: string;
  targetNode: string;
  purpose: string;
  reservedAt?: Date;
  consumedAt?: Date;
  expiresAt: Date;
}

type ChannelState = 'NORMAL' | 'TURBULENCE' | 'ANOMALOUS' | 'DEAD';

/**
 * Mock Quantum Key Manager — In-Memory Implementation
 *
 * This class simulates a real QKD Key Management System using a
 * cryptographically secure random number generator (CSPRNG) as the
 * key source. In a production system, this class would be replaced
 * by an EtsiQkmAdapter that communicates with real QKD hardware via
 * the ETSI GS QKD 014 key delivery API.
 *
 * IMPORTANT DISCLAIMER: This implementation generates key material
 * using Node.js crypto.randomBytes(), NOT physical quantum optics.
 * The keys are cryptographically secure but are NOT generated via
 * quantum key distribution. Only the simulation layer (QkdSimulator)
 * models the statistical behavior of a physical QKD channel.
 *
 * Key isolation:
 * - Raw key material is stored only in memory (Buffer objects).
 * - Keys are NEVER serialized to disk or logged.
 * - Key material is explicitly zeroed upon consumption.
 * - OTP byte ranges are tracked; no two reservations can overlap.
 */
export class MockQkmService implements IKeyManager {
  // In-memory key pool — 10 MB CSPRNG buffer by default
  private pool: Buffer;
  private poolOffset = 0; // Next available byte offset in pool
  private readonly keys = new Map<string, KeyRecord>();
  private isLocked = false; // Simple async lock for atomic reservations

  // Channel simulation state
  private channelState: ChannelState = 'NORMAL';
  private replenishInterval?: ReturnType<typeof setInterval>;

  // Simulated node identity
  public readonly nodeId = 'qkm-node-alpha';
  public readonly peerNodeId = 'qkm-node-beta';

  constructor(private readonly initialPoolBytes: number = 10 * 1024 * 1024) {
    console.log(
      `[MockQKM] Initializing in-memory key pool: ${(initialPoolBytes / 1024 / 1024).toFixed(1)} MB`,
    );
    this.pool = randomBytes(initialPoolBytes);

    // Replenish the pool periodically (simulates key generation from QKD hardware)
    this.replenishInterval = setInterval(() => this.replenishPool(), 30_000);
  }

  /**
   * Get the current pool status between source and target nodes.
   */
  async getPoolStatus(sourceNode: string, targetNode: string): Promise<KeyPoolStatus> {
    if (this.channelState === 'DEAD') {
      return {
        sourceNode,
        targetNode,
        availableKeyBits: 0,
        reservedKeyBits: 0,
        consumedKeyBits: this.poolOffset * 8,
        channelHealth: 'DEAD',
        qber: 1.0,
        estimatedAttackerInfo: 1.0,
        secretKeyRateBps: 0,
      };
    }

    const { reservedBits } = this.getReservedStats();
    const consumedBits = this.poolOffset * 8;
    const availableBits = this.availableBytes * 8;

    return {
      sourceNode,
      targetNode,
      availableKeyBits: Math.max(0, availableBits - reservedBits),
      reservedKeyBits: reservedBits,
      consumedKeyBits: consumedBits,
      channelHealth: this.channelState === 'ANOMALOUS' ? 'DEGRADED' : 'HEALTHY',
      qber: this.getCurrentQber(),
      estimatedAttackerInfo: this.getEstimatedAttackerInfo(),
      secretKeyRateBps: this.getSecretKeyRate(),
    };
  }

  /**
   * Atomically reserve key material from the pool.
   * Uses a simple boolean mutex to prevent concurrent allocation of the same bytes.
   */
  async reserveKey(request: ReserveKeyRequest): Promise<QuantumKeyMaterial> {
    if (this.channelState === 'DEAD') {
      throw new QkmUnavailableError('QKD channel is dead — no key material can be generated');
    }

    const lengthBytes = Math.ceil(request.keyLengthBits / 8);

    // Acquire lock (simple spin-wait with max retries)
    await this.acquireLock();

    try {
      if (this.availableBytes < lengthBytes) {
        throw new InsufficientKeyMaterialError(this.availableBytes, lengthBytes);
      }

      const startOffset = this.poolOffset;
      // Extract key material slice from the pool
      const keyMaterial = Buffer.allocUnsafe(lengthBytes);
      this.pool.copy(keyMaterial, 0, startOffset, startOffset + lengthBytes);

      // Advance pool pointer
      this.poolOffset += lengthBytes;

      const keyId = `qkey_${uuidv4()}`;
      const expiresAt = new Date(
        Date.now() + (request.timeoutSeconds ?? 300) * 1000,
      );

      const record: KeyRecord = {
        keyId,
        keyMaterial,
        startOffset,
        lengthBytes,
        status: KeyStatus.RESERVED,
        sourceNode: request.sourceNode,
        targetNode: request.targetNode,
        purpose: request.purpose,
        reservedAt: new Date(),
        expiresAt,
      };

      this.keys.set(keyId, record);

      console.log(
        `[MockQKM] Reserved key ${keyId}: ${lengthBytes} bytes, purpose=${request.purpose}`,
      );

      return {
        keyId,
        keyMaterialBase64: keyMaterial.toString('base64'),
        lengthBits: request.keyLengthBits,
        status: KeyStatus.RESERVED,
        expiresAt,
        sourceNode: request.sourceNode,
        targetNode: request.targetNode,
      };
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Retrieve a key by ID (recipient flow).
   * IMPORTANT: This operation marks the key as CONSUMED immediately.
   * It can only be called ONCE per keyId — OTP reuse is strictly forbidden.
   */
  async retrieveKey(keyId: string, sourceNode: string): Promise<QuantumKeyMaterial> {
    const record = this.keys.get(keyId);

    if (!record) {
      throw new KeyNotFoundError(keyId);
    }

    if (record.status === KeyStatus.CONSUMED) {
      throw new KeyAlreadyConsumedError(keyId);
    }

    if (record.status === KeyStatus.EXPIRED || record.expiresAt < new Date()) {
      record.status = KeyStatus.EXPIRED;
      throw new KeyNotFoundError(keyId);
    }

    // Mark as CONSUMED immediately upon retrieval
    record.status = KeyStatus.CONSUMED;
    record.consumedAt = new Date();

    const keyMaterialBase64 = record.keyMaterial.toString('base64');

    // Zero the in-memory key material
    record.keyMaterial.fill(0);

    console.log(`[MockQKM] Retrieved & consumed key ${keyId}`);

    return {
      keyId,
      keyMaterialBase64,
      lengthBits: record.lengthBytes * 8,
      status: KeyStatus.CONSUMED,
      expiresAt: record.expiresAt,
      sourceNode: record.sourceNode,
      targetNode: record.targetNode,
    };
  }

  /**
   * Mark a key as CONSUMED after use on the sender side.
   */
  async consumeKey(keyId: string): Promise<void> {
    const record = this.keys.get(keyId);
    if (!record) {
      throw new KeyNotFoundError(keyId);
    }

    if (record.status === KeyStatus.CONSUMED) {
      return; // Idempotent
    }

    record.status = KeyStatus.CONSUMED;
    record.consumedAt = new Date();
    record.keyMaterial.fill(0); // Zero key material
    console.log(`[MockQKM] Key ${keyId} marked as CONSUMED`);
  }

  /**
   * Get the current status of a specific key.
   */
  async getKeyStatus(keyId: string): Promise<KeyStatus> {
    const record = this.keys.get(keyId);
    if (!record) return KeyStatus.INVALID;

    // Check for expiry
    if (record.status === KeyStatus.RESERVED && record.expiresAt < new Date()) {
      record.status = KeyStatus.EXPIRED;
      record.keyMaterial.fill(0);
    }

    return record.status;
  }

  /**
   * Trigger a simulated channel disturbance.
   * Used for demo scenarios 17–18 (anomaly simulation).
   */
  simulateChannelDisturbance(state: ChannelState): void {
    this.channelState = state;
    console.log(`[MockQKM] Channel state → ${state}`);
  }

  /**
   * Get all key records for admin/dashboard display.
   * Returns metadata only — never raw key material.
   */
  getKeyMetadata(): Array<{
    keyId: string;
    status: KeyStatus;
    lengthBits: number;
    purpose: string;
    reservedAt?: Date;
    consumedAt?: Date;
    expiresAt: Date;
  }> {
    return Array.from(this.keys.values()).map((r) => ({
      keyId: r.keyId,
      status: r.status,
      lengthBits: r.lengthBytes * 8,
      purpose: r.purpose,
      reservedAt: r.reservedAt,
      consumedAt: r.consumedAt,
      expiresAt: r.expiresAt,
    }));
  }

  /**
   * Clean up resources on shutdown.
   */
  destroy(): void {
    if (this.replenishInterval) {
      clearInterval(this.replenishInterval);
    }
    this.pool.fill(0);
    for (const record of this.keys.values()) {
      record.keyMaterial.fill(0);
    }
    this.keys.clear();
    console.log('[MockQKM] Destroyed — all key material zeroed');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private get availableBytes(): number {
    return Math.max(0, this.pool.length - this.poolOffset);
  }

  private getReservedStats(): { reservedBits: number } {
    let reservedBytes = 0;
    for (const r of this.keys.values()) {
      if (r.status === KeyStatus.RESERVED) {
        reservedBytes += r.lengthBytes;
      }
    }
    return { reservedBits: reservedBytes * 8 };
  }

  private getCurrentQber(): number {
    const base: Record<ChannelState, number> = {
      NORMAL: 0.022,
      TURBULENCE: 0.058,
      ANOMALOUS: 0.096,
      DEAD: 1.0,
    };
    // Add Gaussian noise ±0.003
    const noise = (Math.random() - 0.5) * 0.006;
    return Math.max(0, base[this.channelState] + noise);
  }

  private getEstimatedAttackerInfo(): number {
    const qber = this.getCurrentQber();
    // Rough estimate: I_E ≤ H2(QBER + confidence_margin)
    const p = Math.min(1, qber + 0.05);
    if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
    return Math.max(0, -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));
  }

  private getSecretKeyRate(): number {
    if (this.channelState === 'DEAD') return 0;
    const qber = this.getCurrentQber();
    if (qber > 0.11) return 0;
    // Simplified secret key rate formula
    const h2 = (p: number) =>
      p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
    const rate = 0.5 * (1 - h2(qber) - 1.16 * h2(qber));
    const baseBps = 100_000; // 100 kbps base
    return Math.max(0, Math.floor(baseBps * rate));
  }

  private replenishPool(): void {
    if (this.channelState === 'DEAD') return;

    // Replenish 1 MB every 30 seconds (simulates QKD hardware key generation)
    const replenishBytes = Math.min(1024 * 1024, this.poolOffset);
    if (replenishBytes <= 0) return;

    // Compact pool: shift unconsumed bytes to the start
    const remaining = this.pool.length - this.poolOffset;
    if (remaining > 0) {
      this.pool.copy(this.pool, 0, this.poolOffset);
    }

    // Fill the freed space with fresh random bytes
    const freshBytes = randomBytes(Math.min(replenishBytes, this.pool.length - remaining));
    freshBytes.copy(this.pool, remaining);
    this.poolOffset = 0;

    console.log(
      `[MockQKM] Pool replenished. Available: ${(this.availableBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  private async acquireLock(maxRetries = 50, retryDelayMs = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      if (!this.isLocked) {
        this.isLocked = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    throw new QkmUnavailableError('Key manager is busy — too many concurrent requests');
  }

  private releaseLock(): void {
    this.isLocked = false;
  }
}
