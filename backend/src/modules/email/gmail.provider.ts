import axios, { type AxiosInstance } from 'axios';
import type {
  EmailMessage,
  IEmailProvider,
  MessageListResult,
  OAuthTokens,
  SendEmailRequest,
} from './interfaces.js';
import { isQuMailMessage, parseEnvelope, buildMimeBody, buildQuMailEmailBody } from './envelope-parser.js';

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: GmailPayload;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
}

interface GmailPayload {
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  mimeType?: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const LABEL_MAP: Record<string, string> = {
  INBOX: 'INBOX',
  SENT: 'SENT',
  DRAFTS: 'DRAFT',
};

/**
 * Gmail API v1 email provider implementation.
 *
 * Uses the Gmail REST API with OAuth 2.0 bearer token authentication.
 * Handles MIME multipart parsing, base64url decoding, and automatic
 * token refresh on 401 responses.
 */
export class GmailProvider implements IEmailProvider {
  readonly providerType = 'GMAIL' as const;
  private client: AxiosInstance;

  constructor(
    private accessToken: string,
    private readonly refreshToken: string,
    private readonly onTokenRefresh: (
      newAccessToken: string,
      expiresAt: Date,
    ) => Promise<void>,
    private readonly refreshTokenFn: (
      rt: string,
    ) => Promise<{ accessToken: string; expiresAt: Date }>,
  ) {
    this.client = this.buildClient();
  }

  private buildClient(): AxiosInstance {
    const instance = axios.create({
      baseURL: GMAIL_API,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    // Auto-refresh on 401
    instance.interceptors.response.use(
      (res) => res,
      async (err) => {
        if (err.response?.status === 401 && this.refreshToken) {
          const { accessToken, expiresAt } = await this.refreshTokenFn(this.refreshToken);
          this.accessToken = accessToken;
          await this.onTokenRefresh(accessToken, expiresAt);
          err.config.headers.Authorization = `Bearer ${accessToken}`;
          return instance.request(err.config);
        }
        throw err;
      },
    );

    return instance;
  }

  async authenticate(_authCode: string): Promise<OAuthTokens> {
    throw new Error('GmailProvider.authenticate() should not be called directly. Use GoogleOAuthService.');
  }

  async refreshTokens(rt: string): Promise<{ accessToken: string; expiresAt: Date }> {
    return this.refreshTokenFn(rt);
  }

  async listMessages(
    folder: 'INBOX' | 'SENT' | 'DRAFTS',
    maxResults = 50,
    pageToken?: string,
  ): Promise<MessageListResult> {
    const labelIds = LABEL_MAP[folder];
    const params: Record<string, string | number> = {
      labelIds,
      maxResults,
    };
    if (pageToken) params.pageToken = pageToken;

    const listRes = await this.client.get<GmailListResponse>('/users/me/messages', { params });
    const messageRefs = listRes.data.messages ?? [];

    if (messageRefs.length === 0) {
      return { messages: [], totalCount: 0 };
    }

    // Batch fetch message summaries
    const messages = await Promise.all(
      messageRefs.map((ref) => this.getMessageSummary(ref.id, folder)),
    );

    return {
      messages: messages.filter(Boolean) as EmailMessage[],
      nextPageToken: listRes.data.nextPageToken,
      totalCount: listRes.data.resultSizeEstimate ?? messages.length,
    };
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const res = await this.client.get<GmailMessage>(
      `/users/me/messages/${messageId}?format=full`,
    );
    return this.parseMessage(res.data, 'INBOX');
  }

  async sendMessage(request: SendEmailRequest): Promise<{ messageId: string }> {
    const plainBody = request.qumailEnvelope
      ? buildQuMailEmailBody(
          request.qumailEnvelope,
          'This message is protected by QuMail quantum-secured encryption.',
        )
      : request.bodyPlain;

    const mimeRaw = buildMimeBody(
      request.fromEmail,
      request.to,
      request.subject,
      plainBody,
      request.bodyHtml,
      request.qumailEnvelope
        ? { 'X-QuMail-Version': '1.0.0', 'X-QuMail-Level': String(request.qumailEnvelope.securityLevel) }
        : undefined,
    );

    const raw = Buffer.from(mimeRaw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const res = await this.client.post<{ id: string }>('/users/me/messages/send', { raw });
    return { messageId: res.data.id };
  }

  async saveDraft(request: SendEmailRequest): Promise<{ draftId: string }> {
    const mimeRaw = buildMimeBody(
      request.fromEmail,
      request.to,
      request.subject,
      request.bodyPlain,
      request.bodyHtml,
    );

    const raw = Buffer.from(mimeRaw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const res = await this.client.post<{ id: string }>('/users/me/drafts', {
      message: { raw },
    });
    return { draftId: res.data.id };
  }

  async getUserInfo(): Promise<{ email: string; displayName: string }> {
    const res = await axios.get<{ emailAddress: string; messagesTotal: number }>(
      `${GMAIL_API}/users/me/profile`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    return { email: res.data.emailAddress, displayName: res.data.emailAddress };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getMessageSummary(
    id: string,
    folder: 'INBOX' | 'SENT' | 'DRAFTS',
  ): Promise<EmailMessage | null> {
    try {
      const res = await this.client.get<GmailMessage>(
        `/users/me/messages/${id}?format=metadata&metadataHeaders=From,To,Subject,Date,X-QuMail-Version`,
      );
      return this.parseMessage(res.data, folder);
    } catch {
      return null;
    }
  }

  private parseMessage(msg: GmailMessage, folder: 'INBOX' | 'SENT' | 'DRAFTS'): EmailMessage {
    const headers = this.extractHeaders(msg.payload);
    const from = headers['from'] ?? '';
    const subject = headers['subject'] ?? '(no subject)';
    const to = (headers['to'] ?? '').split(',').map((s) => s.trim());
    const dateStr = headers['date'] ?? '';
    const date = dateStr ? new Date(dateStr) : new Date();

    const { bodyPlain, bodyHtml } = this.extractBody(msg.payload);

    const isEncrypted = isQuMailMessage(headers, bodyPlain);
    const envelope = isEncrypted ? parseEnvelope(bodyPlain) : null;

    // Parse sender name and email
    const senderMatch = from.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
    const senderName = senderMatch ? senderMatch[1].trim() : from;
    const senderEmail = senderMatch ? senderMatch[2].trim() : from;

    return {
      id: msg.id,
      threadId: msg.threadId,
      sender: senderEmail,
      senderName,
      recipients: to,
      subject: isEncrypted && envelope?.header.subjectEncrypted
        ? '🔐 (Encrypted Subject)'
        : subject,
      bodyHtml: bodyHtml ?? bodyPlain,
      bodyPlain,
      headers,
      date,
      hasAttachments: Boolean(msg.payload?.parts?.some((p) => p.body?.size && !p.mimeType?.startsWith('text/'))),
      attachmentIds: [],
      isQuMailEncrypted: isEncrypted,
      qumailEnvelope: envelope ?? undefined,
      snippet: msg.snippet ?? '',
      folder,
    };
  }

  private extractHeaders(payload?: GmailPayload): Record<string, string> {
    if (!payload?.headers) return {};
    return Object.fromEntries(
      payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
    );
  }

  private extractBody(payload?: GmailPayload): { bodyPlain: string; bodyHtml: string } {
    if (!payload) return { bodyPlain: '', bodyHtml: '' };

    let bodyPlain = '';
    let bodyHtml = '';

    const extractFromPart = (part: GmailPayload) => {
      if (part.body?.data) {
        const decoded = Buffer.from(
          part.body.data.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf8');

        if (part.mimeType === 'text/plain') bodyPlain = decoded;
        else if (part.mimeType === 'text/html') bodyHtml = decoded;
      }

      if (part.parts) {
        for (const subPart of part.parts) extractFromPart(subPart);
      }
    };

    extractFromPart(payload);
    return { bodyPlain, bodyHtml };
  }
}
