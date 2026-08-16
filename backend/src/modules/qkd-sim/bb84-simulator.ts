import {
  DEFAULT_CHANNEL_PARAMS,
  calculateQber,
  calculateSecretKeyRate,
  calculateTransmittance,
  calculatePrivacyAmplificationRatio,
  type ChannelSimState,
  type QkdChannelParameters,
  type QkdTelemetry,
} from './channel-model.js';

/**
 * BB84 Quantum Channel Simulator with dynamic state machine.
 *
 * Generates realistic QKD telemetry by modeling four channel states:
 * - NORMAL: healthy operation within expected optical parameters
 * - TURBULENCE: elevated noise (environmental, fiber stress)
 * - ANOMALOUS: statistically abnormal QBER suggesting possible interference
 * - DEAD: complete optical loss, no key generation
 *
 * The simulator emits telemetry every 2 seconds and notifies all
 * registered callbacks (used by the SSE endpoint and monitor service).
 */
export class BB84Simulator {
  private state: ChannelSimState = 'NORMAL';
  private params: QkdChannelParameters;
  private callbacks: Set<(telemetry: QkdTelemetry) => void> = new Set();
  private intervalRef?: ReturnType<typeof setInterval>;

  // Track rolling QBER history for trend analysis
  private qberHistory: number[] = [];
  private readonly HISTORY_SIZE = 60;

  constructor(
    private readonly sourceNode: string = 'qkm-node-alpha',
    private readonly targetNode: string = 'qkm-node-beta',
    params?: Partial<QkdChannelParameters>,
  ) {
    this.params = { ...DEFAULT_CHANNEL_PARAMS, ...params };
  }

  /**
   * Start emitting telemetry at the specified interval.
   * Default: every 2 seconds.
   */
  start(intervalMs = 2000): void {
    if (this.intervalRef) this.stop();
    this.intervalRef = setInterval(() => {
      const telemetry = this.generateTelemetry();
      this.notify(telemetry);
    }, intervalMs);
    console.log(`[BB84Sim] Started — emitting every ${intervalMs}ms`);
  }

  stop(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = undefined;
    }
  }

  /**
   * Transition the simulated channel to a different state.
   * Used by the /admin/simulate-disturbance endpoint for demo scenarios.
   */
  transitionTo(newState: ChannelSimState): void {
    const prev = this.state;
    this.state = newState;
    console.log(`[BB84Sim] Channel state transition: ${prev} → ${newState}`);
  }

  /**
   * Get the current channel state.
   */
  getState(): ChannelSimState {
    return this.state;
  }

  /**
   * Register a callback to receive telemetry updates.
   */
  onTelemetry(callback: (telemetry: QkdTelemetry) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Generate a single telemetry snapshot for the current channel state.
   */
  getCurrentTelemetry(): QkdTelemetry {
    return this.generateTelemetry();
  }

  // ---------------------------------------------------------------------------
  // Private: telemetry generation per channel state
  // ---------------------------------------------------------------------------

  private generateTelemetry(): QkdTelemetry {
    const now = new Date();

    if (this.state === 'DEAD') {
      return {
        timestamp: now,
        qber: 1.0,
        photonLossDb: 999,
        photonDetectionRate: 0,
        rawKeyRateBps: 0,
        secretKeyRateBps: 0,
        channelState: 'DEAD',
        basisMatchingRate: 0,
        privacyAmplificationActive: false,
        sourceNode: this.sourceNode,
        targetNode: this.targetNode,
      };
    }

    // Generate QBER with state-dependent noise
    const additionalNoise = this.stateNoise();
    const qber = Math.max(
      0.008,
      calculateQber(this.params, additionalNoise) + this.gaussianNoise(0, 0.003),
    );

    const transmittance = calculateTransmittance(this.params);
    const photonLossDb = -10 * Math.log10(transmittance + 1e-10);
    const photonDetectionRate =
      transmittance * this.params.meanPhotonNumber * 1e9 * (1 + this.gaussianNoise(0, 0.02));

    const rawKeyRateBps = Math.max(0, Math.floor(photonDetectionRate * 0.5));
    const secretKeyRateBps = calculateSecretKeyRate(this.params, qber);

    // Privacy amplification kicks in when QBER is elevated but below fatal threshold
    const privacyAmplificationActive = qber > 0.04 && qber < 0.11;
    const privacyAmplificationRatio = privacyAmplificationActive
      ? calculatePrivacyAmplificationRatio(qber)
      : undefined;

    // Determine channel health label
    const channelState: QkdTelemetry['channelState'] =
      qber > 0.085 ? 'ANOMALOUS' : qber > 0.04 ? 'TURBULENCE' : 'HEALTHY';

    // Track QBER history
    this.qberHistory.push(qber);
    if (this.qberHistory.length > this.HISTORY_SIZE) {
      this.qberHistory.shift();
    }

    return {
      timestamp: now,
      qber,
      photonLossDb: Math.max(0, photonLossDb),
      photonDetectionRate: Math.max(0, photonDetectionRate),
      rawKeyRateBps,
      secretKeyRateBps,
      channelState,
      basisMatchingRate: 0.5 + this.gaussianNoise(0, 0.02),
      privacyAmplificationActive,
      privacyAmplificationRatio,
      sourceNode: this.sourceNode,
      targetNode: this.targetNode,
    };
  }

  private stateNoise(): number {
    switch (this.state) {
      case 'NORMAL':
        return this.gaussianNoise(0, 0.002);
      case 'TURBULENCE':
        return 0.035 + this.gaussianNoise(0, 0.008);
      case 'ANOMALOUS':
        return 0.074 + this.gaussianNoise(0, 0.012);
      case 'DEAD':
        return 1.0;
    }
  }

  private gaussianNoise(mean: number, stdDev: number): number {
    // Box-Muller transform for Gaussian random variable
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z;
  }

  private notify(telemetry: QkdTelemetry): void {
    for (const cb of this.callbacks) {
      try {
        cb(telemetry);
      } catch (err) {
        console.error('[BB84Sim] Callback error:', err);
      }
    }
  }
}
