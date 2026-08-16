import type { QkdTelemetry } from '../qkd-sim/bb84-simulator.js';
import type { AnomalyResult, ThreatResult } from './ml-bridge.js';
import {
  calculatePrivacyAmplificationRatio,
  binaryEntropy,
} from '../qkd-sim/channel-model.js';

const SUSPICIOUS_DOMAINS = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly',
  'shorturl.at', 'is.gd', 'buff.ly', 'ift.tt',
];

const PHISHING_KEYWORDS = [
  'act now', 'urgent', 'verify your account', 'click here immediately',
  'account suspended', 'confirm your identity', 'update your payment',
  'you have won', 'claim your prize', 'limited time offer',
  'your account will be', 'unusual activity detected',
  'verify now', 'action required', 'secure your account',
];

const HIGH_RISK_EXTENSIONS = ['.exe', '.bat', '.ps1', '.vbs', '.js', '.jar', '.msi', '.cmd', '.scr'];
const MEDIUM_RISK_EXTENSIONS = ['.zip', '.rar', '.7z', '.gz'];

/**
 * TypeScript rule-based anomaly detector.
 *
 * Used as a fallback when the Python ML sidecar is unavailable.
 * Implements statistical Z-score analysis for QKD anomaly detection
 * and heuristic-based email threat scoring.
 *
 * NOTE: This is a simplified implementation. The ML sidecar provides
 * more accurate detection using Isolation Forest + Autoencoder + SHAP.
 */
export class RuleBasedDetector {
  private readonly qberHistory: number[] = [];
  private readonly MAX_HISTORY = 60;

  analyzeQkdTelemetry(telemetry: QkdTelemetry[]): AnomalyResult {
    if (telemetry.length === 0) {
      return this.normalResult();
    }

    const latest = telemetry[telemetry.length - 1];
    const qber = latest.qber;

    // Update rolling history
    this.qberHistory.push(qber);
    if (this.qberHistory.length > this.MAX_HISTORY) {
      this.qberHistory.shift();
    }

    // Statistical baseline
    const mean = this.mean(this.qberHistory);
    const std = this.std(this.qberHistory, mean);
    const zScore = std > 0 ? (qber - mean) / std : 0;

    // Classification logic
    if (qber >= 0.11) {
      return {
        anomalyDetected: true,
        anomalyScore: 1.0,
        classification: 'CRITICAL',
        explanation:
          `QBER has exceeded 11% (${(qber * 100).toFixed(1)}%), surpassing the Shor-Preskill ` +
          `security bound for BB84. No secure key material can be extracted. ` +
          `Possible causes: severe eavesdropping attempt, optical hardware failure, or fiber damage.`,
        recommendedAction:
          'Immediately halt key generation. Do not use any keys generated in the last 30 seconds. ' +
          'Investigate channel integrity before resuming.',
        privacyAmplificationNeeded: false,
      };
    }

    if (qber > 0.085 || zScore > 4) {
      const paRatio = calculatePrivacyAmplificationRatio(qber);
      return {
        anomalyDetected: true,
        anomalyScore: 0.8 + Math.min(0.19, (qber - 0.085) * 5),
        classification: 'POSSIBLE_INTERCEPTION',
        explanation:
          `Elevated QBER detected (${(qber * 100).toFixed(2)}%, Z-score: ${zScore.toFixed(1)}). ` +
          `Statistical analysis suggests possible channel interference. ` +
          `This may indicate an intercept-resend attack, optical injection, or severe fiber stress. ` +
          `Note: This is a statistical estimate — definitive interception attribution is not possible.`,
        recommendedAction:
          'Apply adaptive privacy amplification to reduce potential attacker information to negligible levels. ' +
          'Consider downgrading to Level 2 (AES) for current messages.',
        privacyAmplificationNeeded: true,
        privacyAmplificationRatio: paRatio,
      };
    }

    if (qber > 0.04 || zScore > 2.5) {
      const paRatio = calculatePrivacyAmplificationRatio(qber);
      return {
        anomalyDetected: true,
        anomalyScore: 0.4 + Math.min(0.39, (qber - 0.04) * 3),
        classification: 'SUSPICIOUS_NOISE',
        explanation:
          `Elevated channel noise detected (QBER: ${(qber * 100).toFixed(2)}%, Z-score: ${zScore.toFixed(1)}). ` +
          `This level of noise is consistent with environmental turbulence, fiber stress, ` +
          `or partial optical misalignment. Privacy amplification can address this safely.`,
        recommendedAction:
          'Apply conservative privacy amplification. Monitor for further QBER increase.',
        privacyAmplificationNeeded: true,
        privacyAmplificationRatio: paRatio,
      };
    }

    if (latest.photonDetectionRate < 1000 && qber < 0.03) {
      return {
        anomalyDetected: true,
        anomalyScore: 0.3,
        classification: 'HARDWARE_DEGRADATION',
        explanation:
          `Low photon detection rate (${latest.photonDetectionRate.toFixed(0)} counts/s) ` +
          `despite normal QBER suggests a hardware issue — possibly a degraded detector, ` +
          `loose fiber connector, or failing laser source.`,
        recommendedAction: 'Inspect hardware. Check fiber connections and detector calibration.',
        privacyAmplificationNeeded: false,
      };
    }

    return this.normalResult();
  }

  analyzeEmailThreat(email: {
    subject: string;
    bodyPlain: string;
    senderDomain: string;
    senderEmail: string;
    links: string[];
    hasAttachments: boolean;
    attachmentTypes: string[];
  }): ThreatResult {
    let score = 0;
    const reasons: string[] = [];
    const suspiciousLinks: string[] = [];

    // 1. Domain reputation
    if (SUSPICIOUS_DOMAINS.some((d) => email.senderDomain.includes(d))) {
      score += 25;
      reasons.push(`Sender domain matches known URL shortener: ${email.senderDomain}`);
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(email.senderDomain)) {
      score += 30;
      reasons.push('Sender uses raw IP address instead of domain name — highly suspicious');
    }

    // 2. Link analysis
    for (const link of email.links) {
      try {
        const url = new URL(link);
        if (SUSPICIOUS_DOMAINS.some((d) => url.hostname.includes(d))) {
          score += 15;
          suspiciousLinks.push(link);
          reasons.push(`URL shortener detected in link: ${link}`);
        }
        if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
          score += 20;
          suspiciousLinks.push(link);
          reasons.push(`Raw IP address in link: ${link}`);
        }
      } catch { /* skip invalid URLs */ }
    }

    // 3. Content analysis — phishing keywords
    const content = `${email.subject} ${email.bodyPlain}`.toLowerCase();
    const matchedKeywords = PHISHING_KEYWORDS.filter((kw) => content.includes(kw));
    if (matchedKeywords.length > 0) {
      score += Math.min(30, matchedKeywords.length * 8);
      reasons.push(`Phishing keyword(s) detected: ${matchedKeywords.join(', ')}`);
    }

    // 4. Attachment risk
    if (email.hasAttachments) {
      for (const ext of email.attachmentTypes) {
        if (HIGH_RISK_EXTENSIONS.includes(ext.toLowerCase())) {
          score += 20;
          reasons.push(`High-risk attachment type: ${ext}`);
        } else if (MEDIUM_RISK_EXTENSIONS.includes(ext.toLowerCase())) {
          score += 8;
          reasons.push(`Compressed attachment type (verify source): ${ext}`);
        }
      }
    }

    score = Math.min(100, score);

    let classification: ThreatResult['classification'];
    if (score <= 20) classification = 'SAFE';
    else if (score <= 40) classification = 'LOW_RISK';
    else if (score <= 60) classification = 'SUSPICIOUS';
    else if (score <= 80) classification = 'PHISHING';
    else classification = 'MALWARE';

    const recommendedAction =
      score <= 20
        ? 'No action required.'
        : score <= 40
        ? 'Exercise caution — verify the sender before clicking links.'
        : score <= 60
        ? 'Do not click any links. Verify with the sender through a separate channel.'
        : 'Do not open this email. Report to your security team.';

    return {
      threatScore: score,
      classification,
      reasons,
      suspiciousLinks,
      recommendedAction,
    };
  }

  private normalResult(): AnomalyResult {
    return {
      anomalyDetected: false,
      anomalyScore: 0.02 + Math.random() * 0.05,
      classification: 'NORMAL',
      explanation: 'Channel statistics are within expected parameters. No anomalies detected.',
      recommendedAction: 'Continue normal operation.',
      privacyAmplificationNeeded: false,
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private std(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
}
