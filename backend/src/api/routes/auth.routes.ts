import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../database/client.js';
import type { AuthService } from '../../modules/auth/auth.service.js';
import { encryptToken, decryptToken } from '../../modules/auth/auth.service.js';
import type { GoogleOAuthService } from '../../modules/auth/google-oauth.js';
import type { MicrosoftOAuthService } from '../../modules/auth/microsoft-oauth.js';
import { config } from '../../config/env.js';
import { randomBytes } from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}

export function createAuthRoutes(
  authService: AuthService,
  googleOAuth: GoogleOAuthService,
  microsoftOAuth: MicrosoftOAuthService,
) {
  return async function authRoutes(fastify: FastifyInstance) {
    // -------------------------------------------------------------------------
    // Google OAuth Flow
    // -------------------------------------------------------------------------

    fastify.get('/google/start', async (request, reply) => {
      if (!googleOAuth.isConfigured) {
        return reply.status(503).send({
          error: 'Google OAuth not configured',
          message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
        });
      }
      const state = randomBytes(16).toString('hex');
      reply.setCookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600 });
      return reply.redirect(googleOAuth.buildAuthUrl(state));
    });

    fastify.get('/google/callback', async (request, reply) => {
      const { code, state, error } = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (error || !code) {
        return reply.redirect(`${config.FRONTEND_URL}/login?error=oauth_denied`);
      }

      // Validate state (CSRF protection)
      const storedState = request.cookies['oauth_state'];
      if (storedState && state !== storedState) {
        return reply.redirect(`${config.FRONTEND_URL}/login?error=oauth_state_mismatch`);
      }

      try {
        const oauthResult = await googleOAuth.exchangeCode(code);

        // Upsert user
        const user = await prisma.user.upsert({
          where: { email: oauthResult.userInfo.email },
          update: { displayName: oauthResult.userInfo.name },
          create: {
            email: oauthResult.userInfo.email,
            displayName: oauthResult.userInfo.name,
          },
        });

        // Upsert connected account
        await prisma.connectedAccount.upsert({
          where: {
            userId_emailAddress: {
              userId: user.id,
              emailAddress: oauthResult.userInfo.email,
            },
          },
          update: {
            accessTokenEncrypted: encryptToken(oauthResult.accessToken),
            refreshTokenEncrypted: encryptToken(oauthResult.refreshToken),
            tokenExpiresAt: oauthResult.expiresAt,
          },
          create: {
            userId: user.id,
            provider: 'GMAIL',
            providerUserId: oauthResult.userInfo.id,
            emailAddress: oauthResult.userInfo.email,
            accessTokenEncrypted: encryptToken(oauthResult.accessToken),
            refreshTokenEncrypted: encryptToken(oauthResult.refreshToken),
            tokenExpiresAt: oauthResult.expiresAt,
          },
        });

        // Issue JWT session
        const token = await authService.createSession(user.id, user.email);
        reply.setCookie('qumail_session', token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: config.NODE_ENV === 'production',
          maxAge: 86400, // 24h
          path: '/',
        });

        return reply.redirect(`${config.FRONTEND_URL}/inbox`);
      } catch (err) {
        console.error('[Auth] Google OAuth callback error:', err);
        return reply.redirect(`${config.FRONTEND_URL}/login?error=oauth_failed`);
      }
    });

    // -------------------------------------------------------------------------
    // Microsoft OAuth Flow
    // -------------------------------------------------------------------------

    fastify.get('/microsoft/start', async (request, reply) => {
      if (!microsoftOAuth.isConfigured) {
        return reply.status(503).send({
          error: 'Microsoft OAuth not configured',
          message: 'Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in your .env file.',
        });
      }
      const state = randomBytes(16).toString('hex');
      reply.setCookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600 });
      return reply.redirect(microsoftOAuth.buildAuthUrl(state));
    });

    fastify.get('/microsoft/callback', async (request, reply) => {
      const { code, state, error } = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (error || !code) {
        return reply.redirect(`${config.FRONTEND_URL}/login?error=oauth_denied`);
      }

      try {
        const oauthResult = await microsoftOAuth.exchangeCode(code);

        const user = await prisma.user.upsert({
          where: { email: oauthResult.userInfo.email },
          update: { displayName: oauthResult.userInfo.displayName },
          create: {
            email: oauthResult.userInfo.email,
            displayName: oauthResult.userInfo.displayName,
          },
        });

        await prisma.connectedAccount.upsert({
          where: {
            userId_emailAddress: {
              userId: user.id,
              emailAddress: oauthResult.userInfo.email,
            },
          },
          update: {
            accessTokenEncrypted: encryptToken(oauthResult.accessToken),
            refreshTokenEncrypted: encryptToken(oauthResult.refreshToken),
            tokenExpiresAt: oauthResult.expiresAt,
          },
          create: {
            userId: user.id,
            provider: 'MICROSOFT',
            providerUserId: oauthResult.userInfo.id,
            emailAddress: oauthResult.userInfo.email,
            accessTokenEncrypted: encryptToken(oauthResult.accessToken),
            refreshTokenEncrypted: encryptToken(oauthResult.refreshToken),
            tokenExpiresAt: oauthResult.expiresAt,
          },
        });

        const token = await authService.createSession(user.id, user.email);
        reply.setCookie('qumail_session', token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: config.NODE_ENV === 'production',
          maxAge: 86400,
          path: '/',
        });

        return reply.redirect(`${config.FRONTEND_URL}/inbox`);
      } catch (err) {
        console.error('[Auth] Microsoft OAuth callback error:', err);
        return reply.redirect(`${config.FRONTEND_URL}/login?error=oauth_failed`);
      }
    });

    // -------------------------------------------------------------------------
    // Session endpoints
    // -------------------------------------------------------------------------

    fastify.get('/me', {
      preHandler: requireAuth,
    }, async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user!.userId },
        include: { connectedAccounts: { select: { provider: true, emailAddress: true } } },
      });

      if (!user) return reply.status(404).send({ error: 'User not found' });

      return reply.send({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        connectedAccounts: user.connectedAccounts,
      });
    });

    fastify.post('/logout', async (request, reply) => {
      reply.clearCookie('qumail_session', { path: '/' });
      return reply.send({ success: true });
    });
  };
}

// ---------------------------------------------------------------------------
// Auth Guard — used as preHandler on protected routes
// ---------------------------------------------------------------------------

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies['qumail_session'];
  if (!token) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }

  const { AuthService } = await import('../../modules/auth/auth.service.js');
  const authService = new AuthService();

  try {
    const claims = await authService.verifySession(token);
    request.user = claims;
  } catch {
    throw Object.assign(new Error('Invalid or expired session'), { statusCode: 401 });
  }
}
