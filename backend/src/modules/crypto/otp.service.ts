import { createHmac } from 'node:crypto';
import type { DecryptInput, DecryptResult, IEncryptionService } from './interfaces.js';
import { InsufficientKeyMaterialError, OtpIntegrityError } from './errors.js';

/**
 * One-Time Pad encryption service.
 *
 * Security properties:
 * - When strict OTP requirements are satisfied, OTP encryption achieves
 *   information-theoretic (unconditional) secrecy — it is provably secure
 *   against adversaries with unlimited computational resources.
 *
 * Strict OTP requirements (Shannon, 1949):
 *   1. Key length ≥ plaintext length (enforced by this implementation).
 *   2. Key material must never be reused (enforced by QKM key lifecycle).
 *   3. Key material must be truly random (provided by QKM via CSPRNG).
 *
 * Integrity note:
 *   Pure XOR encryption is malleable — an attacker who can flip plaintext bits
 *   can flip corresponding ciphertext bits without detection. To address this,
 *   this implementation adds HMAC-SHA256 over the ciphertext using a SEPARATE
 *   key slice from the QKM pool. The MAC key is NOT derived from the OTP key
 *   stream to preserve information-theoretic independence.
 *
 * Encryption: C[i] = P[i] XOR K_otp[i]
 * Integrity:  MacTag = HMAC-SHA256(K_mac, C)
 */
export class OtpService
  implements Pick<IEncryptionService, 'encryptOtp' | 'decryptOtp'>
{
  /**
   * Encrypt plaintext using One-Time Pad XOR.
   *
   * @param plaintext  - The raw bytes to encrypt.
   * @param keyStream  - OTP key stream. MUST have length === plaintext.length. WILL BE ZEROED.
   * @param macKey     - Separate 32-byte key for HMAC-SHA256 integrity. WILL BE ZEROED.
   */
  async encryptOtp(
    plaintext: Buffer,
    keyStream: Buffer,
    macKey: Buffer,
  ): Promise<{
    ciphertextBase64: string;
    macTagBase64: string;
    algorithm: 'OTP-XOR-HMAC-SHA256';
  }> {
    if (keyStream.length < plaintext.length) {
      throw new InsufficientKeyMaterialError(keyStream.length, plaintext.length);
    }

    try {
      // XOR each byte of plaintext with the corresponding key stream byte
      const ciphertext = Buffer.allocUnsafe(plaintext.length);
      for (let i = 0; i < plaintext.length; i++) {
        ciphertext[i] = plaintext[i] ^ keyStream[i];
      }

      // Compute HMAC-SHA256 over the ciphertext for integrity protection
      const macTag = createHmac('sha256', macKey)
        .update(ciphertext)
        .digest('base64');

      return {
        ciphertextBase64: ciphertext.toString('base64'),
        macTagBase64: macTag,
        algorithm: 'OTP-XOR-HMAC-SHA256',
      };
    } finally {
      keyStream.fill(0);
      macKey.fill(0);
    }
  }

  /**
   * Decrypt OTP ciphertext. Verifies HMAC-SHA256 BEFORE decrypting.
   * Throws OtpIntegrityError if MAC check fails.
   *
   * @param input   - Decryption parameters.
   * @param macKey  - The HMAC key used during encryption. WILL BE ZEROED.
   */
  async decryptOtp(input: DecryptInput, macKey: Buffer): Promise<DecryptResult> {
    if (!input.macTagBase64) {
      throw new Error('OTP decryption requires macTagBase64');
    }

    const keyStream = Buffer.from(input.keyMaterialBase64, 'base64');
    const ciphertext = Buffer.from(input.ciphertextBase64, 'base64');

    try {
      // Verify MAC FIRST before any decryption (fail fast on tampered ciphertext)
      const expectedMacTag = createHmac('sha256', macKey)
        .update(ciphertext)
        .digest('base64');

      // Constant-time comparison to prevent timing attacks
      if (!this.constantTimeEqual(expectedMacTag, input.macTagBase64)) {
        throw new OtpIntegrityError();
      }

      if (keyStream.length < ciphertext.length) {
        throw new InsufficientKeyMaterialError(keyStream.length, ciphertext.length);
      }

      // XOR each byte of ciphertext with the corresponding key stream byte
      const plaintext = Buffer.allocUnsafe(ciphertext.length);
      for (let i = 0; i < ciphertext.length; i++) {
        plaintext[i] = ciphertext[i] ^ keyStream[i];
      }

      return { plaintextBuffer: plaintext, verified: true };
    } finally {
      keyStream.fill(0);
      macKey.fill(0);
    }
  }

  /**
   * Constant-time string comparison to prevent timing side-channel attacks.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
