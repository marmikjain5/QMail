import type { FastifyInstance } from 'fastify';
import { requireAuth } from './auth.routes.js';
import { prisma } from '../../database/client.js';
import { decryptToken, encryptToken } from '../../modules/auth/auth.service.js';
import { GmailProvider } from '../../modules/email/gmail.provider.js';
import { MicrosoftProvider } from '../../modules/email/microsoft.provider.js';
import type { IEmailProvider } from '../../modules/email/interfaces.js';
import type { CryptoService } from '../../modules/crypto/crypto.service.js';
import { SecurityLevel } from '../../modules/crypto/interfaces.js';
import type { IKeyManager } from '../../modules/qkm/interfaces.js';
import { v4 as uuidv4 } from 'uuid';
import { InsufficientKeyMaterialError, QkmUnavailableError } from '../../modules/crypto/errors.js';

export function createEmailRoutes(
  crypto: CryptoService,
  qkm: IKeyManager,
) {
  return async function emailRoutes(fastify: FastifyInstance) {

    // Helper: get provider for the authenticated user
    async function getProvider(userId: string): Promise<{ provider: IEmailProvider; account: { emailAddress: string } }> {
      const account = await prisma.connectedAccount.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      if (!account) {
        throw Object.assign(new Error('No connected email account found. Please connect Gmail or Microsoft.'), { statusCode: 400 });
      }

      const accessToken = decryptToken(account.accessTokenEncrypted);
      const refreshToken = decryptToken(account.refreshTokenEncrypted);

      const onRefresh = async (newToken: string, expiresAt: Date) => {
        await prisma.connectedAccount.update({
          where: { id: account.id },
          data: {
            accessTokenEncrypted: encryptToken(newToken),
            tokenExpiresAt: expiresAt,
          },
        });
      };

      let provider: IEmailProvider;
      if (account.provider === 'GMAIL') {
        const { GoogleOAuthService } = await import('../../modules/auth/google-oauth.js');
        const googleOAuth = new GoogleOAuthService();
        provider = new GmailProvider(
          accessToken,
          refreshToken,
          onRefresh,
          (rt) => googleOAuth.refreshAccessToken(rt),
        );
      } else {
        const { MicrosoftOAuthService } = await import('../../modules/auth/microsoft-oauth.js');
        const msOAuth = new MicrosoftOAuthService();
        provider = new MicrosoftProvider(
          accessToken,
          refreshToken,
          onRefresh,
          (rt) => msOAuth.refreshAccessToken(rt),
        );
      }

      return { provider, account };
    }

    // -------------------------------------------------------------------------
    // List emails
    // -------------------------------------------------------------------------
    fastify.get<{ Params: { folder: string }; Querystring: { page?: string; limit?: string } }>(
      '/:folder',
      { preHandler: requireAuth },
      async (request, reply) => {
        const folder = request.params.folder.toUpperCase() as 'INBOX' | 'SENT' | 'DRAFTS';
        if (!['INBOX', 'SENT', 'DRAFTS'].includes(folder)) {
          return reply.status(400).send({ error: 'Invalid folder' });
        }

        const limit = Math.min(100, parseInt(request.query.limit ?? '50', 10));
        const { provider } = await getProvider(request.user!.userId);

        const result = await provider.listMessages(folder, limit);
        return reply.send(result);
      },
    );

    // -------------------------------------------------------------------------
    // Get single email
    // -------------------------------------------------------------------------
    fastify.get<{ Params: { folder: string; id: string } }>(
      '/:folder/:id',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { provider } = await getProvider(request.user!.userId);
        const message = await provider.getMessage(request.params.id);

        // If encrypted, auto-decrypt
        if (message.isQuMailEncrypted && message.qumailEnvelope) {
          const envelope = message.qumailEnvelope;
          try {
            const keyMaterial = await qkm.retrieveKey(
              envelope.crypto.keyId,
              'qkm-node-alpha',
            );

            const decryptedBody = await crypto.decrypt(
              {
                ciphertextBase64: envelope.payload.encryptedBody,
                ivBase64: envelope.crypto.iv,
                authTagBase64: envelope.crypto.authTag,
                macTagBase64: envelope.crypto.macTag,
                keyMaterialBase64: keyMaterial.keyMaterialBase64,
                algorithm: envelope.crypto.algorithm,
              },
              envelope.securityLevel === 3 ? SecurityLevel.QUANTUM_OTP : SecurityLevel.QUANTUM_AES,
            );

            const decryptedSubject = await crypto.decrypt(
              {
                ciphertextBase64: envelope.payload.encryptedSubject,
                ivBase64: envelope.crypto.iv,
                authTagBase64: envelope.crypto.authTag,
                macTagBase64: envelope.crypto.macTag,
                keyMaterialBase64: keyMaterial.keyMaterialBase64,
                algorithm: envelope.crypto.algorithm,
              },
              envelope.securityLevel === 3 ? SecurityLevel.QUANTUM_OTP : SecurityLevel.QUANTUM_AES,
            );

            message.bodyPlain = decryptedBody.plaintextBuffer.toString('utf8');
            message.bodyHtml = `<div>${message.bodyPlain.replace(/\n/g, '<br>')}</div>`;
            message.subject = decryptedSubject.plaintextBuffer.toString('utf8');
          } catch (err) {
            message.bodyPlain = `[DECRYPTION FAILED: ${(err as Error).message}]`;
            message.bodyHtml = `<div style="color:red">[DECRYPTION FAILED: ${(err as Error).message}]</div>`;
          }
        }

        return reply.send(message);
      },
    );

    // -------------------------------------------------------------------------
    // Send email (all security levels)
    // -------------------------------------------------------------------------
    fastify.post<{
      Body: {
        to: string[];
        subject: string;
        body: string;
        bodyHtml?: string;
        securityLevel: number;
        attachmentRefs?: unknown[];
      };
    }>(
      '/send',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { to, subject, body, bodyHtml, securityLevel } = request.body;
        const { provider, account } = await getProvider(request.user!.userId);

        if (securityLevel === 1) {
          // Level 1: direct send, no encryption
          const result = await provider.sendMessage({
            to,
            subject,
            bodyPlain: body,
            bodyHtml: bodyHtml ?? body,
            fromEmail: account.emailAddress,
          });
          return reply.send({ messageId: result.messageId, securityLevel: 1 });
        }

        const level =
          securityLevel === 3 ? SecurityLevel.QUANTUM_OTP : SecurityLevel.QUANTUM_AES;
        const plaintextSubject = Buffer.from(subject, 'utf8');
        const plaintextBody = Buffer.from(body, 'utf8');
        const totalBytes = plaintextSubject.length + plaintextBody.length;

        // Check key availability
        const poolStatus = await qkm.getPoolStatus('qkm-node-alpha', 'qkm-node-beta');
        const availableBytes = poolStatus.availableKeyBits / 8;

        if (level === SecurityLevel.QUANTUM_OTP && availableBytes < totalBytes + 64) {
          throw new InsufficientKeyMaterialError(availableBytes, totalBytes + 64);
        }

        if (poolStatus.channelHealth === 'DEAD') {
          throw new QkmUnavailableError('QKD channel is unavailable');
        }

        // Reserve key for body + subject + MAC
        const keyLengthBits = level === SecurityLevel.QUANTUM_OTP
          ? (totalBytes + 64) * 8
          : 256;

        const reservedKey = await qkm.reserveKey({
          sourceNode: 'qkm-node-alpha',
          targetNode: 'qkm-node-beta',
          keyLengthBits,
          purpose: level === SecurityLevel.QUANTUM_OTP
            ? 'QUANTUM_OTP_MESSAGE'
            : 'QUANTUM_AES_MESSAGE',
        });

        const keyBuffer = Buffer.from(reservedKey.keyMaterialBase64, 'base64');
        let macKey: Buffer | null = null;
        let bodyKey = keyBuffer;

        if (level === SecurityLevel.QUANTUM_OTP) {
          macKey = keyBuffer.subarray(totalBytes, totalBytes + 32);
          bodyKey = keyBuffer.subarray(0, plaintextBody.length);
        }

        const [encSubject, encBody] = await Promise.all([
          crypto.encrypt(
            plaintextSubject,
            level === SecurityLevel.QUANTUM_OTP
              ? keyBuffer.subarray(plaintextBody.length, plaintextBody.length + plaintextSubject.length)
              : Buffer.from(reservedKey.keyMaterialBase64, 'base64').subarray(0, 32),
            level === SecurityLevel.QUANTUM_OTP ? (macKey ? Buffer.from(macKey) : null) : null,
            level,
            `qumail-subject-${reservedKey.keyId}`,
          ),
          crypto.encrypt(
            plaintextBody,
            bodyKey,
            macKey,
            level,
            `qumail-body-${reservedKey.keyId}`,
          ),
        ]);

        await qkm.consumeKey(reservedKey.keyId);

        const messageId = `msg_${uuidv4()}`;
        const envelope = {
          qumailVersion: '1.0.0',
          securityLevel: level,
          header: {
            messageId,
            timestamp: new Date().toISOString(),
            sender: account.emailAddress,
            recipient: to[0] ?? '',
            subjectEncrypted: true,
          },
          crypto: {
            algorithm: level === SecurityLevel.QUANTUM_AES ? 'AES-256-GCM' as const : 'OTP-XOR-HMAC-SHA256' as const,
            keyId: reservedKey.keyId,
            keyDomain: 'qkm-node-alpha',
            iv: encBody.ivBase64 || undefined,
            authTag: encBody.authTagBase64 || undefined,
            macTag: encBody.macTagBase64 || undefined,
            keyConsumedBytes: keyLengthBits / 8,
          },
          payload: {
            encryptedSubject: encSubject.ciphertextBase64,
            encryptedBody: encBody.ciphertextBase64,
          },
          attachments: [],
        };

        const { buildQuMailEmailBody } = await import('../../modules/email/envelope-parser.js');
        const emailBody = buildQuMailEmailBody(
          envelope,
          'This message is protected by QuMail quantum-secured encryption.',
        );

        const result = await provider.sendMessage({
          to,
          subject: '🔐 QuMail Encrypted Message',
          bodyPlain: emailBody,
          fromEmail: account.emailAddress,
          qumailEnvelope: envelope,
        });

        return reply.send({
          messageId: result.messageId,
          securityLevel: level,
          keyId: reservedKey.keyId,
          algorithm: envelope.crypto.algorithm,
        });
      },
    );

    // -------------------------------------------------------------------------
    // Key availability check (for compose dialog)
    // -------------------------------------------------------------------------
    fastify.get<{ Querystring: { level?: string; payloadBytes?: string } }>(
      '/key-availability',
      { preHandler: requireAuth },
      async (request, reply) => {
        const level = parseInt(request.query.level ?? '2', 10);
        const payloadBytes = parseInt(request.query.payloadBytes ?? '0', 10);

        const status = await qkm.getPoolStatus('qkm-node-alpha', 'qkm-node-beta');
        const availableBytes = status.availableKeyBits / 8;

        const required = level === 3 ? payloadBytes + 64 : 32;
        const sufficient = availableBytes >= required;

        return reply.send({
          sufficient,
          availableBytes,
          requiredBytes: required,
          availableMb: (availableBytes / 1024 / 1024).toFixed(2),
          channelHealth: status.channelHealth,
        });
      },
    );
  };
}
