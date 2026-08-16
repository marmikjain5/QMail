// =============================================================================
// Email Provider Interfaces & QuMail Envelope Types
// =============================================================================

export interface QuMailAttachmentRef {
  attachmentId: string;
  filenameEncrypted: string;
  originalFilename?: string;
  ipfsCid: string;
  sha256Hash: string;
  sizeBytes: number;
  keyId: string;
  keyIdMac?: string;
  blockchainTxRef?: string;
  securityLevel: number;
}

export interface QuMailEnvelope {
  qumailVersion: string;
  securityLevel: number;
  header: {
    messageId: string;
    timestamp: string;
    sender: string;
    recipient: string;
    subjectEncrypted: boolean;
  };
  crypto: {
    algorithm: 'AES-256-GCM' | 'OTP-XOR-HMAC-SHA256';
    keyId: string;
    keyIdMac?: string;
    keyDomain: string;
    iv?: string;
    authTag?: string;
    macTag?: string;
    keyConsumedBytes: number;
    privacyAmplificationApplied?: boolean;
  };
  payload: {
    encryptedSubject: string;
    encryptedBody: string;
  };
  attachments: QuMailAttachmentRef[];
}

export interface EmailMessage {
  id: string;
  threadId: string;
  sender: string;
  senderName: string;
  recipients: string[];
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  headers: Record<string, string>;
  date: Date;
  hasAttachments: boolean;
  attachmentIds: string[];
  isQuMailEncrypted: boolean;
  qumailEnvelope?: QuMailEnvelope;
  snippet: string;
  folder: 'INBOX' | 'SENT' | 'DRAFTS';
}

export interface MessageListResult {
  messages: EmailMessage[];
  nextPageToken?: string;
  totalCount: number;
}

export interface SendEmailRequest {
  to: string[];
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  fromEmail: string;
  fromName?: string;
  attachmentRefs?: QuMailAttachmentRef[];
  qumailEnvelope?: QuMailEnvelope;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userEmail: string;
  userId: string;
  displayName?: string;
}

/**
 * Core email provider interface.
 *
 * Implementations:
 * - GmailProvider: Google Gmail API v1
 * - MicrosoftProvider: Microsoft Graph API v1.0
 *
 * This interface is the ONLY coupling between the email module and
 * the encryption/QKM layer. Adding a new provider (Yahoo, ProtonMail, etc.)
 * requires only implementing this interface.
 */
export interface IEmailProvider {
  readonly providerType: 'GMAIL' | 'MICROSOFT';

  /**
   * Exchange an authorization code for tokens.
   */
  authenticate(authCode: string): Promise<OAuthTokens>;

  /**
   * Refresh an expired access token.
   */
  refreshTokens(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;

  /**
   * List messages in a folder.
   */
  listMessages(
    folder: 'INBOX' | 'SENT' | 'DRAFTS',
    maxResults?: number,
    pageToken?: string,
  ): Promise<MessageListResult>;

  /**
   * Get a single message with full body and parsed QuMail envelope.
   */
  getMessage(messageId: string): Promise<EmailMessage>;

  /**
   * Send an email (raw MIME or provider-native format).
   */
  sendMessage(request: SendEmailRequest): Promise<{ messageId: string }>;

  /**
   * Save a draft.
   */
  saveDraft(request: SendEmailRequest): Promise<{ draftId: string }>;

  /**
   * Get the authenticated user's email address and display name.
   */
  getUserInfo(): Promise<{ email: string; displayName: string }>;
}
