import { ethers } from 'ethers';
import { config } from '../../config/env.js';

// ABI for QuMailAttachmentRegistry — only the functions we call
const REGISTRY_ABI = [
  'function registerAttachment(bytes32 _attachmentId, string calldata _ipfsCID, bytes32 _contentSha256, bytes32 _keyIdHash, uint8 _securityLevel) external',
  'function verifyAttachment(bytes32 _attachmentId, bytes32 _contentSha256) external view returns (bool isValid, string memory ipfsCID, uint256 timestamp)',
  'function getRecord(bytes32 _attachmentId) external view returns (tuple(string ipfsCID, bytes32 contentSha256, bytes32 keyIdHash, uint8 securityLevel, uint256 timestamp, address registeredBy) record)',
  'event AttachmentRegistered(bytes32 indexed attachmentId, string ipfsCID, bytes32 contentSha256, uint8 securityLevel, uint256 timestamp, address indexed registeredBy)',
] as const;

interface VerifyResult {
  isValid: boolean;
  timestamp?: Date;
  blockchainCid?: string;
}

/**
 * Blockchain Registry Client for QuMail Attachment Registry.
 *
 * Uses ethers.js v6 to interact with the QuMailAttachmentRegistry
 * Solidity smart contract deployed on a local Hardhat node.
 *
 * When the contract address is not configured, operates in mock mode:
 * all registrations succeed with fake transaction hashes and all
 * verifications return true. This allows development without a
 * running blockchain node.
 */
export class BlockchainRegistryClient {
  private readonly mockMode: boolean;
  private provider?: ethers.JsonRpcProvider;
  private signer?: ethers.Wallet;
  private contract?: ethers.Contract;

  // Mock store: attachmentId → {sha256, cid}
  private readonly mockRegistry = new Map<
    string,
    { sha256: string; cid: string; timestamp: Date }
  >();

  constructor() {
    this.mockMode = !config.REGISTRY_CONTRACT_ADDRESS || !config.REGISTRY_DEPLOYER_PRIVATE_KEY;

    if (this.mockMode) {
      console.warn(
        '[BlockchainRegistry] Contract not configured — using mock mode. ' +
          'Set REGISTRY_CONTRACT_ADDRESS and REGISTRY_DEPLOYER_PRIVATE_KEY to use the real contract.',
      );
    } else {
      this.initialize();
    }
  }

  private initialize(): void {
    try {
      this.provider = new ethers.JsonRpcProvider(config.BLOCKCHAIN_RPC_URL);
      this.signer = new ethers.Wallet(config.REGISTRY_DEPLOYER_PRIVATE_KEY, this.provider);
      this.contract = new ethers.Contract(
        config.REGISTRY_CONTRACT_ADDRESS,
        REGISTRY_ABI,
        this.signer,
      );
      console.log(
        `[BlockchainRegistry] Connected to contract at ${config.REGISTRY_CONTRACT_ADDRESS}`,
      );
    } catch (err) {
      console.error('[BlockchainRegistry] Failed to initialize — falling back to mock mode:', err);
    }
  }

  /**
   * Register an encrypted attachment on the blockchain.
   *
   * @param attachmentId - UUID of the attachment
   * @param ipfsCid     - IPFS Content Identifier of the encrypted blob
   * @param sha256Hex   - SHA-256 hex hash of the encrypted blob
   * @param keyId       - Key ID used for encryption (hashed before storing)
   * @param securityLevel - 2 (AES) or 3 (OTP)
   */
  async registerAttachment(
    attachmentId: string,
    ipfsCid: string,
    sha256Hex: string,
    keyId: string,
    securityLevel: number,
  ): Promise<{ txHash: string; blockNumber: number }> {
    if (this.mockMode || !this.contract) {
      return this.mockRegister(attachmentId, ipfsCid, sha256Hex);
    }

    try {
      const attachmentIdBytes32 = this.toBytes32(attachmentId);
      const sha256Bytes32 = ethers.hexlify(Buffer.from(sha256Hex.substring(0, 64).padEnd(64, '0'), 'hex')) as `0x${string}`;
      const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes(keyId)) as `0x${string}`;

      const tx = await this.contract['registerAttachment'](
        attachmentIdBytes32,
        ipfsCid,
        sha256Bytes32,
        keyIdHash,
        securityLevel,
      );

      const receipt = await (tx as ethers.TransactionResponse).wait();

      return {
        txHash: receipt?.hash ?? tx.hash,
        blockNumber: receipt?.blockNumber ?? 0,
      };
    } catch (err) {
      console.error('[BlockchainRegistry] Registration failed:', err);
      throw new Error(`Blockchain registration failed: ${(err as Error).message}`);
    }
  }

  /**
   * Verify an attachment's integrity against the blockchain record.
   *
   * @param attachmentId - UUID of the attachment
   * @param sha256Hex   - SHA-256 hex hash to verify against the stored hash
   */
  async verifyAttachment(
    attachmentId: string,
    sha256Hex: string,
  ): Promise<VerifyResult> {
    if (this.mockMode || !this.contract) {
      return this.mockVerify(attachmentId, sha256Hex);
    }

    try {
      const attachmentIdBytes32 = this.toBytes32(attachmentId);
      const sha256Bytes32 = ethers.hexlify(
        Buffer.from(sha256Hex.substring(0, 64).padEnd(64, '0'), 'hex'),
      );

      const [isValid, ipfsCid, timestamp] = await this.contract['verifyAttachment'](
        attachmentIdBytes32,
        sha256Bytes32,
      ) as [boolean, string, bigint];

      return {
        isValid,
        blockchainCid: ipfsCid,
        timestamp: timestamp > 0n ? new Date(Number(timestamp) * 1000) : undefined,
      };
    } catch (err) {
      console.error('[BlockchainRegistry] Verification failed:', err);
      return { isValid: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toBytes32(str: string): string {
    const bytes = ethers.toUtf8Bytes(str);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return ethers.hexlify(padded);
  }

  private mockRegister(
    attachmentId: string,
    ipfsCid: string,
    sha256Hex: string,
  ): { txHash: string; blockNumber: number } {
    this.mockRegistry.set(attachmentId, {
      sha256: sha256Hex,
      cid: ipfsCid,
      timestamp: new Date(),
    });
    const fakeTxHash = `0x${Buffer.from(attachmentId).toString('hex').padEnd(64, '0')}`;
    return { txHash: fakeTxHash, blockNumber: Math.floor(Math.random() * 100_000) };
  }

  private mockVerify(attachmentId: string, sha256Hex: string): VerifyResult {
    const record = this.mockRegistry.get(attachmentId);
    if (!record) return { isValid: false };
    return {
      isValid: record.sha256 === sha256Hex,
      blockchainCid: record.cid,
      timestamp: record.timestamp,
    };
  }
}
