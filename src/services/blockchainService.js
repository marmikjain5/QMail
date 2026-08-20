import { ethers } from "ethers";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AppError } from "../lib/errors.js";

console.log('[blockchainService] Module loaded');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = "http://127.0.0.1:8545";
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function getContractAddress() {
  try {
    const deploymentPath = path.join(__dirname, "..", "..", "contracts", "deployment.json");
    if (fs.existsSync(deploymentPath)) {
      const data = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      if (data.contractAddress && data.contractAddress.startsWith("0x")) {
        return data.contractAddress;
      }
    }
  } catch (err) {
    console.warn("[blockchainService] Could not read deployment.json:", err.message);
  }
  return "0x5FbDB2315678afecb367f032d93F642f64180aa3";
}

function saveContractAddress(address) {
  try {
    const deploymentPath = path.join(__dirname, "..", "..", "contracts", "deployment.json");
    fs.writeFileSync(deploymentPath, JSON.stringify({ contractAddress: address }, null, 2));
  } catch (err) {
    console.warn("[blockchainService] Failed to write deployment.json:", err.message);
  }
}

const ABI = [
  "function registerAttachment(bytes32 attachmentId, string ipfsCid, bytes32 contentHash, bytes32 keyIdHash, uint8 securityLevel) external",
  "function verifyAttachment(bytes32 attachmentId, bytes32 contentHash) external view returns (bool valid, uint256 timestamp, uint8 securityLevel, string memory ipfsCid, bytes32 keyIdHash)",
  "function getAttachment(bytes32 attachmentId) external view returns (bool exists, bytes32 contentHash, bytes32 keyIdHash, uint8 securityLevel, uint256 timestamp, string memory ipfsCid)",
  "event AttachmentRegistered(bytes32 indexed attachmentId, string ipfsCid, bytes32 contentHash, bytes32 keyIdHash, uint8 securityLevel, uint256 timestamp)"
];

const HARDHAT_NETWORK = ethers.Network.from(31337);

function getProvider() {
  const req = new ethers.FetchRequest(RPC_URL);
  req.timeout = 4000;
  return new ethers.JsonRpcProvider(req, HARDHAT_NETWORK, { staticNetwork: HARDHAT_NETWORK });
}

function getWallet() {
  return new ethers.Wallet(PRIVATE_KEY, getProvider());
}

export async function ensureContractDeployed() {
  const p = getProvider();
  let addr = getContractAddress();
  try {
    const code = await p.getCode(addr);
    if (code && code !== "0x" && code !== "0x0") {
      return addr;
    }
  } catch (err) {
    console.warn("[blockchainService] Local RPC check warning:", err.message);
  }

  // Contract bytecode missing at target address — auto-deploy to local Hardhat node
  console.log(`[blockchainService] Contract bytecode not found at ${addr}. Auto-deploying QuMailAttachmentRegistry to local Hardhat node...`);
  const artifactPath = path.join(__dirname, "..", "..", "artifacts", "contracts", "QuMailAttachmentRegistry.sol", "QuMailAttachmentRegistry.json");
  if (!fs.existsSync(artifactPath)) {
    throw new AppError("Smart contract artifact missing. Run npx hardhat compile.", 500);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const w = getWallet();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  addr = await contract.getAddress();
  console.log(`[blockchainService] QuMailAttachmentRegistry auto-deployed to: ${addr}`);
  saveContractAddress(addr);
  return addr;
}

async function getWriteContract() {
  const addr = await ensureContractDeployed();
  const w = getWallet();
  return new ethers.Contract(addr, ABI, w);
}

async function getReadContract() {
  const addr = await ensureContractDeployed();
  return new ethers.Contract(addr, ABI, getProvider());
}

export function bytes32FromHex(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length !== 64) {
    throw new AppError("Invalid bytes32 hex string", 400);
  }
  return "0x" + hex;
}

export function computeAttachmentId(messageId, attachmentIndex) {
  const hash = crypto.createHash("sha256").update(`${messageId}:${attachmentIndex}`).digest("hex");
  return "0x" + hash;
}

export function computeContentHash(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return "0x" + hash;
}

export function computeKeyIdHash(keyId) {
  const hash = crypto.createHash("sha256").update(keyId || "ephemeral").digest("hex");
  return "0x" + hash;
}

export function securityLevelToUint8(level) {
  switch (level) {
    case "STANDARD": return 1;
    case "QUANTUM_AES": return 2;
    case "QUANTUM_OTP": return 3;
    default: return 0;
  }
}

export async function registerAttachment({
  attachmentId,
  ipfsCid = "",
  contentHash,
  keyIdHash,
  securityLevel
}) {
  const addr = await ensureContractDeployed();
  const w = getWallet();
  const p = getProvider();
  const nonce = await p.getTransactionCount(w.address, "pending");
  const contract = new ethers.Contract(addr, ABI, w);
  const tx = await contract.registerAttachment(
    attachmentId,
    ipfsCid,
    contentHash,
    keyIdHash,
    securityLevel,
    { nonce }
  );
  const receipt = await tx.wait();
  console.log(`[blockchainService] Attachment registered on-chain. TX: ${receipt.hash}, Block: ${receipt.blockNumber}`);
  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString()
  };
}

export async function verifyAttachment(attachmentId, contentHash) {
  try {
    const contract = await getReadContract();
    const result = await contract.verifyAttachment(attachmentId, contentHash);
    return {
      valid: result[0],
      timestamp: Number(result[1]),
      securityLevel: Number(result[2]),
      ipfsCid: result[3],
      keyIdHash: result[4]
    };
  } catch (err) {
    console.warn("[blockchainService] verifyAttachment error:", err.message);
    return {
      valid: false,
      timestamp: 0,
      securityLevel: 0,
      ipfsCid: "",
      keyIdHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
    };
  }
}

export async function getAttachmentOnChain(attachmentId) {
  try {
    const contract = await getReadContract();
    const result = await contract.getAttachment(attachmentId);
    return {
      exists: result[0],
      contentHash: result[1],
      keyIdHash: result[2],
      securityLevel: Number(result[3]),
      timestamp: Number(result[4]),
      ipfsCid: result[5]
    };
  } catch (err) {
    console.warn("[blockchainService] getAttachmentOnChain error:", err.message);
    return {
      exists: false,
      contentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      keyIdHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      securityLevel: 0,
      timestamp: 0,
      ipfsCid: ""
    };
  }
}

export async function getAttachmentEvent(attachmentId) {
  const contract = await getReadContract();
  const filter = contract.filters.AttachmentRegistered(attachmentId);
  const events = await contract.queryFilter(filter);
  if (events.length === 0) return null;
  const event = events[0];
  return {
    attachmentId: event.args.attachmentId,
    ipfsCid: event.args.ipfsCid,
    contentHash: event.args.contentHash,
    keyIdHash: event.args.keyIdHash,
    securityLevel: Number(event.args.securityLevel),
    timestamp: Number(event.args.timestamp),
    transactionHash: event.transactionHash,
    blockNumber: event.blockNumber
  };
}

const CONTRACT_ADDRESS = getContractAddress();
export { CONTRACT_ADDRESS, getContractAddress, RPC_URL };