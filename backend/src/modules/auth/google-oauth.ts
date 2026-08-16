import axios from 'axios';
import { config } from '../../config/env.js';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleOAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userInfo: GoogleUserInfo;
}

/**
 * Google OAuth 2.0 implementation for Gmail API access.
 *
 * Scopes requested:
 * - gmail.readonly: Read inbox and message content
 * - gmail.send: Send messages
 * - gmail.compose: Create and manage drafts
 * - userinfo.email: Read the user's email address
 *
 * SECURITY: User passwords are never requested or stored.
 * OAuth tokens are encrypted at rest in the database.
 */
export class GoogleOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  private static readonly SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
  ].join(' ');

  constructor() {
    this.clientId = config.GOOGLE_CLIENT_ID;
    this.clientSecret = config.GOOGLE_CLIENT_SECRET;
    this.redirectUri = config.GOOGLE_REDIRECT_URI;
  }

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Build the Google OAuth authorization URL.
   * @param state - CSRF protection state parameter
   */
  buildAuthUrl(state: string): string {
    if (!this.isConfigured) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
      );
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: GoogleOAuthService.SCOPES,
      access_type: 'offline', // Required to receive refresh token
      prompt: 'consent', // Force consent screen to always get refresh token
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   */
  async exchangeCode(code: string): Promise<GoogleOAuthResult> {
    const response = await axios.post<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const tokens = response.data;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const userInfo = await this.getUserInfo(tokens.access_token);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      expiresAt,
      userInfo,
    };
  }

  /**
   * Refresh an expired access token using a refresh token.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await axios.post<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const tokens = response.data;
    return {
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };
  }

  /**
   * Retrieve authenticated user info from Google.
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await axios.get<GoogleUserInfo>(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.data;
  }
}
