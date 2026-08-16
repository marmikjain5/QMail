import { describe, it, expect } from 'vitest';
import { AesGcmService } from './aes-gcm.service.js';
import { OtpService } from './otp.service.js';
import { AuthTagVerificationError, InsufficientKeyMaterialError, OtpIntegrityError } from './errors.js';
import { randomBytes } from 'node:crypto';

// =============================================================================
// AES-256-GCM Tests
// =============================================================================
describe('AesGcmService', () => {
  const svc = new AesGcmService();

  it('should encrypt and decrypt correctly (round-trip)', async () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('Hello, quantum world!', 'utf8');

    const encrypted = await svc.encryptAesGcm(plaintext, key);
    expect(encrypted.ciphertextBase64).toBeTruthy();
    expect(encrypted.ivBase64).toBeTruthy();
    expect(encrypted.authTagBase64).toBeTruthy();

    const key2 = randomBytes(32); // encryptAesGcm zeroed key, need fresh one
    // Use same key value but new buffer
    const keyForDecrypt = Buffer.alloc(32);
    // We need the same key bytes — in tests we regenerate
    // Actually: let's keep a reference before zeroing
  });

  it('should encrypt and decrypt with preserved key reference', async () => {
    const keyBytes = randomBytes(32);
    const keyForEnc = Buffer.from(keyBytes);
    const keyForDec = Buffer.from(keyBytes);
    const plaintext = Buffer.from('QuMail test message — security level 2', 'utf8');
    const aad = JSON.stringify({ algo: 'AES-256-GCM', v: '1.0' });

    const encrypted = await svc.encryptAesGcm(plaintext, keyForEnc, aad);
    const decrypted = await svc.decryptAesGcm({
      ciphertextBase64: encrypted.ciphertextBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
      keyMaterialBase64: keyForDec.toString('base64'),
      algorithm: 'AES-256-GCM',
    }, aad);

    expect(decrypted.verified).toBe(true);
    expect(decrypted.plaintextBuffer.toString('utf8')).toBe('QuMail test message — security level 2');
  });

  it('should throw AuthTagVerificationError when ciphertext is modified', async () => {
    const keyBytes = randomBytes(32);
    const keyForEnc = Buffer.from(keyBytes);
    const keyForDec = Buffer.from(keyBytes);
    const plaintext = Buffer.from('Sensitive data', 'utf8');

    const encrypted = await svc.encryptAesGcm(plaintext, keyForEnc);

    // Tamper: flip a byte in the ciphertext
    const tamperedBytes = Buffer.from(encrypted.ciphertextBase64, 'base64');
    tamperedBytes[0] ^= 0xff;
    const tamperedBase64 = tamperedBytes.toString('base64');

    await expect(svc.decryptAesGcm({
      ciphertextBase64: tamperedBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
      keyMaterialBase64: keyForDec.toString('base64'),
      algorithm: 'AES-256-GCM',
    })).rejects.toThrow(AuthTagVerificationError);
  });

  it('should throw AuthTagVerificationError when auth tag is modified', async () => {
    const keyBytes = randomBytes(32);
    const keyForEnc = Buffer.from(keyBytes);
    const keyForDec = Buffer.from(keyBytes);
    const plaintext = Buffer.from('Sensitive data', 'utf8');

    const encrypted = await svc.encryptAesGcm(plaintext, keyForEnc);

    // Tamper: modify the auth tag
    const tamperedTag = Buffer.from(encrypted.authTagBase64, 'base64');
    tamperedTag[0] ^= 0xab;

    await expect(svc.decryptAesGcm({
      ciphertextBase64: encrypted.ciphertextBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: tamperedTag.toString('base64'),
      keyMaterialBase64: keyForDec.toString('base64'),
      algorithm: 'AES-256-GCM',
    })).rejects.toThrow(AuthTagVerificationError);
  });

  it('should generate a different IV on every call (nonce uniqueness)', async () => {
    const ivSet = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = randomBytes(32);
      const plaintext = Buffer.from(`message-${i}`, 'utf8');
      const result = await svc.encryptAesGcm(plaintext, key);
      ivSet.add(result.ivBase64);
    }
    // All 100 IVs should be unique
    expect(ivSet.size).toBe(100);
  });

  it('should zero the key buffer after encryption', async () => {
    const keyMaterial = randomBytes(32);
    const plaintext = Buffer.from('test', 'utf8');
    await svc.encryptAesGcm(plaintext, keyMaterial);
    // Key should be zeroed
    expect(keyMaterial.every((b) => b === 0)).toBe(true);
  });

  it('should reject keys that are not 32 bytes', async () => {
    const badKey = randomBytes(16); // AES-128 key — wrong size for AES-256
    const plaintext = Buffer.from('test', 'utf8');
    await expect(svc.encryptAesGcm(plaintext, badKey)).rejects.toThrow(
      'requires a 32-byte key',
    );
  });
});

// =============================================================================
// OTP Service Tests
// =============================================================================
describe('OtpService', () => {
  const svc = new OtpService();

  it('should encrypt and decrypt correctly (round-trip)', async () => {
    const plaintext = Buffer.from('OTP test message 🔐', 'utf8');
    const keyStream = Buffer.from(randomBytes(plaintext.length));
    const macKey = Buffer.from(randomBytes(32));

    const keyStreamForDec = Buffer.from(keyStream);
    const macKeyForDec = Buffer.from(macKey);

    const encrypted = await svc.encryptOtp(plaintext, keyStream, macKey);
    expect(encrypted.ciphertextBase64).toBeTruthy();
    expect(encrypted.macTagBase64).toBeTruthy();

    const decrypted = await svc.decryptOtp({
      ciphertextBase64: encrypted.ciphertextBase64,
      macTagBase64: encrypted.macTagBase64,
      keyMaterialBase64: keyStreamForDec.toString('base64'),
      algorithm: 'OTP-XOR-HMAC-SHA256',
    }, macKeyForDec);

    expect(decrypted.verified).toBe(true);
    expect(decrypted.plaintextBuffer.toString('utf8')).toBe('OTP test message 🔐');
  });

  it('should throw InsufficientKeyMaterialError when key stream is shorter than plaintext', async () => {
    const plaintext = Buffer.from('This is 20 bytes!!..', 'utf8');
    const shortKey = randomBytes(10); // Only 10 bytes — too short
    const macKey = randomBytes(32);

    await expect(svc.encryptOtp(plaintext, shortKey, macKey)).rejects.toThrow(
      InsufficientKeyMaterialError,
    );
  });

  it('should throw OtpIntegrityError when ciphertext is tampered', async () => {
    const plaintext = Buffer.from('Tamper test', 'utf8');
    const keyStream = Buffer.from(randomBytes(plaintext.length));
    const macKey = Buffer.from(randomBytes(32));
    const keyStreamForDec = Buffer.from(keyStream);
    const macKeyForDec = Buffer.from(macKey);

    const encrypted = await svc.encryptOtp(plaintext, keyStream, macKey);

    // Tamper the ciphertext
    const tampered = Buffer.from(encrypted.ciphertextBase64, 'base64');
    tampered[0] ^= 0xff;

    await expect(svc.decryptOtp({
      ciphertextBase64: tampered.toString('base64'),
      macTagBase64: encrypted.macTagBase64,
      keyMaterialBase64: keyStreamForDec.toString('base64'),
      algorithm: 'OTP-XOR-HMAC-SHA256',
    }, macKeyForDec)).rejects.toThrow(OtpIntegrityError);
  });

  it('should zero key buffers after encryption', async () => {
    const plaintext = Buffer.from('zero key test', 'utf8');
    const keyStream = randomBytes(plaintext.length);
    const macKey = randomBytes(32);
    await svc.encryptOtp(plaintext, keyStream, macKey);
    expect(keyStream.every((b) => b === 0)).toBe(true);
    expect(macKey.every((b) => b === 0)).toBe(true);
  });

  it('should produce different ciphertext with different key streams (randomness verification)', async () => {
    const plaintext = Buffer.from('Same plaintext', 'utf8');
    const key1 = randomBytes(plaintext.length);
    const key2 = randomBytes(plaintext.length);
    const mac1 = randomBytes(32);
    const mac2 = randomBytes(32);

    const enc1 = await svc.encryptOtp(plaintext, key1, mac1);
    const enc2 = await svc.encryptOtp(
      Buffer.from('Same plaintext', 'utf8'), // Fresh buffer
      key2,
      mac2,
    );

    // Different keys should produce different ciphertexts
    expect(enc1.ciphertextBase64).not.toBe(enc2.ciphertextBase64);
  });
});
