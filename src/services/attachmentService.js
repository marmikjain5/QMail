import crypto from "node:crypto";

import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";

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
  const supabase = getSupabase();

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
      storage_mode: "INLINE"
    })
    .select("id")
    .single();

  if (error) throw mapSupabaseError(error, "Failed to save attachment.");
  return { attachmentId: data.id };
}

export async function listAttachments(messageRowId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, filename, mime_type, byte_size, created_at")
    .eq("message_id", messageRowId)
    .order("created_at", { ascending: true });
  if (error) throw mapSupabaseError(error, "Failed to list attachments.");
  return data;
}

export async function getDecryptedAttachment(attachmentId, keyBase64) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("id, filename, mime_type, byte_size, ciphertext_b64, nonce_b64, auth_tag_b64")
    .eq("id", attachmentId)
    .single();

  if (error || !data) throw new AppError(`Attachment ${attachmentId} not found.`, 404);

  const plainBuffer = decryptFileAes({
    keyBase64,
    ivBase64: data.nonce_b64,
    ciphertextBase64: data.ciphertext_b64,
    authTagBase64: data.auth_tag_b64
  });

  return { filename: data.filename, mimeType: data.mime_type, buffer: plainBuffer };
}
