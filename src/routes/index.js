import { getAuthenticatedUser } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { asyncHandler } from "../lib/http.js";
import { AppError, mapSupabaseError } from "../lib/errors.js";
import { getSupabase } from "../lib/supabase.js";
import multer from "multer";
import {
  validate,
  composeSchema,
  decryptSchema,
  reserveKeySchema,
  retrieveKeySchema,
  authenticatedComposeSchema,
  authenticatedDecryptSchema
} from "../lib/validation.js";
import { ensureDefaultClients, getAllowedLoginEmails, getClientByCode, getClientByEmail, listClients } from "../services/clientService.js";
import { seedMockKeys, simulateBb84KeyPool } from "../services/keySeederService.js";
import { getKmeStatus, listKeyPool, reserveKey, retrievePeerKey } from "../services/kmeService.js";
import { getGmailAuthUrl, getGmailConnectionStatus, storeGmailTokens } from "../services/mailService.js";
import { decryptMessageForUser, decryptMessageForViewer, listMessagesForClient, listMessagesForUser, sendMessage, sendMessageAsUser } from "../services/messageService.js";
import { getDecryptedAttachment } from "../services/attachmentService.js";
import { registerAttachment, verifyAttachment, getAttachmentOnChain, getAttachmentEvent, CONTRACT_ADDRESS } from "../services/blockchainService.js";
console.log('[routes] Blockchain service imported, registerAttachment:', registerAttachment.name);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function registerRoutes(app) {
  console.log('[routes] registerRoutes called');
  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, service: "qumail" });
  });

  app.get("/api/v1/config/public", (_req, res) => {
    res.json({
      appBaseUrl: env.APP_BASE_URL,
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY
    });
  });

  app.post("/api/v1/admin/simulate-bb84", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    const result = await simulateBb84KeyPool({ force: true });
    res.json({ ok: true, result });
  }));

  app.post("/api/v1/admin/bootstrap", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    const result = await simulateBb84KeyPool({ force: true });
    res.json({ ok: true, result });
  }));

  app.get("/api/v1/clients", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    res.json(await listClients());
  }));

  app.get("/api/v1/auth/allowed-emails", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    res.json({ emails: await getAllowedLoginEmails() });
  }));

  app.post("/api/v1/auth/fast-login", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const { email, clientCode } = req.body || {};
    let targetEmail = email;
    if (!targetEmail && clientCode) {
      const client = await getClientByCode(clientCode);
      targetEmail = client.connected_email_address || client.email_address;
    }
    if (!targetEmail) {
      throw new AppError("Email or clientCode is required for fast login.", 400);
    }

    const allowed = await getAllowedLoginEmails();
    const normalized = targetEmail.trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new AppError(`Email ${targetEmail} is not in the approved client list.`, 403);
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalized
    });
    if (error) throw mapSupabaseError(error, "Failed to generate fast login session.");

    res.json({
      ok: true,
      email: normalized,
      tokenHash: data.properties.hashed_token,
      verificationType: data.properties.verification_type || "magiclink"
    });
  }));

  app.get("/api/v1/me", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    const client = await getClientByEmail(user.email);
    res.json({
      email: user.email,
      clientCode: client.code,
      displayName: client.display_name,
      gmailConnected: client.gmail_connected,
      connectedEmailAddress: client.connected_email_address,
      placeholderEmailAddress: client.placeholder_email_address,
      allowedLoginEmails: await getAllowedLoginEmails()
    });
  }));

  app.get("/api/v1/qkm/status", asyncHandler(async (_req, res) => {
    res.json(await getKmeStatus());
  }));

  app.get("/api/v1/etsi/status", asyncHandler(async (_req, res) => {
    res.json(await getKmeStatus());
  }));

  app.get("/api/v1/admin/key-pool", asyncHandler(async (_req, res) => {
    res.json(await listKeyPool());
  }));

  app.post("/api/v1/qkm/keys/reserve", asyncHandler(async (req, res) => {
    const payload = validate(reserveKeySchema, req.body);
    const result = await reserveKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      mode: result.mode,
      purpose: result.purpose
    });
  }));

  app.post("/api/v1/qkm/keys/:targetClientCode/reserve", asyncHandler(async (req, res) => {
    const payload = validate(reserveKeySchema, {
      ...req.body,
      targetClientCode: req.params.targetClientCode
    });
    const result = await reserveKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      mode: result.mode,
      purpose: result.purpose
    });
  }));

  app.post("/api/v1/etsi/keys", asyncHandler(async (req, res) => {
    const payload = validate(reserveKeySchema, req.body);
    const result = await reserveKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      mode: result.mode,
      purpose: result.purpose
    });
  }));

  app.post("/api/v1/qkm/keys/get_key", asyncHandler(async (req, res) => {
    const payload = validate(retrieveKeySchema, req.body);
    const result = await retrievePeerKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      algorithmUsage: result.algorithmUsage,
      status: result.status
    });
  }));

  app.post("/api/v1/qkm/keys/:sourceClientCode/get_key", asyncHandler(async (req, res) => {
    const payload = validate(retrieveKeySchema, {
      ...req.body,
      ownerClientCode: req.body.ownerClientCode || req.params.sourceClientCode
    });
    const result = await retrievePeerKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      algorithmUsage: result.algorithmUsage,
      status: result.status
    });
  }));

  app.post("/api/v1/etsi/keys_with_id", asyncHandler(async (req, res) => {
    const payload = validate(retrieveKeySchema, req.body);
    const result = await retrievePeerKey(payload);
    res.json({
      keyId: result.keyId,
      keySizeBytes: result.keySizeBytes,
      algorithmUsage: result.algorithmUsage,
      status: result.status
    });
  }));

  app.post("/api/v1/qumail/messages/send", asyncHandler(async (req, res) => {
    const payload = validate(composeSchema, req.body);
    const result = await sendMessage(payload);
    res.json({
      messageId: result.messageId,
      keyId: result.keyId,
      securityLevel: result.securityLevel,
      transportMode: result.transportMode,
      transportMessageId: result.transportMessageId
    });
  }));

  app.get("/api/v1/qumail/messages/:clientCode", asyncHandler(async (req, res) => {
    res.json(await listMessagesForClient(req.params.clientCode));
  }));

  app.get("/api/v1/me/messages", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    res.json(await listMessagesForUser(user.email));
  }));

  // Send message with optional file attachments (multipart/form-data)
  app.post("/api/v1/me/messages/send", upload.array("files", 10), asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    const payload = validate(authenticatedComposeSchema, req.body);
    const attachments = (req.files || []).map(f => ({
      filename: f.originalname,
      mimeType: f.mimetype,
      buffer: f.buffer
    }));
    const result = await sendMessageAsUser({
      senderEmail: user.email,
      ...payload,
      attachments
    });
    res.json({
      messageId: result.messageId,
      keyId: result.keyId,
      securityLevel: result.securityLevel,
      transportMode: result.transportMode,
      transportMessageId: result.transportMessageId
    });
  }));

  app.post("/api/v1/qumail/messages/decrypt", asyncHandler(async (req, res) => {
    const payload = validate(decryptSchema, req.body);
    res.json(await decryptMessageForViewer(payload));
  }));

  app.post("/api/v1/me/messages/decrypt", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    const payload = validate(authenticatedDecryptSchema, req.body);
    res.json(await decryptMessageForUser({ email: user.email, messageId: payload.messageId }));
  }));

  // Download a decrypted attachment — key is derived from the message decrypt result
  app.get("/api/v1/me/messages/:messageId/attachments/:attachmentId/download", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    // Re-decrypt the message to get the attachment key
    const decryptResult = await decryptMessageForUser({ email: user.email, messageId: req.params.messageId });
    const keyBase64 = decryptResult.attachmentKeyBase64;
    if (!keyBase64) {
      return res.status(400).json({ error: "No attachment key available for this message." });
    }
    const { filename, mimeType, buffer } = await getDecryptedAttachment(req.params.attachmentId, keyBase64);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }));

  app.get("/api/v1/providers/gmail/auth-url/:clientCode", asyncHandler(async (req, res) => {
    res.json({ url: getGmailAuthUrl(req.params.clientCode) });
  }));

  app.get("/api/v1/me/gmail/auth-url", asyncHandler(async (req, res) => {
    await ensureDefaultClients();
    const user = await getAuthenticatedUser(req);
    const client = await getClientByEmail(user.email);
    res.json({ url: getGmailAuthUrl(client.code) });
  }));

  app.get("/api/v1/providers/gmail/oauth/callback", asyncHandler(async (req, res) => {
    const clientCode = typeof req.query.state === "string" ? req.query.state : "unknown";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    await storeGmailTokens({ clientCode, code });
    const redirectUrl = new URL("/", env.APP_BASE_URL || req.protocol + "://" + req.get("host"));
    redirectUrl.searchParams.set("gmail", "connected");
    redirectUrl.searchParams.set("client", clientCode);
    res.redirect(302, redirectUrl.toString());
  }));

  app.get("/api/v1/providers/gmail/status", asyncHandler(async (_req, res) => {
    res.json(await getGmailConnectionStatus());
  }));

  // Blockchain integrity registry
  app.get("/api/v1/blockchain/contract", (_req, res) => {
    res.json({ contractAddress: CONTRACT_ADDRESS, network: "hardhat-local" });
  });

  app.post("/api/v1/blockchain/verify", asyncHandler(async (req, res) => {
    const { attachmentId, contentHash } = req.body;
    if (!attachmentId || !contentHash) {
      throw new AppError("attachmentId and contentHash are required", 400);
    }
    const result = await verifyAttachment(attachmentId, contentHash);
    res.json(result);
  }));

  app.post("/api/v1/blockchain/register", asyncHandler(async (req, res) => {
    const { attachmentId, ipfsCid, contentHash, keyIdHash, securityLevel } = req.body;
    if (!attachmentId || !contentHash || !keyIdHash || securityLevel === undefined) {
      throw new AppError("attachmentId, contentHash, keyIdHash, and securityLevel are required", 400);
    }
    const result = await registerAttachment({ attachmentId, ipfsCid: ipfsCid || "", contentHash, keyIdHash, securityLevel });
    res.json(result);
  }));

  app.get("/api/v1/blockchain/record/:attachmentId", asyncHandler(async (req, res) => {
    const record = await getAttachmentOnChain(req.params.attachmentId);
    if (!record.exists) {
      return res.status(404).json({ error: "Attachment record not found on blockchain" });
    }
    res.json(record);
  }));

  app.get("/api/v1/blockchain/event/:attachmentId", asyncHandler(async (req, res) => {
    const event = await getAttachmentEvent(req.params.attachmentId);
    if (!event) {
      return res.status(404).json({ error: "No registration event found" });
    }
    res.json(event);
  }));
}

