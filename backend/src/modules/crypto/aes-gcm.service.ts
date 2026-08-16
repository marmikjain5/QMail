import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { DecryptInput, DecryptResult, IEncryptionService } from './interfaces.js';
import { AuthTagVerificationError } from './errors.js';

/**
 * AES-256-GCM authenticated encryption service.
 *
 * Security properties:
 * - 256-bit key provides computational security against known brute-force attacks.
 * - GCM mode provides both confidentiality and authenticated integrity (AEAD).
 * - A fresh 96-bit (12-byte) random IV is generated per encryption call.
 *   IV reuse under the same key is catastrophic for GCM security — this
 *   implementation prevents reuse by design (stateless, random IV every call).
 * - Authentication tag is 128 bits (16 bytes), providing strong tamper detection.
 * - Key buffers are explicitly zeroed immediately after use to minimise
 *   the window of exposure in application memory.
 */
export class AesGcmService
  implements
    Pick<IEncryptionService, 'encryptAesGcm' | 'decryptAesGcm'>
{
  private static readonly IV_LENGTH = 12; // 96 bits — NIST recommended for GCM
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits
  private static readonly ALGORITHM = 'aes-256-gcm' as const;

  /**
   * Encrypt plaintext using AES-256-GCM.
   *
   * @param plaintext - The raw bytes to encrypt.
   * @param keyMaterial - 32-byte (256-bit) key. WILL BE ZEROED after use.
   * @param additionalData - Optional AAD string for binding ciphertext to metadata.
   */
  async encryptAesGcm(
    plaintext: Buffer,
    keyMaterial: Buffer,
    additionalData?: string,
  ): Promise<{
    ciphertextBase64: string;
    ivBase64: string;
    authTagBase64: string;
    algorithm: 'AES-256-GCM';
  }> {
    if (keyMaterial.length !== 32) {
      throw new Error(
        `AES-256-GCM requires a 32-byte key. Received ${keyMaterial.length} bytes.`,
      );
    }

    // Generate a fresh random IV for every encryption operation
    const iv = randomBytes(AesGcmService.IV_LENGTH);

    try {
      const cipher = createCipheriv(
        AesGcmService.ALGORITHM,
        keyMaterial,
        iv,
        { authTagLength: AesGcmService.AUTH_TAG_LENGTH },
      );

      // Bind the ciphertext to message metadata via AAD
      // This prevents ciphertext being replayed with different metadata
      if (additionalData) {
        cipher.setAAD(Buffer.from(additionalData, 'utf8'));
      }

      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      return {
        ciphertextBase64: encrypted.toString('base64'),
        ivBase64: iv.toString('base64'),
        authTagBase64: authTag.toString('base64'),
        algorithm: 'AES-256-GCM',
      };
    } finally {
      // Zero the key material immediately after use
      keyMaterial.fill(0);
    }
  }

  /**
   * Decrypt and authenticate AES-256-GCM ciphertext.
   * Throws AuthTagVerificationError if authentication fails.
   *
   * @param input - Decryption parameters including Base64-encoded ciphertext, IV, authTag, and key.
   * @param additionalData - Must match the AAD used during encryption.
   */
  async decryptAesGcm(
    input: DecryptInput,
    additionalData?: string,
  ): Promise<DecryptResult> {
    if (!input.ivBase64 || !input.authTagBase64) {
      throw new Error('AES-GCM decryption requires ivBase64 and authTagBase64');
    }

    const keyMaterial = Buffer.from(input.keyMaterialBase64, 'base64');
    const iv = Buffer.from(input.ivBase64, 'base64');
    const authTag = Buffer.from(input.authTagBase64, 'base64');
    const ciphertext = Buffer.from(input.ciphertextBase64, 'base64');

    try {
      const decipher = createDecipheriv(
        AesGcmService.ALGORITHM,
        keyMaterial,
        iv,
        { authTagLength: AesGcmService.AUTH_TAG_LENGTH },
      );

      decipher.setAuthTag(authTag);

      if (additionalData) {
        decipher.setAAD(Buffer.from(additionalData, 'utf8'));
      }

      try {
        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(), // throws if auth tag is invalid
        ]);

        return { plaintextBuffer: decrypted, verified: true };
      } catch {
        throw new AuthTagVerificationError();
      }
    } finally {
      keyMaterial.fill(0);
    }
  }
}
