// =============================================================================
// Cryptographic Interfaces & Types
// =============================================================================

/**
 * Security levels available for QuMail message encryption.
 *
 * STANDARD   (1): No additional encryption. Standard email via provider.
 * QUANTUM_AES (2): AES-256-GCM authenticated encryption with QKM-derived key.
 *                  Provides computational security.
 * QUANTUM_OTP (3): True One-Time Pad XOR encryption with QKM-derived key stream.
 *                  Provides information-theoretic secrecy when strict OTP
 *                  requirements (key length ≥ plaintext, zero key reuse) are met.
 */
export enum SecurityLevel {
  STANDARD = 1,
  QUANTUM_AES = 2,
  QUANTUM_OTP = 3,
}

/**
 * Result of a successful encryption operation.
 */
export interface EncryptResult {
  /** Base64-encoded ciphertext */
  ciphertextBase64: string;
  /** Base64-encoded 12-byte random IV (AES-GCM only) */
  ivBase64: string;
  /** Base64-encoded 16-byte authentication tag (AES-GCM only) */
  authTagBase64: string;
  /** Base64-encoded HMAC-SHA256 integrity tag (OTP only) */
  macTagBase64: string;
  /** Algorithm identifier */
  algorithm: 'AES-256-GCM' | 'OTP-XOR-HMAC-SHA256';
  /** Number of bytes consumed from the QKM pool */
  keyConsumedBytes: number;
}

/**
 * Input required to perform decryption.
 */
export interface DecryptInput {
  /** Base64-encoded ciphertext */
  ciphertextBase64: string;
  /** Base64-encoded IV (required for AES-GCM) */
  ivBase64?: string;
  /** Base64-encoded authentication tag (required for AES-GCM) */
  authTagBase64?: string;
  /** Base64-encoded HMAC-SHA256 integrity tag (required for OTP) */
  macTagBase64?: string;
  /** Base64-encoded raw key material */
  keyMaterialBase64: string;
  /** Algorithm to use for decryption */
  algorithm: 'AES-256-GCM' | 'OTP-XOR-HMAC-SHA256';
}

/**
 * Result of a successful decryption operation.
 */
export interface DecryptResult {
  /** Decrypted plaintext as a Buffer */
  plaintextBuffer: Buffer;
  /** Whether the authentication/integrity check passed */
  verified: boolean;
}

/**
 * Core encryption service interface.
 * Implementations must be stateless — all state is passed as arguments.
 */
export interface IEncryptionService {
  /**
   * Encrypt a buffer using AES-256-GCM.
   * A fresh random 12-byte IV is generated for every call.
   * Key material buffer will be zeroed after use.
   */
  encryptAesGcm(
    plaintext: Buffer,
    keyMaterial: Buffer,
    additionalData?: string,
  ): Promise<Pick<EncryptResult, 'ciphertextBase64' | 'ivBase64' | 'authTagBase64' | 'algorithm'>>;

  /**
   * Decrypt and authenticate a buffer using AES-256-GCM.
   * Throws AuthTagVerificationError if the tag is invalid.
   */
  decryptAesGcm(input: DecryptInput, additionalData?: string): Promise<DecryptResult>;

  /**
   * Encrypt a buffer using true One-Time Pad XOR.
   * keyStream.length MUST equal plaintext.length.
   * macKey is used to produce HMAC-SHA256 over the ciphertext for integrity.
   * Both key buffers will be zeroed after use.
   */
  encryptOtp(
    plaintext: Buffer,
    keyStream: Buffer,
    macKey: Buffer,
  ): Promise<Pick<EncryptResult, 'ciphertextBase64' | 'macTagBase64' | 'algorithm'>>;

  /**
   * Decrypt a buffer using true One-Time Pad XOR.
   * Verifies HMAC-SHA256 before decryption.
   * Throws OtpIntegrityError if MAC is invalid.
   */
  decryptOtp(input: DecryptInput, macKey: Buffer): Promise<DecryptResult>;
}
