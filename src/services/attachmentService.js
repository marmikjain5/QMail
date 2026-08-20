import crypto from "node:crypto";

import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { uploadToPinata, fetchFromIpfs } from "./ipfsService.js";

export function encryptFileAes({ keyBase64, fileBuffer }) {
  const key = Buffer.from(keyBase64, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptFileAes({ keyBase64, ivBase64, ciphertextBase64, authTagBase64 }) {
  const key = Buffer.from(keyBase64, "base64");
  const iv = Buffer.from(ivBase64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final()
  ]);
}

export async function saveEncryptedAttachment({ messageRowId, filename, mimeType, fileBuffer, keyBase64 }) {
  const { iv, ciphertext, authTag } = encryptFileAes({ keyBase64, fileBuffer });
  const contentHash = "0x" + crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const supabase = getSupabase();

  // Create encrypted payload bundle to upload to Pinata IPFS
  const payload = {
    filename,
    mimeType,
    ciphertext_b64: ciphertext,
    nonce_b64: iv,
    auth_tag_b64: authTag,
    content_hash: contentHash
  };
  const encryptedPayloadBuffer = Buffer.from(JSON.stringify(payload, null, 2));

  // Attempt Pinata IPFS Upload
  let ipfsCid = null;
  let storageMode = "INLINE";

  const pinataRes = await uploadToPinata({
    filename: `${filename}.enc`,
    buffer: encryptedPayloadBuffer
  });

  if (pinataRes && pinataRes.ipfsCid) {
    ipfsCid = pinataRes.ipfsCid;
    storageMode = "IPFS";
    console.log(`[attachmentService] Attachment '${filename}' encrypted & uploaded to IPFS. CID: ${ipfsCid}`);
  } else {
    console.warn(`[attachmentService] IPFS upload unavailable/failed for '${filename}'. Storing encrypted inline.`);
  }

  const { data, error } = await supabase
    .from("message_attachments")
    .insert({
      message_id: messageRowId,
      filename,
      mime_type: mimeType,
      byte_size: fileBuffer.length,
      ciphertext_b64: ciphertext,
      nonce_b64: iv,
      auth_tag_b64: authTag,
      ipfs_cid: ipfsCid,
      content_hash: contentHash,
      storage_mode: storageMode
    })
    .select("id")
    .single();

  if (error) throw mapSupabaseError(error, "Failed to save attachment.");
  return { attachmentId: data.id, ipfsCid, contentHash };
}

export async function listAttachments(messageRowId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, filename, mime_type, byte_size, ipfs_cid, content_hash, storage_mode, created_at")
    .eq("message_id", messageRowId)
    .order("created_at", { ascending: true });
  if (error) throw mapSupabaseError(error, "Failed to list attachments.");
  return data;
}

export async function getDecryptedAttachment(attachmentId, keyBase64) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, filename, mime_type, byte_size, ciphertext_b64, nonce_b64, auth_tag_b64, ipfs_cid, content_hash, storage_mode")
    .eq("id", attachmentId)
    .single();

  if (error || !data) throw new AppError(`Attachment ${attachmentId} not found.`, 404);

  let ivBase64 = data.nonce_b64;
  let ciphertextBase64 = data.ciphertext_b64;
  let authTagBase64 = data.auth_tag_b64;

  // If IPFS CID exists, try fetching encrypted payload bundle from IPFS gateway
  if (data.ipfs_cid) {
    console.log(`[attachmentService] Fetching encrypted attachment from IPFS CID: ${data.ipfs_cid}`);
    const ipfsBuffer = await fetchFromIpfs(data.ipfs_cid);
    if (ipfsBuffer) {
      try {
        const payload = JSON.parse(ipfsBuffer.toString("utf8"));
        if (payload.ciphertext_b64 && payload.nonce_b64 && payload.auth_tag_b64) {
          ciphertextBase64 = payload.ciphertext_b64;
          ivBase64 = payload.nonce_b64;
          authTagBase64 = payload.auth_tag_b64;
          console.log(`[attachmentService] Retrieved and parsed encrypted payload from IPFS CID: ${data.ipfs_cid}`);
        }
      } catch (err) {
        console.warn(`[attachmentService] Failed to parse IPFS payload for CID ${data.ipfs_cid}, falling back to DB:`, err.message);
      }
    } else {
      console.warn(`[attachmentService] IPFS retrieval failed for CID ${data.ipfs_cid}, falling back to DB inline ciphertext.`);
    }
  }

  const plainBuffer = decryptFileAes({
    keyBase64,
    ivBase64,
    ciphertextBase64,
    authTagBase64
  });

  // Verify SHA-256 content hash if available
  if (data.content_hash) {
    const computedHash = "0x" + crypto.createHash("sha256").update(plainBuffer).digest("hex");
    if (computedHash.toLowerCase() !== data.content_hash.toLowerCase()) {
      console.error(`[attachmentService] Tamper detected! Computed ${computedHash} !== expected ${data.content_hash}`);
      throw new AppError("Attachment decryption failed: Integrity check mismatch.", 400);
    }
  }

  return {
    filename: data.filename,
    mimeType: data.mime_type,
    buffer: plainBuffer,
    ipfsCid: data.ipfs_cid,
    contentHash: data.content_hash
  };
}
