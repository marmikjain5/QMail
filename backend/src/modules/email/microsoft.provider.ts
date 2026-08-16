import axios, { type AxiosInstance } from 'axios';
import type {
  EmailMessage,
  IEmailProvider,
  MessageListResult,
  OAuthTokens,
  SendEmailRequest,
} from './interfaces.js';
import { isQuMailMessage, parseEnvelope, buildQuMailEmailBody } from './envelope-parser.js';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const FOLDER_MAP: Record<string, string> = {
  INBOX: 'Inbox',
  SENT: 'SentItems',
  DRAFTS: 'Drafts',
};

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string;
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  body?: { content: string; contentType: string };
  bodyPreview?: string;
  receivedDateTime: string;
  hasAttachments: boolean;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
}

/**
 * Microsoft Graph API email provider implementation.
 *
 * Uses the Microsoft Graph REST API v1.0 with OAuth 2.0 bearer token.
 * Handles token refresh on 401 responses and QuMail envelope detection.
 */
export class MicrosoftProvider implements IEmailProvider {
  readonly providerType = 'MICROSOFT' as const;
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
      baseURL: GRAPH_API,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

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
    throw new Error('MicrosoftProvider.authenticate() should not be called directly. Use MicrosoftOAuthService.');
  }

  async refreshTokens(rt: string): Promise<{ accessToken: string; expiresAt: Date }> {
    return this.refreshTokenFn(rt);
  }

  async listMessages(
    folder: 'INBOX' | 'SENT' | 'DRAFTS',
    maxResults = 50,
    _pageToken?: string,
  ): Promise<MessageListResult> {
    const folderName = FOLDER_MAP[folder];
    const res = await this.client.get<{ value: GraphMessage[]; '@odata.count'?: number }>(
      `/me/mailFolders/${folderName}/messages`,
      {
        params: {
          $top: maxResults,
          $select:
            'id,conversationId,subject,from,toRecipients,bodyPreview,receivedDateTime,hasAttachments,internetMessageHeaders,body',
          $orderby: 'receivedDateTime desc',
        },
      },
    );

    const messages = res.data.value.map((m) => this.parseMessage(m, folder));
    return {
      messages,
      totalCount: res.data['@odata.count'] ?? messages.length,
    };
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const res = await this.client.get<GraphMessage>(
      `/me/messages/${messageId}?$expand=attachments`,
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

    const body = {
      message: {
        subject: request.subject,
        body: { contentType: 'HTML', content: request.bodyHtml ?? `<pre>${plainBody}</pre>` },
        toRecipients: request.to.map((addr) => ({
          emailAddress: { address: addr },
        })),
        singleValueExtendedProperties: [
          { id: 'String {00020386-0000-0000-C000-000000000046} Name X-QuMail-Version', value: '1.0.0' },
        ],
        internetMessageHeaders: request.qumailEnvelope
          ? [{ name: 'X-QuMail-Version', value: '1.0.0' }]
          : [],
      },
      saveToSentItems: true,
    };

    await this.client.post('/me/sendMail', body);
    return { messageId: `ms-${Date.now()}` };
  }

  async saveDraft(request: SendEmailRequest): Promise<{ draftId: string }> {
    const res = await this.client.post<{ id: string }>('/me/messages', {
      subject: request.subject,
      body: { contentType: 'HTML', content: request.bodyHtml ?? request.bodyPlain },
      toRecipients: request.to.map((addr) => ({
        emailAddress: { address: addr },
      })),
      isDraft: true,
    });
    return { draftId: res.data.id };
  }

  async getUserInfo(): Promise<{ email: string; displayName: string }> {
    const res = await this.client.get<{ mail: string; userPrincipalName: string; displayName: string }>(
      '/me?$select=mail,userPrincipalName,displayName',
    );
    return {
      email: res.data.mail ?? res.data.userPrincipalName,
      displayName: res.data.displayName,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseMessage(msg: GraphMessage, folder: 'INBOX' | 'SENT' | 'DRAFTS'): EmailMessage {
    const bodyContent = msg.body?.content ?? msg.bodyPreview ?? '';
    const isHtml = msg.body?.contentType === 'HTML';
    const bodyPlain = isHtml ? this.stripHtml(bodyContent) : bodyContent;
    const bodyHtml = isHtml ? bodyContent : `<pre>${bodyContent}</pre>`;

    const headers: Record<string, string> = {};
    for (const h of msg.internetMessageHeaders ?? []) {
      headers[h.name.toLowerCase()] = h.value;
    }

    const isEncrypted = isQuMailMessage(headers, bodyPlain);
    const envelope = isEncrypted ? parseEnvelope(bodyPlain) : null;

    return {
      id: msg.id,
      threadId: msg.conversationId,
      sender: msg.from?.emailAddress.address ?? '',
      senderName: msg.from?.emailAddress.name ?? msg.from?.emailAddress.address ?? '',
      recipients: (msg.toRecipients ?? []).map((r) => r.emailAddress.address),
      subject: isEncrypted && envelope?.header.subjectEncrypted
        ? '🔐 (Encrypted Subject)'
        : (msg.subject ?? '(no subject)'),
      bodyHtml,
      bodyPlain,
      headers,
      date: new Date(msg.receivedDateTime),
      hasAttachments: msg.hasAttachments,
      attachmentIds: [],
      isQuMailEncrypted: isEncrypted,
      qumailEnvelope: envelope ?? undefined,
      snippet: msg.bodyPreview ?? '',
      folder,
    };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }
}
