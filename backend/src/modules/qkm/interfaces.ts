// =============================================================================
// Quantum Key Manager — Interfaces & Types
// Inspired by ETSI GS QKD 014 Key Delivery API concepts.
// =============================================================================

export enum KeyStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  INVALID = 'INVALID',
}

/**
 * A quantum key material bundle returned to the caller.
 * The raw key bytes are Base64-encoded to allow safe JSON serialization.
 *
 * SECURITY: The raw key material must NEVER be logged, stored in databases,
 * or included in email bodies, IPFS content, or blockchain records.
 * Only the keyId is stored externally to allow the recipient to retrieve
 * the matching key from the QKM.
 */
export interface QuantumKeyMaterial {
  keyId: string;
  /** Base64-encoded raw key bytes. Must be zeroed after use. */
  keyMaterialBase64: string;
  lengthBits: number;
  status: KeyStatus;
  expiresAt: Date;
  sourceNode: string;
  targetNode: string;
}

/**
 * Key pool status between two QKM nodes.
 * Returned by the ETSI-style /status endpoint.
 */
export interface KeyPoolStatus {
  sourceNode: string;
  targetNode: string;
  /** Available key bits ready for reservation */
  availableKeyBits: number;
  /** Bits currently reserved but not yet consumed */
  reservedKeyBits: number;
  /** Total bits consumed since pool creation */
  consumedKeyBits: number;
  channelHealth: 'HEALTHY' | 'DEGRADED' | 'DEAD';
  /** Current Quantum Bit Error Rate (0.0 – 1.0) */
  qber: number;
  /** Upper-bound estimate of adversary mutual information (0.0 – 1.0) */
  estimatedAttackerInfo: number;
  /** Estimated secret key generation rate in bps */
  secretKeyRateBps: number;
}

/**
 * Request to reserve key material from the QKM pool.
 */
export interface ReserveKeyRequest {
  sourceNode: string;
  targetNode: string;
  keyLengthBits: number;
  purpose: 'QUANTUM_AES_MESSAGE' | 'QUANTUM_AES_ATTACHMENT' | 'QUANTUM_OTP_MESSAGE' | 'QUANTUM_OTP_ATTACHMENT' | 'HMAC_INTEGRITY';
  timeoutSeconds?: number;
}

/**
 * Core Quantum Key Manager interface.
 *
 * Implementations:
 * - MockQkmService: In-memory CSPRNG key pool for development/demo.
 * - [Future] EtsiQkmAdapter: Real ETSI GS QKD 014 hardware KMS.
 *
 * This interface is the ONLY coupling point between the encryption layer
 * and the key management layer. Replacing MockQkmService with a real QKD
 * hardware KMS requires ONLY implementing this interface — no other changes.
 */
export interface IKeyManager {
  /**
   * Get the current key pool status between two nodes.
   */
  getPoolStatus(sourceNode: string, targetNode: string): Promise<KeyPoolStatus>;

  /**
   * Reserve (atomically) key material from the pool.
   * The key transitions from AVAILABLE → RESERVED.
   * Returns the raw key material for immediate use.
   *
   * NOTE: The caller MUST call consumeKey() after use, or the key
   * will transition to EXPIRED after timeoutSeconds.
   */
  reserveKey(request: ReserveKeyRequest): Promise<QuantumKeyMaterial>;

  /**
   * Retrieve a previously reserved key by its ID (recipient flow).
   * The key transitions from RESERVED → CONSUMED immediately upon retrieval.
   * Can only be called ONCE per keyId.
   */
  retrieveKey(keyId: string, sourceNode: string): Promise<QuantumKeyMaterial>;

  /**
   * Mark a key as CONSUMED after successful encryption.
   * Idempotent if key is already CONSUMED.
   */
  consumeKey(keyId: string): Promise<void>;

  /**
   * Get the current status of a specific key.
   */
  getKeyStatus(keyId: string): Promise<KeyStatus>;

  /**
   * Trigger a simulated channel disturbance (demo only).
   * Real QKD implementations would not have this method.
   */
  simulateChannelDisturbance(
    state: 'NORMAL' | 'TURBULENCE' | 'ANOMALOUS' | 'DEAD',
  ): void;
}
