import {
  excelAttachmentsFromPayload,
  gmailAuthorizationUrl,
  headerValue,
  type MailMessageSummary,
  type MailPayloadPart,
  type MailSearchInput,
  buildGmailSearchQuery,
} from '../src/domain/mail-excel.js';

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: string;
};

export type GmailTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
};

export class GmailProviderError extends Error {
  constructor(readonly code: string) {
    super('Gmail prisijungimas nepavyko.');
    this.name = 'GmailProviderError';
  }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MESSAGE_FIELDS = 'id,payload(headers,mimeType,filename,body/attachmentId,body/size,parts(filename,mimeType,body/attachmentId,body/size,parts(filename,mimeType,body/attachmentId,body/size)))';

export function readGmailOAuthConfig(env: NodeJS.ProcessEnv = process.env): GmailOAuthConfig | null {
  const clientId = configurationValue(env.GMAIL_OAUTH_CLIENT_ID, 'GMAIL_OAUTH_CLIENT_ID');
  const clientSecret = configurationValue(env.GMAIL_OAUTH_CLIENT_SECRET, 'GMAIL_OAUTH_CLIENT_SECRET');
  const redirectUri = configurationValue(env.GMAIL_OAUTH_REDIRECT_URI, 'GMAIL_OAUTH_REDIRECT_URI');
  // Encryption key material is opaque and may legitimately contain '='. Keep
  // it byte-for-byte stable so already connected mailboxes remain decryptable.
  const tokenKey = env.MAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
  if (!clientId || !clientSecret || !redirectUri || !tokenKey) return null;
  return { clientId, clientSecret, redirectUri, tokenKey };
}

export function gmailConnectUrl(config: GmailOAuthConfig, state: string): string {
  return gmailAuthorizationUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state });
}

export async function exchangeGmailCode(
  config: GmailOAuthConfig,
  code: string,
  fetcher: typeof fetch,
): Promise<GmailTokens> {
  const tokens = await requestTokens(config, {
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  }, fetcher);
  const email = await gmailAddress(tokens.accessToken, fetcher);
  return { ...tokens, email };
}

export async function refreshGmailAccessToken(
  config: GmailOAuthConfig,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<{ accessToken: string; expiresAt: string; refreshToken: string }> {
  const tokens = await requestTokens(config, {
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }, fetcher);
  return {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken || refreshToken,
  };
}

export async function listGmailExcelMessages(
  accessToken: string,
  search: MailSearchInput,
  fetcher: typeof fetch,
): Promise<MailMessageSummary[]> {
  const query = buildGmailSearchQuery(search);
  const listUrl = new URL(`${GMAIL_API}/messages`);
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', '15');
  const listed = await gmailJson<{ messages?: { id: string }[] }>(listUrl, accessToken, fetcher);
  const summaries: MailMessageSummary[] = [];
  for (const message of listed.messages ?? []) {
    const detailUrl = new URL(`${GMAIL_API}/messages/${encodeURIComponent(message.id)}`);
    detailUrl.searchParams.set('format', 'full');
    detailUrl.searchParams.set('fields', MESSAGE_FIELDS);
    const detail = await gmailJson<{ id: string; payload?: MailPayloadPart }>(detailUrl, accessToken, fetcher);
    const attachments = excelAttachmentsFromPayload(detail.payload);
    if (attachments.length === 0) continue;
    summaries.push({
      id: detail.id,
      from: headerValue(detail.payload, 'From'),
      subject: headerValue(detail.payload, 'Subject'),
      date: headerValue(detail.payload, 'Date'),
      attachments,
    });
  }
  return summaries;
}

export async function downloadGmailAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  assertGmailId(messageId);
  assertGmailId(attachmentId);
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  const payload = await gmailJson<{ data?: string; size?: number }>(url, accessToken, fetcher);
  if (!payload.data) throw new Error('Excel priedas tuščias.');
  if ((payload.size ?? 0) > 8_000_000) throw new Error('Excel priedas per didelis importui.');
  const bytes = Buffer.from(payload.data, 'base64url');
  if (bytes.byteLength > 8_000_000) throw new Error('Excel priedas per didelis importui.');
  return new Uint8Array(bytes);
}

async function gmailAddress(accessToken: string, fetcher: typeof fetch): Promise<string> {
  const profile = await gmailJson<{ emailAddress?: string }>(new URL(`${GMAIL_API}/profile`), accessToken, fetcher);
  return profile.emailAddress?.trim() || 'gmail';
}

async function requestTokens(
  config: GmailOAuthConfig,
  fields: Record<string, string>,
  fetcher: typeof fetch,
): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...fields,
  });
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok) throw new GmailProviderError(safeProviderCode(payload.error, response.status));
  if (!payload.access_token) throw new Error('Gmail negrąžino prieigos rakto.');
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? '',
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    email: '',
  };
}

async function gmailJson<T>(url: URL, accessToken: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  if (!response.ok) throw new Error('Gmail laiškų perskaityti nepavyko.');
  return response.json() as Promise<T>;
}

function assertGmailId(value: string): void {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error('Neteisingas laiško identifikatorius.');
}

function configurationValue(raw: string | undefined, name: string): string {
  const value = raw?.trim() ?? '';
  // A common Cloud Run UI mistake is pasting NAME=value into the value field.
  // Refuse it explicitly instead of sending the malformed secret to Google.
  return value.startsWith(`${name}=`) ? '' : value;
}

function safeProviderCode(value: string | undefined, status: number): string {
  const normalized = (value ?? '').toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return normalized || `http_${status}`;
}
