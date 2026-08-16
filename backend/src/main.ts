import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from project root (parent of backend/)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../.env') });
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';

import { config } from './config/env.js';
import { prisma } from './database/client.js';
import { errorHandler } from './api/middleware/error-handler.js';

// Services
import { AesGcmService } from './modules/crypto/aes-gcm.service.js';
import { OtpService } from './modules/crypto/otp.service.js';
import { CryptoService } from './modules/crypto/crypto.service.js';
import { MockQkmService } from './modules/qkm/mock-qkm.service.js';
import { BB84Simulator } from './modules/qkd-sim/bb84-simulator.js';
import { TelemetryEmitter } from './modules/qkd-sim/telemetry-emitter.js';
import { PinataService } from './modules/attachments/pinata.service.js';
import { AttachmentService } from './modules/attachments/attachment.service.js';
import { BlockchainRegistryClient } from './modules/blockchain/registry.client.js';
import { MlBridge } from './modules/ai-monitor/ml-bridge.js';
import { AuthService } from './modules/auth/auth.service.js';
import { GoogleOAuthService } from './modules/auth/google-oauth.js';
import { MicrosoftOAuthService } from './modules/auth/microsoft-oauth.js';

// Routes
import { createAuthRoutes } from './api/routes/auth.routes.js';
import { createEmailRoutes } from './api/routes/email.routes.js';
import { createQkmRoutes } from './api/routes/qkm.routes.js';
import { createMonitorRoutes } from './api/routes/monitor.routes.js';

async function bootstrap() {
  // ==========================================================================
  // Compose all services (dependency injection)
  // ==========================================================================

  const aesGcm = new AesGcmService();
  const otp = new OtpService();
  const cryptoService = new CryptoService(aesGcm, otp);

  const qkm = new MockQkmService(config.QKM_INITIAL_POOL_BYTES);

  const simulator = new BB84Simulator('qkm-node-alpha', 'qkm-node-beta');
  const telemetryEmitter = new TelemetryEmitter(simulator);

  const pinata = new PinataService();
  const blockchain = new BlockchainRegistryClient();
  const attachmentService = new AttachmentService(cryptoService, pinata, blockchain, qkm);

  const mlBridge = new MlBridge();

  const authService = new AuthService();
  const googleOAuth = new GoogleOAuthService();
  const microsoftOAuth = new MicrosoftOAuthService();

  // ==========================================================================
  // Build Fastify server
  // ==========================================================================

  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'development' ? 'info' : 'warn',
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  });

  // Plugins
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Allow SSE and inline scripts in dev
  });

  await fastify.register(fastifyCors, {
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(fastifyCookie, {
    secret: config.JWT_SECRET,
  });

  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max attachment
  });

  await fastify.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // Error handler
  fastify.setErrorHandler(errorHandler);

  // Health check (public)
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    qkmPoolAvailableMb: ((await qkm.getPoolStatus('qkm-node-alpha', 'qkm-node-beta')).availableKeyBits / 8 / 1024 / 1024).toFixed(2),
    channelState: simulator.getState(),
  }));

  // ==========================================================================
  // Register routes
  // ==========================================================================

  await fastify.register(createAuthRoutes(authService, googleOAuth, microsoftOAuth), {
    prefix: '/api/auth',
  });

  await fastify.register(createEmailRoutes(cryptoService, qkm), {
    prefix: '/api/emails',
  });

  await fastify.register(createQkmRoutes(qkm), {
    prefix: '/api/qkm',
  });

  await fastify.register(createMonitorRoutes(telemetryEmitter, simulator, mlBridge), {
    prefix: '/api/monitor',
  });

  // Attachment routes (inline for brevity)
  fastify.post('/api/attachments/upload', async (request, reply) => {
    const data = await (request as any).file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const fileBuffer = Buffer.concat(chunks);
    const level = parseInt(data.fields?.securityLevel?.value ?? '2', 10);

    const ref = await attachmentService.uploadAttachment(
      fileBuffer,
      data.filename,
      level === 3 ? 3 : 2,
    );
    return reply.send(ref);
  });

  fastify.get<{ Params: { attachmentId: string }; Querystring: { cid: string; keyId: string } }>(
    '/api/attachments/:attachmentId/verify',
    async (request, reply) => {
      const result = await blockchain.verifyAttachment(
        request.params.attachmentId,
        request.query.cid,
      );
      return reply.send(result);
    },
  );

  // ==========================================================================
  // Start
  // ==========================================================================

  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed. Is PostgreSQL running? (docker-compose up)', err);
    console.warn('[DB] Continuing without DB — some features will not work.');
  }

  simulator.start(2000);
  telemetryEmitter.start();
  console.log('[QKD] BB84 Simulator started');

  const address = await fastify.listen({
    port: config.PORT,
    host: '0.0.0.0',
  });
  console.log(`\n🔐 QuMail Backend running at ${address}`);
  console.log(`   Environment:  ${config.NODE_ENV}`);
  console.log(`   Frontend:     ${config.FRONTEND_URL}`);
  console.log(`   pgAdmin:      http://localhost:5050`);
  console.log(`   Gmail OAuth:  ${googleOAuth.isConfigured ? '✓ Configured' : '✗ Not configured'}`);
  console.log(`   MS OAuth:     ${microsoftOAuth.isConfigured ? '✓ Configured' : '✗ Not configured'}`);
  console.log(`   Pinata IPFS:  ${config.PINATA_JWT ? '✓ Configured' : '⚠ Mock mode'}`);
  console.log(`   Blockchain:   ${config.REGISTRY_CONTRACT_ADDRESS ? '✓ Configured' : '⚠ Mock mode'}\n`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Shutdown] Stopping services...');
    simulator.stop();
    telemetryEmitter.stop();
    qkm.destroy();
    await prisma.$disconnect();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((err) => {
  console.error('[Fatal] Bootstrap error:', err);
  process.exit(1);
});
