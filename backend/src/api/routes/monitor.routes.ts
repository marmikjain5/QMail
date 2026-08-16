import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from './auth.routes.js';
import type { TelemetryEmitter } from '../qkd-sim/telemetry-emitter.js';
import type { BB84Simulator } from '../qkd-sim/bb84-simulator.js';
import type { MlBridge } from '../ai-monitor/ml-bridge.js';
import { prisma } from '../../database/client.js';

export function createMonitorRoutes(
  telemetryEmitter: TelemetryEmitter,
  simulator: BB84Simulator,
  mlBridge: MlBridge,
) {
  return async function monitorRoutes(fastify: FastifyInstance) {

    // SSE: Real-time QKD telemetry stream
    fastify.get('/qkd/stream', async (request, reply) => {
      // Disable Fastify's automatic response handling for SSE
      reply.raw.setMaxListeners(20);
      telemetryEmitter.addClient(reply);
      // Keep the connection open until client disconnects
      await new Promise<void>((resolve) => {
        reply.raw.on('close', resolve);
        reply.raw.on('error', resolve);
      });
    });

    // Historical telemetry for chart
    fastify.get<{ Querystring: { limit?: string } }>(
      '/qkd/history',
      { preHandler: requireAuth },
      async (request, reply) => {
        const limit = Math.min(500, parseInt(request.query.limit ?? '100', 10));
        const logs = await prisma.qkdTelemetryLog.findMany({
          orderBy: { recordedAt: 'desc' },
          take: limit,
        });
        return reply.send({ logs: logs.reverse() });
      },
    );

    // Recent anomalies
    fastify.get<{ Querystring: { limit?: string } }>(
      '/qkd/anomalies',
      { preHandler: requireAuth },
      async (request, reply) => {
        const limit = Math.min(50, parseInt(request.query.limit ?? '20', 10));
        const anomalies = await prisma.qkdTelemetryLog.findMany({
          where: { anomalyDetected: true },
          orderBy: { recordedAt: 'desc' },
          take: limit,
        });
        return reply.send({ anomalies });
      },
    );

    // Channel state control (demo)
    fastify.post<{ Body: { state: string } }>(
      '/qkd/simulate',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { state } = request.body;
        const validStates = ['NORMAL', 'TURBULENCE', 'ANOMALOUS', 'DEAD'] as const;
        if (!validStates.includes(state as typeof validStates[number])) {
          return reply.status(400).send({ error: 'Invalid state' });
        }
        simulator.transitionTo(state as typeof validStates[number]);
        return reply.send({ success: true, state });
      },
    );

    // Key consumption forecast
    fastify.get(
      '/forecast',
      { preHandler: requireAuth },
      async (request, reply) => {
        const recentLogs = await prisma.qkdTelemetryLog.findMany({
          orderBy: { recordedAt: 'desc' },
          take: 50,
          select: { secretKeyRateBps: true, recordedAt: true },
        });

        const avgKeyRate =
          recentLogs.length > 0
            ? recentLogs.reduce((s, l) => s + l.secretKeyRateBps, 0) / recentLogs.length
            : 50000;

        // Simple estimate: current pool / avg rate
        const poolStatus = simulator.getCurrentTelemetry();
        const estimatedDepletionHours =
          avgKeyRate > 0 ? (10 * 1024 * 1024 * 8) / avgKeyRate / 3600 : 999;

        return reply.send({
          avgSecretKeyRateBps: Math.round(avgKeyRate),
          estimatedDepletionHours: Math.round(estimatedDepletionHours),
          recommendLevel2: estimatedDepletionHours < 24,
          currentQber: poolStatus.qber,
          channelState: poolStatus.channelState,
        });
      },
    );

    // Email threat scan
    fastify.post<{
      Body: {
        subject: string;
        bodyPlain: string;
        senderEmail: string;
        links?: string[];
        hasAttachments?: boolean;
        attachmentTypes?: string[];
      };
    }>(
      '/email/threat-scan',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { subject, bodyPlain, senderEmail, links = [], hasAttachments = false, attachmentTypes = [] } = request.body;
        const senderDomain = senderEmail.split('@')[1] ?? '';

        const result = await mlBridge.analyzeEmailThreat({
          subject,
          bodyPlain,
          senderDomain,
          senderEmail,
          links,
          hasAttachments,
          attachmentTypes,
        });

        return reply.send(result);
      },
    );
  };
}
