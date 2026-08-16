import type { QuMailEnvelope } from './interfaces.js';

// The QuMail envelope is embedded in the email body using a special HTML comment
// so that regular email clients can still read a human-friendly note.
const QUMAIL_START_MARKER = '<!--QUMAIL_ENVELOPE_START:';
const QUMAIL_END_MARKER = ':QUMAIL_ENVELOPE_END-->';

const QUMAIL_VERSION_HEADER = 'X-QuMail-Version';

/**
 * Detect whether an email message contains a QuMail encrypted envelope.
 * Checks both the X-QuMail-Version header and the message body for the envelope marker.
 */
export function isQuMailMessage(
  headers: Record<string, string>,
  bodyPlain: string,
): boolean {
  const headerPresent = Boolean(
    headers[QUMAIL_VERSION_HEADER] || headers[QUMAIL_VERSION_HEADER.toLowerCase()],
  );
  const bodyMarkerPresent = bodyPlain.includes(QUMAIL_START_MARKER);
  return headerPresent || bodyMarkerPresent;
}

/**
 * Extract and parse a QuMail envelope from the message body.
 * Returns null if no valid envelope is found.
 */
export function parseEnvelope(bodyPlain: string): QuMailEnvelope | null {
  const startIdx = bodyPlain.indexOf(QUMAIL_START_MARKER);
  const endIdx = bodyPlain.indexOf(QUMAIL_END_MARKER);

  if (startIdx === -1 || endIdx === -1) return null;

  const jsonStr = bodyPlain
    .substring(startIdx + QUMAIL_START_MARKER.length, endIdx)
    .trim();

  try {
    return JSON.parse(jsonStr) as QuMailEnvelope;
  } catch {
    console.error('[EnvelopeParser] Failed to parse QuMail envelope JSON');
    return null;
  }
}

/**
 * Serialize a QuMail envelope into a human-readable email body.
 * Regular email clients will see the human-readable note but not the JSON.
 * QuMail clients will detect and parse the envelope.
 */
export function buildQuMailEmailBody(
  envelope: QuMailEnvelope,
  humanReadableNote: string,
): string {
  const envelopeJson = JSON.stringify(envelope, null, 2);
  return [
    humanReadableNote,
    '',
    '---',
    '⚛️  This message was sent with QuMail Quantum-Secured Email.',
    `   Security Level: ${securityLevelLabel(envelope.securityLevel)}`,
    `   Key ID: ${envelope.crypto.keyId}`,
    '   To read this message, you need the QuMail client.',
    '   Learn more at: https://qumail.io',
    '',
    QUMAIL_START_MARKER,
    envelopeJson,
    QUMAIL_END_MARKER,
  ].join('\n');
}

/**
 * Build the complete MIME email body as a multipart message.
 * The text/plain part contains a human-readable fallback.
 * The QuMail envelope is embedded in the text/plain part.
 */
export function buildMimeBody(
  from: string,
  to: string[],
  subject: string,
  plainBody: string,
  htmlBody?: string,
  extraHeaders?: Record<string, string>,
): string {
  const boundary = `QuMail_${Math.random().toString(36).substring(2)}_${Date.now()}`;
  const toHeader = to.join(', ');

  const headers: Record<string, string> = {
    From: from,
    To: toHeader,
    Subject: subject,
    'MIME-Version': '1.0',
    'Content-Type': `multipart/alternative; boundary="${boundary}"`,
    'X-QuMail-Version': '1.0.0',
    ...extraHeaders,
  };

  const headerBlock = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');

  const parts: string[] = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    plainBody,
  ];

  if (htmlBody) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      htmlBody,
    );
  }

  parts.push(`--${boundary}--`);

  return [headerBlock, '', ...parts].join('\r\n');
}

function securityLevelLabel(level: number): string {
  switch (level) {
    case 1: return 'Standard (Level 1)';
    case 2: return 'Quantum-AES (Level 2)';
    case 3: return 'Quantum-OTP (Level 3)';
    default: return `Level ${level}`;
  }
}
