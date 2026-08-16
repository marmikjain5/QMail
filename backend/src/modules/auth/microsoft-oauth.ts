import axios from 'axios';
import { config } from '../../config/env.js';

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

interface MicrosoftUserInfo {
  id: string;
  mail: string;
  userPrincipalName: string;
  displayName: string;
}

export interface MicrosoftOAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userInfo: { id: string; email: string; displayName: string };
}

/**
 * Microsoft OAuth 2.0 implementation for Microsoft Graph API access.
 *
 * Scopes requested:
 * - Mail.Read: Read inbox and message content
 * - Mail.Send: Send messages
 * - Mail.ReadWrite: Manage drafts
 * - User.Read: Read user profile
 * - offline_access: Receive refresh tokens
 *
 * SECURITY: User passwords are never requested or stored.
 * OAuth tokens are encrypted at rest in the database.
 */
export class MicrosoftOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tenantId: string;
  private readonly redirectUri: string;

  private static readonly SCOPES = [
    'Mail.Read',
    'Mail.Send',
    'Mail.ReadWrite',
    'User.Read',
    'offline_access',
  ].join(' ');

  constructor() {
    this.clientId = config.MICROSOFT_CLIENT_ID;
    this.clientSecret = config.MICROSOFT_CLIENT_SECRET;
    this.tenantId = config.MICROSOFT_TENANT_ID;
    this.redirectUri = config.MICROSOFT_REDIRECT_URI;
  }

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private get baseUrl(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
  }

  /**
   * Build the Microsoft OAuth authorization URL.
   */
  buildAuthUrl(state: string): string {
    if (!this.isConfigured) {
      throw new Error(
        'Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in your .env file.',
      );
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: MicrosoftOAuthService.SCOPES,
      response_mode: 'query',
      state,
    });

    return `${this.baseUrl}/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   */
  async exchangeCode(code: string): Promise<MicrosoftOAuthResult> {
    const response = await axios.post<MicrosoftTokenResponse>(
      `${this.baseUrl}/token`,
      new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        scope: MicrosoftOAuthService.SCOPES,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const tokens = response.data;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const userInfo = await this.getUserInfo(tokens.access_token);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      userInfo,
    };
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await axios.post<MicrosoftTokenResponse>(
      `${this.baseUrl}/token`,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        scope: MicrosoftOAuthService.SCOPES,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return {
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
    };
  }

  /**
   * Retrieve user info from Microsoft Graph.
   */
  async getUserInfo(
    accessToken: string,
  ): Promise<{ id: string; email: string; displayName: string }> {
    const response = await axios.get<MicrosoftUserInfo>(
      'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return {
      id: response.data.id,
      email: response.data.mail ?? response.data.userPrincipalName,
      displayName: response.data.displayName,
    };
  }
}
