import type { FastifyInstance } from 'fastify';
import type { MockQkmService } from '../../modules/qkm/mock-qkm.service.js';
import { requireAuth } from './auth.routes.js';

export function createQkmRoutes(qkm: MockQkmService) {
  return async function qkmRoutes(fastify: FastifyInstance) {

    // Pool status (ETSI GS QKD 014 style)
    fastify.get('/status', { preHandler: requireAuth }, async (request, reply) => {
      const status = await qkm.getPoolStatus('qkm-node-alpha', 'qkm-node-beta');
      return reply.send(status);
    });

    // Reserve key
    fastify.post<{ Body: { keyLengthBits: number; purpose: string; timeoutSeconds?: number } }>(
      '/reserve',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { keyLengthBits, purpose, timeoutSeconds } = request.body;
        const key = await qkm.reserveKey({
          sourceNode: 'qkm-node-alpha',
          targetNode: 'qkm-node-beta',
          keyLengthBits: keyLengthBits ?? 256,
          purpose: purpose ?? 'QUANTUM_AES_MESSAGE',
          timeoutSeconds,
        });

        // Return key metadata including raw material (only over HTTPS in production)
        return reply.send(key);
      },
    );

    // Get key by ID (recipient flow)
    fastify.post<{ Body: { keyId: string } }>(
      '/get-key',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { keyId } = request.body;
        if (!keyId) return reply.status(400).send({ error: 'keyId is required' });
        const key = await qkm.retrieveKey(keyId, 'qkm-node-alpha');
        return reply.send(key);
      },
    );

    // Key status check
    fastify.get<{ Params: { keyId: string } }>(
      '/keys/:keyId/status',
      { preHandler: requireAuth },
      async (request, reply) => {
        const status = await qkm.getKeyStatus(request.params.keyId);
        return reply.send({ keyId: request.params.keyId, status });
      },
    );

    // Key metadata listing (for dashboard)
    fastify.get('/keys', { preHandler: requireAuth }, async (request, reply) => {
      const keys = qkm.getKeyMetadata();
      return reply.send({ keys, total: keys.length });
    });

    // Admin: simulate channel disturbance (demo scenarios)
    fastify.post<{ Body: { state: 'NORMAL' | 'TURBULENCE' | 'ANOMALOUS' | 'DEAD' } }>(
      '/admin/simulate-disturbance',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { state } = request.body;
        const validStates = ['NORMAL', 'TURBULENCE', 'ANOMALOUS', 'DEAD'];
        if (!validStates.includes(state)) {
          return reply.status(400).send({ error: `Invalid state. Must be one of: ${validStates.join(', ')}` });
        }
        qkm.simulateChannelDisturbance(state);
        return reply.send({ success: true, newState: state, message: `Channel state set to ${state}` });
      },
    );
  };
}
