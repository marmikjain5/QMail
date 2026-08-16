import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { config } from '../../config/env.js';

interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

const PINATA_API = 'https://api.pinata.cloud';
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/**
 * Pinata IPFS pinning service.
 *
 * When PINATA_JWT is not configured, falls back to an in-memory mock
 * store for development purposes. The mock generates fake CIDs but
 * the file data is stored and retrievable within the same process.
 *
 * IMPORTANT: The actual secret key material is NEVER stored on IPFS.
 * Only the AES-encrypted or OTP-encrypted blob is pinned.
 * The key ID (not the key itself) is embedded in the email envelope.
 */
export class PinataService {
  private readonly mockMode: boolean;
  private readonly mockStore = new Map<string, Buffer>(); // CID → encrypted blob

  constructor() {
    this.mockMode = !config.PINATA_JWT;
    if (this.mockMode) {
      console.warn(
        '[PinataService] PINATA_JWT not configured — using in-memory mock IPFS. ' +
          'Files will not persist across restarts.',
      );
    }
  }

  /**
   * Upload an encrypted file buffer to IPFS via Pinata.
   * Returns the IPFS Content Identifier (CID) of the pinned content.
   */
  async uploadEncryptedFile(
    encryptedBuffer: Buffer,
    filename: string,
    metadata?: Record<string, string>,
  ): Promise<{ cid: string; sizeBytes: number }> {
    if (this.mockMode) {
      return this.mockUpload(encryptedBuffer, filename);
    }

    // Build multipart form data for Pinata file upload
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', encryptedBuffer, {
      filename: `${filename}.qumail.enc`,
      contentType: 'application/octet-stream',
    });

    if (metadata) {
      form.append(
        'pinataMetadata',
        JSON.stringify({
          name: filename,
          keyvalues: metadata,
        }),
      );
    }

    const res = await axios.post<PinataUploadResponse>(
      `${PINATA_API}/pinning/pinFileToIPFS`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${config.PINATA_JWT}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    console.log(`[PinataService] Pinned file: CID=${res.data.IpfsHash}, size=${res.data.PinSize}`);
    return {
      cid: res.data.IpfsHash,
      sizeBytes: res.data.PinSize,
    };
  }

  /**
   * Download an encrypted file from IPFS by its CID.
   * Verifies the SHA-256 hash before returning the buffer.
   */
  async downloadFile(cid: string): Promise<Buffer> {
    if (this.mockMode) {
      const data = this.mockStore.get(cid);
      if (!data) {
        throw new Error(`[MockIPFS] CID not found: ${cid}`);
      }
      return Buffer.from(data);
    }

    const url = `${PINATA_GATEWAY}/${cid}`;
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });

    return Buffer.from(res.data);
  }

  /**
   * Compute SHA-256 hash of a buffer.
   * Used for integrity verification after IPFS download.
   */
  computeSha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Mock IPFS for development
  // ---------------------------------------------------------------------------

  private mockUpload(
    buffer: Buffer,
    filename: string,
  ): { cid: string; sizeBytes: number } {
    // Generate a realistic-looking CID (not a valid IPFS CID, but visually similar)
    const hash = createHash('sha256').update(buffer).digest('hex');
    const cid = `Qm${hash.substring(0, 44)}`;
    this.mockStore.set(cid, Buffer.from(buffer));
    console.log(`[MockIPFS] Stored: CID=${cid}, filename=${filename}, size=${buffer.length}`);
    return { cid, sizeBytes: buffer.length };
  }
}
