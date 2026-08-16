import type { FastifyReply } from 'fastify';
import type { BB84Simulator } from './bb84-simulator.js';
import type { QkdTelemetry } from './channel-model.js';
import { prisma } from '../../database/client.js';

/**
 * Server-Sent Events telemetry emitter.
 *
 * Manages SSE connections from frontend clients and broadcasts
 * QKD telemetry as it arrives from the BB84Simulator.
 * Also persists each telemetry snapshot to the database.
 */
export class TelemetryEmitter {
  private readonly clients = new Set<FastifyReply>();
  private removeSimListener?: () => void;

  constructor(private readonly simulator: BB84Simulator) {}

  /**
   * Start listening to simulator events and persisting to DB.
   */
  start(): void {
    this.removeSimListener = this.simulator.onTelemetry((telemetry) => {
      this.broadcast(telemetry);
      this.persist(telemetry).catch((err) =>
        console.error('[TelemetryEmitter] DB persist error:', err),
      );
    });
    console.log('[TelemetryEmitter] Started');
  }

  stop(): void {
    this.removeSimListener?.();
    for (const client of this.clients) {
      try { client.raw.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  /**
   * Register an SSE response object. Sends an initial snapshot immediately.
   */
  addClient(reply: FastifyReply): void {
    this.clients.add(reply);

    // Set SSE headers
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send immediate snapshot
    const snapshot = this.simulator.getCurrentTelemetry();
    this.sendToClient(reply, snapshot);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': heartbeat\n\n');
      } else {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Clean up when client disconnects
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(reply);
    });
  }

  /**
   * Remove an SSE client connection.
   */
  removeClient(reply: FastifyReply): void {
    this.clients.delete(reply);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private broadcast(telemetry: QkdTelemetry): void {
    const deadClients: FastifyReply[] = [];

    for (const client of this.clients) {
      if (client.raw.writableEnded) {
        deadClients.push(client);
        continue;
      }
      this.sendToClient(client, telemetry);
    }

    // Clean up dead connections
    for (const dead of deadClients) {
      this.clients.delete(dead);
    }
  }

  private sendToClient(reply: FastifyReply, telemetry: QkdTelemetry): void {
    try {
      const data = JSON.stringify(telemetry);
      reply.raw.write(`data: ${data}\n\n`);
    } catch (err) {
      this.clients.delete(reply);
    }
  }

  private async persist(telemetry: QkdTelemetry): Promise<void> {
    await prisma.qkdTelemetryLog.create({
      data: {
        sourceNode: telemetry.sourceNode,
        targetNode: telemetry.targetNode,
        qber: telemetry.qber,
        photonLossDb: telemetry.photonLossDb,
        photonDetectionRate: telemetry.photonDetectionRate,
        rawKeyRateBps: telemetry.rawKeyRateBps,
        secretKeyRateBps: telemetry.secretKeyRateBps,
        channelState: telemetry.channelState,
        anomalyDetected: false, // Will be updated by MonitorService
        privacyAmplificationActive: telemetry.privacyAmplificationActive,
        privacyAmplificationRatio: telemetry.privacyAmplificationRatio ?? null,
        recordedAt: telemetry.timestamp,
      },
    });
  }
}
