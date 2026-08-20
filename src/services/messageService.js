import { decryptMessageAes, decryptOtp, encryptMessageAes, randomId, randomKeyBase64, xorWithOtp } from "../lib/crypto.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import { getClientByCode, getClientByEmail, getClientById } from "./clientService.js";
import { consumeKey, reserveKey, retrievePeerKey } from "./kmeService.js";
import { sendViaGmail } from "./mailService.js";
import { saveEncryptedAttachment, listAttachments } from "./attachmentService.js";
import { registerAttachment, computeAttachmentId, computeContentHash, computeKeyIdHash, securityLevelToUint8 } from "./blockchainService.js";

function subjectAad(messageId, sender, recipient, securityLevel) {
  return JSON.stringify({ messageId, sender, recipient, securityLevel });
}

export async function sendMessage({ senderClientCode, recipientClientCode, subject, body, securityLevel, transportMode, attachments = [] }) {
  const sender = await getClientByCode(senderClientCode);
  const recipient = await getClientByCode(recipientClientCode);
  const supabase = getSupabase();
  const messageId = randomId("msg");
  const aad = subjectAad(messageId, senderClientCode, recipientClientCode, securityLevel);

  let envelope;
  let reservedKey = null;

  if (securityLevel === "STANDARD") {
    envelope = {
      qumailVersion: "1.0.0",
      securityLevel,
      header: {
        messageId,
        timestamp: new Date().toISOString(),
        sender: sender.email_address,
        recipient: recipient.email_address,
        subjectEncrypted: false
      },
      crypto: null,
      payload: { subject, body }
    };
  } else if (securityLevel === "QUANTUM_AES") {
    reservedKey = await reserveKey({
      sourceClientCode: senderClientCode,
      targetClientCode: recipientClientCode,
      mode: securityLevel,
      purpose: "QUANTUM_AES_MESSAGE"
    });
    const encryptedSubject = encryptMessageAes({ keyBase64: reservedKey.keyMaterialBase64, plaintext: subject, aad });
    const encryptedBody = encryptMessageAes({ keyBase64: reservedKey.keyMaterialBase64, plaintext: body, aad });
    envelope = {
      qumailVersion: "1.0.0",
      securityLevel,
      header: {
        messageId,
        timestamp: new Date().toISOString(),
        sender: sender.email_address,
        recipient: recipient.email_address,
        subjectEncrypted: true
      },
      crypto: {
        algorithm: "AES-256-GCM",
        keyId: reservedKey.keyId,
        iv: encryptedBody.iv,
        authTag: encryptedBody.authTag,
        keyConsumedBytes: 32,
        subjectIv: encryptedSubject.iv,
        subjectAuthTag: encryptedSubject.authTag
      },
      payload: {
        encryptedSubject: encryptedSubject.ciphertext,
        encryptedBody: encryptedBody.ciphertext
      }
    };
  } else {
    const requiredBytes = Buffer.byteLength(body, "utf8");
    reservedKey = await reserveKey({
      sourceClientCode: senderClientCode,
      targetClientCode: recipientClientCode,
      mode: securityLevel,
      requestedBytes: requiredBytes,
      purpose: "QUANTUM_OTP_MESSAGE"
    });
    const encrypted = xorWithOtp({ keyBase64: reservedKey.keyMaterialBase64, plaintext: body });
    envelope = {
      qumailVersion: "1.0.0",
      securityLevel,
      header: {
        messageId,
        timestamp: new Date().toISOString(),
        sender: sender.email_address,
        recipient: recipient.email_address,
        subjectEncrypted: false
      },
      crypto: {
        algorithm: "OTP-XOR-HMAC-SHA256",
        keyId: reservedKey.keyId,
        integrityTag: encrypted.integrityTag,
        keyConsumedBytes: encrypted.consumedBytes
      },
      payload: {
        subject,
        encryptedBody: encrypted.ciphertext
      }
    };
  }

  let transportMessageId = null;
  if (transportMode === "GMAIL") {
    transportMessageId = await sendViaGmail({
      senderClientCode,
      recipientEmail: recipient.email_address,
      subject: `[QuMail] ${messageId}`,
      body: JSON.stringify(envelope, null, 2)
    });
  }

  const { error } = await supabase.from("messages").insert({
    message_id: messageId,
    sender_client_id: sender.id,
    recipient_client_id: recipient.id,
    transport_provider: transportMode,
    transport_message_id: transportMessageId,
    subject_hint: securityLevel === "STANDARD" ? subject : "Encrypted subject",
    encryption_mode: securityLevel,
    key_id: reservedKey?.keyId || null,
    nonce_b64: envelope.crypto?.iv || null,
    auth_tag_b64: envelope.crypto?.authTag || envelope.crypto?.integrityTag || null,
    ciphertext_b64: envelope.payload?.encryptedBody || null,
    package_version: envelope.qumailVersion,
    package_json: envelope,
    status: transportMode === "GMAIL" ? "SENT" : "RECEIVED",
    sent_at: new Date().toISOString(),
    received_at: transportMode === "INTERNAL" ? new Date().toISOString() : null
  });
  if (error) throw mapSupabaseError(error, "Failed to save message.");

  // Fetch the newly-created row's UUID so we can link attachments
  const { data: msgRow } = await supabase
    .from("messages")
    .select("id")
    .eq("message_id", messageId)
    .single();

  // Encrypt and store each attachment using the same AES key (or a random key for STANDARD)
  if (attachments.length > 0 && msgRow) {
    const attachmentKey = reservedKey?.keyMaterialBase64 || null;
    // For STANDARD messages, generate a one-time random AES key for attachments
    // and embed it in the envelope so recipient can decrypt
    let finalAttachKey = attachmentKey;
    let ephemeralAttachKeyBase64 = null;
    if (!finalAttachKey) {
      ephemeralAttachKeyBase64 = randomKeyBase64(32);
      finalAttachKey = ephemeralAttachKeyBase64;
      // Store it in the envelope for the recipient
      envelope.attachmentKey = ephemeralAttachKeyBase64;
    }
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const saved = await saveEncryptedAttachment({
        messageRowId: msgRow.id,
        filename: att.filename,
        mimeType: att.mimeType,
        fileBuffer: att.buffer,
        keyBase64: finalAttachKey
      });
      // Register on blockchain integrity registry
      const attachmentId = computeAttachmentId(messageId, i);
      const contentHash = saved.contentHash || computeContentHash(att.buffer);
      const keyIdHash = computeKeyIdHash(reservedKey?.keyId || ephemeralAttachKeyBase64 || "ephemeral");
      const secLevel = securityLevelToUint8(securityLevel);
      const ipfsCid = saved.ipfsCid || "";
      try {
        const regRes = await registerAttachment({ attachmentId, ipfsCid, contentHash, keyIdHash, securityLevel: secLevel });
        console.log(`[messageService] Registered attachment #${i} (${att.filename}) on blockchain with CID '${ipfsCid}'. TX: ${regRes.transactionHash}`);
      } catch (err) {
        console.error(`[messageService] Blockchain registration failed for attachment #${i} (${att.filename}):`, err.message);
      }
    }
    // If we stored the key in the envelope, persist updated package_json
    if (ephemeralAttachKeyBase64) {
      await supabase.from("messages").update({ package_json: envelope }).eq("id", msgRow.id);
    }
  }

  if (reservedKey?.keyId) {
    await consumeKey({
      keyId: reservedKey.keyId,
      ownerClientCode: senderClientCode,
      messageId,
      consumedBytes: envelope.crypto.keyConsumedBytes
    });
  }

  return {
    messageId,
    keyId: reservedKey?.keyId || null,
    securityLevel,
    transportMode,
    transportMessageId,
    envelope
  };
}

export async function listMessagesForClient(clientCode) {
  const client = await getClientByCode(clientCode);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("message_id, subject_hint, encryption_mode, key_id, status, sent_at, received_at, package_json")
    .eq("recipient_client_id", client.id)
    .order("created_at", { ascending: false });
  if (error) throw mapSupabaseError(error, "Failed to list inbox messages.");
  return data;
}

export async function decryptMessageForViewer({ viewerClientCode, messageId }) {
  const viewer = await getClientByCode(viewerClientCode);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("id, message_id, sender_client_id, recipient_client_id, encryption_mode, key_id, package_json")
    .eq("message_id", messageId)
    .eq("recipient_client_id", viewer.id)
    .single();
  if (error) throw new AppError(`Message ${messageId} not found for ${viewerClientCode}.`, 404);

  const envelope = data.package_json;
  const attachments = await listAttachments(data.id);

  if (data.encryption_mode === "STANDARD") {
    return {
      messageId,
      decryptedSubject: envelope.payload.subject,
      decryptedBody: envelope.payload.body,
      keyId: null,
      attachments,
      // For STANDARD, attachments use an ephemeral key stored in envelope
      attachmentKeyId: null,
      attachmentKeyBase64: envelope.attachmentKey || null
    };
  }

  const key = await retrievePeerKey({ ownerClientCode: viewerClientCode, keyId: data.key_id });
  if (data.encryption_mode === "QUANTUM_AES") {
    const sender = await getClientById(data.sender_client_id);
    const recipient = await getClientById(data.recipient_client_id);
    const aad = subjectAad(messageId, sender.code, recipient.code, data.encryption_mode);
    const decryptedSubject = decryptMessageAes({
      keyBase64: key.keyMaterialBase64,
      ivBase64: envelope.crypto.subjectIv,
      ciphertextBase64: envelope.payload.encryptedSubject,
      authTagBase64: envelope.crypto.subjectAuthTag,
      aad
    });
    const decryptedBody = decryptMessageAes({
      keyBase64: key.keyMaterialBase64,
      ivBase64: envelope.crypto.iv,
      ciphertextBase64: envelope.payload.encryptedBody,
      authTagBase64: envelope.crypto.authTag,
      aad
    });
    return { messageId, decryptedSubject, decryptedBody, keyId: key.keyId, attachments, attachmentKeyBase64: key.keyMaterialBase64 };
  }

  const decryptedBody = decryptOtp({
    keyBase64: key.keyMaterialBase64,
    ciphertextBase64: envelope.payload.encryptedBody,
    integrityTag: envelope.crypto.integrityTag
  });
  return {
    messageId,
    decryptedSubject: envelope.payload.subject,
    decryptedBody,
    keyId: key.keyId,
    attachments,
    attachmentKeyBase64: key.keyMaterialBase64
  };
}

export async function sendMessageAsUser({ senderEmail, recipientEmail, subject, body, securityLevel, transportMode, attachments = [] }) {
  const sender = await getClientByEmail(senderEmail);
  const recipient = await getClientByEmail(recipientEmail);
  return sendMessage({
    senderClientCode: sender.code,
    recipientClientCode: recipient.code,
    subject,
    body,
    securityLevel,
    transportMode,
    attachments
  });
}

export async function listMessagesForUser(email) {
  const client = await getClientByEmail(email);
  return listMessagesForClient(client.code);
}

export async function decryptMessageForUser({ email, messageId }) {
  const client = await getClientByEmail(email);
  return decryptMessageForViewer({ viewerClientCode: client.code, messageId });
}
