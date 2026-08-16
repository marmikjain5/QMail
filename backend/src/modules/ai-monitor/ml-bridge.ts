import axios from 'axios';
import { config } from '../../config/env.js';
import type { QkdTelemetry } from '../qkd-sim/bb84-simulator.js';
import { RuleBasedDetector } from './rule-based-detector.js';

export interface AnomalyResult {
  anomalyDetected: boolean;
  anomalyScore: number;  // 0.0 – 1.0
  classification: 'NORMAL' | 'SUSPICIOUS_NOISE' | 'POSSIBLE_INTERCEPTION' | 'HARDWARE_DEGRADATION' | 'CRITICAL';
  explanation: string;
  shapValues?: Record<string, number>;
  recommendedAction: string;
  privacyAmplificationNeeded: boolean;
  privacyAmplificationRatio?: number;
}

export interface ThreatResult {
  threatScore: number;  // 0 – 100
  classification: 'SAFE' | 'LOW_RISK' | 'SUSPICIOUS' | 'PHISHING' | 'MALWARE';
  reasons: string[];
  suspiciousLinks: string[];
  recommendedAction: string;
}

/**
 * ML Bridge — connects to the Python FastAPI ML sidecar.
 *
 * Falls back to RuleBasedDetector on timeout or connection error.
 * The ML sidecar provides Isolation Forest + Autoencoder anomaly detection
 * with SHAP explainability, while the TypeScript fallback provides
 * statistical Z-score based detection without requiring Python.
 */
export class MlBridge {
  private readonly fallback: RuleBasedDetector;
  private sidecarAvailable = false;
  private lastHealthCheck = 0;
  private readonly HEALTH_CHECK_INTERVAL = 30_000;

  constructor() {
    this.fallback = new RuleBasedDetector();
    void this.checkHealth();
  }

  /**
   * Analyze a batch of QKD telemetry readings for anomalies.
   */
  async analyzeQkdTelemetry(telemetry: QkdTelemetry[]): Promise<AnomalyResult> {
    if (!this.shouldCallSidecar()) {
      return this.fallback.analyzeQkdTelemetry(telemetry);
    }

    try {
      const res = await axios.post<AnomalyResult>(
        `${config.ML_SIDECAR_URL}/analyze/qkd`,
        {
          readings: telemetry.map((t) => ({
            qber: t.qber,
            photon_loss_db: t.photonLossDb,
            photon_detection_rate: t.photonDetectionRate,
            raw_key_rate_bps: t.rawKeyRateBps,
            secret_key_rate_bps: t.secretKeyRateBps,
            timestamp: t.timestamp.toISOString(),
          })),
        },
        { timeout: 5000 },
      );
      return res.data;
    } catch {
      console.warn('[MlBridge] Sidecar unavailable — using rule-based fallback');
      this.sidecarAvailable = false;
      return this.fallback.analyzeQkdTelemetry(telemetry);
    }
  }

  /**
   * Analyze email content for phishing and threat indicators.
   */
  async analyzeEmailThreat(email: {
    subject: string;
    bodyPlain: string;
    senderDomain: string;
    senderEmail: string;
    links: string[];
    hasAttachments: boolean;
    attachmentTypes: string[];
  }): Promise<ThreatResult> {
    if (!this.shouldCallSidecar()) {
      return this.fallback.analyzeEmailThreat(email);
    }

    try {
      const res = await axios.post<ThreatResult>(
        `${config.ML_SIDECAR_URL}/analyze/email`,
        {
          subject: email.subject,
          body_plain: email.bodyPlain,
          sender_domain: email.senderDomain,
          sender_email: email.senderEmail,
          links: email.links,
          has_attachments: email.hasAttachments,
          attachment_types: email.attachmentTypes,
        },
        { timeout: 5000 },
      );
      return res.data;
    } catch {
      return this.fallback.analyzeEmailThreat(email);
    }
  }

  private shouldCallSidecar(): boolean {
    const now = Date.now();
    if (now - this.lastHealthCheck > this.HEALTH_CHECK_INTERVAL) {
      void this.checkHealth();
    }
    return this.sidecarAvailable;
  }

  private async checkHealth(): Promise<void> {
    this.lastHealthCheck = Date.now();
    try {
      const res = await axios.get(`${config.ML_SIDECAR_URL}/health`, { timeout: 2000 });
      this.sidecarAvailable = res.status === 200;
      if (this.sidecarAvailable) {
        console.log('[MlBridge] ML sidecar is available');
      }
    } catch {
      this.sidecarAvailable = false;
    }
  }
}
