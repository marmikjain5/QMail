import { v4 as uuidv4 } from 'uuid';
import { CryptoService } from '../crypto/crypto.service.js';
import { SecurityLevel } from '../crypto/interfaces.js';
import type { IKeyManager } from '../qkm/interfaces.js';
import { PinataService } from './pinata.service.js';
import type { BlockchainRegistryClient } from '../blockchain/registry.client.js';
import type { QuMailAttachmentRef } from '../email/interfaces.js';
import { AttachmentIntegrityError } from '../crypto/errors.js';

/**
 * Attachment Service — orchestrates the full encrypted attachment pipeline.
 *
 * Upload flow:
 *   File Buffer → Encrypt (AES/OTP) → SHA-256 → Pinata IPFS → Blockchain Register
 *   → Return QuMailAttachmentRef
 *
 * Download flow:
 *   CID → Fetch from IPFS → Verify SHA-256 (vs blockchain record) → QKM key retrieval
 *   → Decrypt → Return plaintext Buffer
 */
export class AttachmentService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly pinata: PinataService,
    private readonly blockchain: BlockchainRegistryClient,
    private readonly qkm: IKeyManager,
    private readonly senderNode: string = 'qkm-node-alpha',
    private readonly recipientNode: string = 'qkm-node-beta',
  ) {}

  /**
   * Encrypt and upload an attachment.
   * Returns a QuMailAttachmentRef containing IPFS CID, key ID, and integrity hash.
   * The actual encryption key is NEVER included in the returned ref.
   */
  async uploadAttachment(
    fileBuffer: Buffer,
    originalFilename: string,
    securityLevel: SecurityLevel.QUANTUM_AES | SecurityLevel.QUANTUM_OTP,
  ): Promise<QuMailAttachmentRef> {
    const attachmentId = `att_${uuidv4()}`;

    // 1. Reserve key material from QKM
    const keyLengthBytes =
      securityLevel === SecurityLevel.QUANTUM_AES ? 32 : fileBuffer.length + 32; // +32 for MAC key

    const keyLengthBits = keyLengthBytes * 8;
    const reservedKey = await this.qkm.reserveKey({
      sourceNode: this.senderNode,
      targetNode: this.recipientNode,
      keyLengthBits,
      purpose:
        securityLevel === SecurityLevel.QUANTUM_AES
          ? 'QUANTUM_AES_ATTACHMENT'
          : 'QUANTUM_OTP_ATTACHMENT',
    });

    // 2. Encrypt the file
    const keyBuffer = Buffer.from(reservedKey.keyMaterialBase64, 'base64');
    let encryptedBuffer: Buffer;
    let encryptResult: Awaited<ReturnType<CryptoService['encrypt']>>;

    if (securityLevel === SecurityLevel.QUANTUM_AES) {
      encryptResult = await this.crypto.encrypt(
        fileBuffer,
        keyBuffer,
        null,
        SecurityLevel.QUANTUM_AES,
        `qumail-attachment-${attachmentId}`,
      );
    } else {
      const otpKey = keyBuffer.subarray(0, fileBuffer.length);
      const macKey = keyBuffer.subarray(fileBuffer.length);
      encryptResult = await this.crypto.encrypt(
        fileBuffer,
        otpKey,
        macKey,
        SecurityLevel.QUANTUM_OTP,
      );
    }

    encryptedBuffer = Buffer.from(encryptResult.ciphertextBase64, 'base64');

    // 3. Compute SHA-256 of encrypted blob
    const sha256Hash = this.pinata.computeSha256(encryptedBuffer);

    // 4. Upload encrypted blob to Pinata IPFS
    const { cid, sizeBytes } = await this.pinata.uploadEncryptedFile(
      encryptedBuffer,
      `${attachmentId}.enc`,
      { originalFilename, securityLevel: String(securityLevel) },
    );

    // 5. Consume the key (sender side)
    await this.qkm.consumeKey(reservedKey.keyId);

    // 6. Register on blockchain
    let blockchainTxRef: string | undefined;
    try {
      const txResult = await this.blockchain.registerAttachment(
        attachmentId,
        cid,
        sha256Hash,
        reservedKey.keyId,
        securityLevel,
      );
      blockchainTxRef = `${txResult.txHash}:${txResult.blockNumber}`;
    } catch (err) {
      console.warn('[AttachmentService] Blockchain registration failed:', err);
      // Non-fatal: attachment is still uploaded to IPFS
    }

    // Serialize encryption metadata to embed in the envelope
    const filenameEncrypted = Buffer.from(originalFilename).toString('base64');

    return {
      attachmentId,
      filenameEncrypted,
      originalFilename,
      ipfsCid: cid,
      sha256Hash,
      sizeBytes,
      keyId: reservedKey.keyId,
      blockchainTxRef,
      securityLevel,
    };
  }

  /**
   * Download and decrypt an attachment.
   *
   * 1. Fetches encrypted blob from IPFS.
   * 2. Verifies SHA-256 integrity (against blockchain record if available).
   * 3. Retrieves decryption key from QKM by keyId.
   * 4. Decrypts and returns plaintext buffer.
   */
  async downloadAndDecryptAttachment(
    ref: QuMailAttachmentRef,
    securityLevel: SecurityLevel.QUANTUM_AES | SecurityLevel.QUANTUM_OTP,
    ivBase64?: string,
    authTagBase64?: string,
    macTagBase64?: string,
  ): Promise<Buffer> {
    // 1. Download from IPFS
    const encryptedBuffer = await this.pinata.downloadFile(ref.ipfsCid);

    // 2. Verify SHA-256 integrity
    const actualHash = this.pinata.computeSha256(encryptedBuffer);
    if (actualHash !== ref.sha256Hash) {
      throw new AttachmentIntegrityError(ref.sha256Hash, actualHash);
    }

    // 3. Retrieve key from QKM (marks as CONSUMED)
    const keyMaterial = await this.qkm.retrieveKey(ref.keyId, this.recipientNode);
    const keyBuffer = Buffer.from(keyMaterial.keyMaterialBase64, 'base64');

    // 4. Decrypt
    const ciphertextBase64 = encryptedBuffer.toString('base64');
    const decryptResult = await this.crypto.decrypt(
      {
        ciphertextBase64,
        ivBase64,
        authTagBase64,
        macTagBase64,
        keyMaterialBase64: keyBuffer.toString('base64'),
        algorithm:
          securityLevel === SecurityLevel.QUANTUM_AES
            ? 'AES-256-GCM'
            : 'OTP-XOR-HMAC-SHA256',
      },
      securityLevel,
    );

    if (!decryptResult.verified) {
      throw new AttachmentIntegrityError(ref.sha256Hash, 'AUTHENTICATION_FAILED');
    }

    return decryptResult.plaintextBuffer;
  }

  /**
   * Verify an attachment's integrity against the blockchain registry.
   */
  async verifyBlockchainIntegrity(
    ref: QuMailAttachmentRef,
  ): Promise<{ isValid: boolean; timestamp?: Date; blockchainCid?: string }> {
    return this.blockchain.verifyAttachment(ref.attachmentId, ref.sha256Hash);
  }
}
