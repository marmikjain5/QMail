import { AesGcmService } from './aes-gcm.service.js';
import { OtpService } from './otp.service.js';
import type { DecryptInput, DecryptResult, EncryptResult } from './interfaces.js';
import { SecurityLevel } from './interfaces.js';

/**
 * Facade encryption service that delegates to the appropriate cipher
 * based on the requested security level.
 *
 * This class is the single entry point for all cryptographic operations
 * in QuMail. It enforces the selection of the correct algorithm and
 * prevents any mixing of cipher engines with security level selection logic.
 */
export class CryptoService {
  constructor(
    private readonly aesGcm: AesGcmService,
    private readonly otp: OtpService,
  ) {}

  /**
   * Encrypt a buffer using the specified security level.
   *
   * @param plaintext     - Raw bytes to encrypt.
   * @param keyMaterial   - For AES: 32-byte key. For OTP: N-byte key stream (N = plaintext.length).
   * @param macKey        - For OTP only: separate 32-byte HMAC key. Ignored for AES.
   * @param level         - Security level (QUANTUM_AES or QUANTUM_OTP).
   * @param additionalData - Optional AAD for AES-GCM binding.
   */
  async encrypt(
    plaintext: Buffer,
    keyMaterial: Buffer,
    macKey: Buffer | null,
    level: SecurityLevel.QUANTUM_AES | SecurityLevel.QUANTUM_OTP,
    additionalData?: string,
  ): Promise<Omit<EncryptResult, 'keyConsumedBytes'>> {
    if (level === SecurityLevel.QUANTUM_AES) {
      const result = await this.aesGcm.encryptAesGcm(plaintext, keyMaterial, additionalData);
      return {
        ...result,
        macTagBase64: '',
      };
    } else {
      if (!macKey) {
        throw new Error('OTP encryption requires a separate macKey for HMAC integrity.');
      }
      const result = await this.otp.encryptOtp(plaintext, keyMaterial, macKey);
      return {
        ...result,
        ivBase64: '',
        authTagBase64: '',
      };
    }
  }

  /**
   * Decrypt a buffer using the specified algorithm.
   * For AES-GCM: throws AuthTagVerificationError on tampering.
   * For OTP: throws OtpIntegrityError on MAC failure.
   *
   * @param input    - Decryption input parameters.
   * @param level    - Security level.
   * @param macKey   - For OTP only: HMAC key used during encryption. WILL BE ZEROED.
   * @param additionalData - For AES only: AAD used during encryption.
   */
  async decrypt(
    input: DecryptInput,
    level: SecurityLevel.QUANTUM_AES | SecurityLevel.QUANTUM_OTP,
    macKey?: Buffer,
    additionalData?: string,
  ): Promise<DecryptResult> {
    if (level === SecurityLevel.QUANTUM_AES) {
      return this.aesGcm.decryptAesGcm(input, additionalData);
    } else {
      if (!macKey) {
        throw new Error('OTP decryption requires a macKey for HMAC verification.');
      }
      return this.otp.decryptOtp(input, macKey);
    }
  }
}

// Singleton instance (created in main.ts and injected where needed)
export { AesGcmService, OtpService };
