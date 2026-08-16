// =============================================================================
// Cryptographic Error Types
// =============================================================================

/**
 * Thrown when AES-256-GCM authentication tag verification fails.
 * This indicates the ciphertext or additional authenticated data was tampered with.
 */
export class AuthTagVerificationError extends Error {
  public readonly code = 'AUTH_TAG_VERIFICATION_FAILED';
  constructor(message = 'AES-GCM authentication tag verification failed — payload may have been tampered with') {
    super(message);
    this.name = 'AuthTagVerificationError';
    Object.setPrototypeOf(this, AuthTagVerificationError.prototype);
  }
}

/**
 * Thrown when the provided OTP key stream is shorter than the plaintext.
 * Under strict OTP rules, the key MUST be at least as long as the message.
 */
export class InsufficientKeyMaterialError extends Error {
  public readonly code = 'INSUFFICIENT_KEY_MATERIAL';
  public readonly availableBytes: number;
  public readonly requiredBytes: number;

  constructor(availableBytes: number, requiredBytes: number) {
    super(
      `Insufficient OTP key material: ${availableBytes} bytes available, ${requiredBytes} bytes required. ` +
        `Consider switching to Level 2 (Quantum-AES) or waiting for key pool replenishment.`,
    );
    this.name = 'InsufficientKeyMaterialError';
    this.availableBytes = availableBytes;
    this.requiredBytes = requiredBytes;
    Object.setPrototypeOf(this, InsufficientKeyMaterialError.prototype);
  }
}

/**
 * Thrown when OTP HMAC-SHA256 integrity verification fails.
 */
export class OtpIntegrityError extends Error {
  public readonly code = 'OTP_INTEGRITY_FAILED';
  constructor(message = 'OTP HMAC-SHA256 integrity check failed — ciphertext may be corrupted or tampered with') {
    super(message);
    this.name = 'OtpIntegrityError';
    Object.setPrototypeOf(this, OtpIntegrityError.prototype);
  }
}

/**
 * Thrown when attempting to download an attachment whose SHA-256 hash
 * does not match the registered blockchain record.
 */
export class AttachmentIntegrityError extends Error {
  public readonly code = 'ATTACHMENT_INTEGRITY_MISMATCH';
  public readonly expectedHash: string;
  public readonly actualHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super(
      `Attachment integrity check failed. ` +
        `Expected SHA-256: ${expectedHash}. Actual: ${actualHash}. ` +
        `The file may have been tampered with or corrupted during transfer.`,
    );
    this.name = 'AttachmentIntegrityError';
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
    Object.setPrototypeOf(this, AttachmentIntegrityError.prototype);
  }
}

/**
 * Thrown when a quantum key cannot be found or has an unexpected state.
 */
export class KeyNotFoundError extends Error {
  public readonly code = 'KEY_NOT_FOUND';
  constructor(keyId: string) {
    super(`Quantum key '${keyId}' not found or unavailable.`);
    this.name = 'KeyNotFoundError';
    Object.setPrototypeOf(this, KeyNotFoundError.prototype);
  }
}

/**
 * Thrown when attempting to use a key that has already been consumed.
 * This is a critical security invariant — OTP key reuse is strictly forbidden.
 */
export class KeyAlreadyConsumedError extends Error {
  public readonly code = 'KEY_ALREADY_CONSUMED';
  constructor(keyId: string) {
    super(
      `Security violation: Quantum key '${keyId}' has already been consumed and cannot be reused. ` +
        `OTP key material is strictly single-use. Request a new key from the QKM.`,
    );
    this.name = 'KeyAlreadyConsumedError';
    Object.setPrototypeOf(this, KeyAlreadyConsumedError.prototype);
  }
}

/**
 * Thrown when the QKM is unavailable and cannot provide key material.
 */
export class QkmUnavailableError extends Error {
  public readonly code = 'QKM_UNAVAILABLE';
  constructor(reason?: string) {
    super(`Quantum Key Manager is unavailable${reason ? ': ' + reason : ''}. Cannot establish encrypted session.`);
    this.name = 'QkmUnavailableError';
    Object.setPrototypeOf(this, QkmUnavailableError.prototype);
  }
}
