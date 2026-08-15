import { env } from "../lib/env.js";
import { asyncHandler } from "../lib/http.js";
import { validate, composeSchema, decryptSchema, reserveKeySchema, retrieveKeySchema } from "../lib/validation.js";
import { ensureDefaultClients, listClients } from "../services/clientService.js";
import { seedMockKeys } from "../services/keySeederService.js";
import { getKmeStatus, listKeyPool, reserveKey, retrievePeerKey } from "../services/kmeService.js";
import { getGmailAuthUrl, getGmailConnectionStatus, storeGmailTokens } from "../services/mailService.js";
import { decryptMessageForViewer, listMessagesForClient, sendMessage } from "../services/messageService.js";

export function registerRoutes(app) {
  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, service: "qumail" });
  });

  app.post("/api/v1/admin/bootstrap", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    const result = await seedMockKeys();
    res.json({ ok: true, result });
  }));

  app.get("/api/v1/clients", asyncHandler(async (_req, res) => {
    await ensureDefaultClients();
    res.json(await listClients());
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

  app.post("/api/v1/qumail/messages/decrypt", asyncHandler(async (req, res) => {
    const payload = validate(decryptSchema, req.body);
    res.json(await decryptMessageForViewer(payload));
  }));

  app.get("/api/v1/providers/gmail/auth-url/:clientCode", asyncHandler(async (req, res) => {
    res.json({ url: getGmailAuthUrl(req.params.clientCode) });
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
}
