import { SignJWT, jwtVerify } from 'jose';
import { config } from '../../config/env.js';

interface SessionClaims {
  userId: string;
  email: string;
}

/**
 * JWT-based session management for QuMail.
 *
 * Uses jose library with HS256 signing. Sessions expire after 24 hours.
 * Tokens are stored in HttpOnly, SameSite=Strict cookies to prevent
 * JavaScript access and CSRF attacks.
 */
export class AuthService {
  private readonly secret: Uint8Array;
  private readonly EXPIRY = '24h';

  constructor() {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  /**
   * Create a signed JWT session token for an authenticated user.
   */
  async createSession(userId: string, email: string): Promise<string> {
    return new SignJWT({ userId, email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.EXPIRY)
      .setSubject(userId)
      .setIssuer('qumail')
      .sign(this.secret);
  }

  /**
   * Verify and decode a session token.
   * Throws if the token is expired, tampered, or invalid.
   */
  async verifySession(token: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: 'qumail',
      algorithms: ['HS256'],
    });

    if (!payload.userId || !payload.email) {
      throw new Error('Invalid session payload');
    }

    return {
      userId: payload.userId as string,
      email: payload.email as string,
    };
  }
}

// ---------------------------------------------------------------------------
// Token encryption utilities
// AES-256-GCM envelope encryption for OAuth tokens stored in the database.
// The master key is derived from JWT_SECRET to avoid needing an extra secret.
// ---------------------------------------------------------------------------
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const TOKEN_MASTER_KEY = scryptSync(config.JWT_SECRET, 'qumail-token-salt', 32);

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', TOKEN_MASTER_KEY, iv, {
    authTagLength: 16,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Pack as: iv (12 bytes) + authTag (16 bytes) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(encryptedBase64: string): string {
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = createDecipheriv('aes-256-gcm', TOKEN_MASTER_KEY, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
