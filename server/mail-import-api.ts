import { randomBytes } from 'node:crypto';

import { mailboxBelongsTo } from '../src/domain/mail-excel.js';
import {
  downloadGmailAttachment,
  exchangeGmailCode,
  gmailConnectUrl,
  listGmailExcelMessages,
  readGmailOAuthConfig,
  refreshGmailAccessToken,
  GmailProviderError,
  type GmailOAuthConfig,
} from './gmail-mailbox.js';
import type { MailConnectionRepository, StoredMailConnection } from './mail-connection-store.js';
import { decryptSecret, encryptSecret } from './mail-token-crypto.js';

export type MailApiResult = {
  status: number;
  body?: unknown;
  html?: string;
};

const NOT_CONFIGURED = 'Gmail OAuth nėra sukonfigūruotas. Serveryje reikia GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI ir MAIL_TOKEN_ENCRYPTION_KEY.';

export async function handleMailImport(input: {
  method: string;
  pathname: string;
  url: string;
  body: Record<string, unknown> | null;
  profileId: string | null;
  repository: MailConnectionRepository;
  fetcher?: typeof fetch;
  config?: GmailOAuthConfig | null;
  nowMs?: number;
}): Promise<MailApiResult | null> {
  if (!input.pathname.startsWith('/api/mail/')) return null;
  const fetcher = input.fetcher ?? fetch;
  const config = input.config === undefined ? readGmailOAuthConfig() : input.config;
  const nowMs = input.nowMs ?? Date.now();

  if (input.pathname === '/api/mail/callback' && input.method === 'GET') {
    return callback(input.url, config, input.repository, fetcher);
  }
  if (!input.profileId) return { status: 401, body: { error: { code: 'SESSION_REQUIRED', message: 'Reikia prisijungti.' } } };
  if (!config && input.pathname !== '/api/mail/status') {
    return { status: 503, body: { error: { code: 'MAIL_NOT_CONFIGURED', message: NOT_CONFIGURED } } };
  }

  if (input.pathname === '/api/mail/status' && input.method === 'GET') {
    const connection = config ? await input.repository.getConnection(input.profileId) : null;
    return {
      status: 200,
      body: {
        configured: Boolean(config),
        connected: Boolean(connection && mailboxBelongsTo(connection.userId, input.profileId)),
        email: connection && mailboxBelongsTo(connection.userId, input.profileId) ? connection.email : null,
        message: config ? null : NOT_CONFIGURED,
      },
    };
  }

  if (!config) return { status: 503, body: { error: { code: 'MAIL_NOT_CONFIGURED', message: NOT_CONFIGURED } } };

  if (input.pathname === '/api/mail/connect' && input.method === 'POST') {
    const state = randomBytes(24).toString('base64url');
    await input.repository.saveState(state, input.profileId, new Date(nowMs + 10 * 60_000).toISOString());
    return { status: 200, body: { url: gmailConnectUrl(config, state) } };
  }

  if (input.pathname === '/api/mail/disconnect' && input.method === 'POST') {
    await input.repository.deleteConnection(input.profileId);
    return { status: 204 };
  }

  if (input.pathname === '/api/mail/messages' && input.method === 'GET') {
    const connection = await requireOwnConnection(input.repository, input.profileId);
    const accessToken = await usableAccessToken(config, connection, input.repository, fetcher, nowMs);
    const params = new URL(input.url, 'http://localhost').searchParams;
    const messages = await listGmailExcelMessages(accessToken, {
      from: params.get('from') ?? undefined,
      subject: params.get('subject') ?? undefined,
      filename: params.get('filename') ?? undefined,
      date: params.get('date') ?? undefined,
    }, fetcher);
    return { status: 200, body: { messages } };
  }

  const attachmentMatch = input.pathname.match(/^\/api\/mail\/attachments\/([^/]+)\/([^/]+)$/);
  if (attachmentMatch && input.method === 'GET') {
    const connection = await requireOwnConnection(input.repository, input.profileId);
    const accessToken = await usableAccessToken(config, connection, input.repository, fetcher, nowMs);
    const bytes = await downloadGmailAttachment(
      accessToken,
      decodeURIComponent(attachmentMatch[1]),
      decodeURIComponent(attachmentMatch[2]),
      fetcher,
    );
    const fileName = new URL(input.url, 'http://localhost').searchParams.get('filename') || 'pastas.xlsx';
    return { status: 200, body: { fileName, bytesBase64: Buffer.from(bytes).toString('base64') } };
  }

  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Pašto veiksmas nerastas.' } } };
}

async function callback(
  url: string,
  config: GmailOAuthConfig | null,
  repository: MailConnectionRepository,
  fetcher: typeof fetch,
): Promise<MailApiResult> {
  if (!config) return oauthCompletionPage('error', 'not_configured');
  const params = new URL(url, 'http://localhost').searchParams;
  const providerError = params.get('error');
  if (providerError) return oauthCompletionPage('error', safeCallbackCode(providerError));
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const userId = state ? await repository.consumeState(state) : null;
  if (!code || !userId) return oauthCompletionPage('error', 'invalid_state');
  try {
    const tokens = await exchangeGmailCode(config, code, fetcher);
    if (!tokens.refreshToken) {
      const existing = await repository.getConnection(userId);
      if (!existing || !mailboxBelongsTo(existing.userId, userId)) return oauthCompletionPage('error', 'refresh_token_missing');
      tokens.refreshToken = decryptSecret(existing.refreshToken, config.tokenKey);
    }
    await repository.saveConnection({
      userId,
      provider: 'gmail',
      email: tokens.email,
      refreshToken: encryptSecret(tokens.refreshToken, config.tokenKey),
      accessToken: encryptSecret(tokens.accessToken, config.tokenKey),
      accessTokenExpiresAt: tokens.expiresAt,
    });
    return oauthCompletionPage('connected');
  } catch (error) {
    const code = error instanceof GmailProviderError ? error.code : 'callback_failed';
    // Never log OAuth codes, access tokens, refresh tokens or provider payloads.
    console.error('[gmail-oauth] callback failed', { code });
    return oauthCompletionPage('error', code);
  }
}

async function requireOwnConnection(repository: MailConnectionRepository, userId: string): Promise<StoredMailConnection> {
  const connection = await repository.getConnection(userId);
  if (!connection || !mailboxBelongsTo(connection.userId, userId)) {
    const error = new Error('Pirmiausia prisijunkite prie savo Gmail paskyros.');
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
  return connection;
}

async function usableAccessToken(
  config: GmailOAuthConfig,
  connection: StoredMailConnection,
  repository: MailConnectionRepository,
  fetcher: typeof fetch,
  nowMs: number,
): Promise<string> {
  if (Date.parse(connection.accessTokenExpiresAt) > nowMs + 60_000) {
    return decryptSecret(connection.accessToken, config.tokenKey);
  }
  const refreshToken = decryptSecret(connection.refreshToken, config.tokenKey);
  const refreshed = await refreshGmailAccessToken(config, refreshToken, fetcher);
  await repository.saveConnection({
    ...connection,
    refreshToken: encryptSecret(refreshed.refreshToken, config.tokenKey),
    accessToken: encryptSecret(refreshed.accessToken, config.tokenKey),
    accessTokenExpiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

function oauthCompletionPage(status: 'connected' | 'error', code = ''): MailApiResult {
  const success = status === 'connected';
  const title = success ? 'Gmail prijungtas' : 'Gmail prijungti nepavyko';
  const message = success
    ? 'Grįžkite į FIRO – el. paštas jau paruoštas.'
    : 'Grįžkite į FIRO ir bandykite dar kartą.';
  const payload = JSON.stringify({ type: 'firo:gmail-oauth', status, code: safeCallbackCode(code) }).replaceAll('<', '\\u003c');
  return {
    status: 200,
    html: `<!doctype html><html lang="lt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f7fb;color:#111936;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:28rem;margin:1.5rem;padding:2rem;border:1px solid #d9dfeb;border-radius:16px;background:#fff;text-align:center}h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#657087;line-height:1.5;margin:0}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main><script>try{if(window.opener){window.opener.postMessage(${payload},window.location.origin);setTimeout(function(){window.close()},700)}}catch(e){}</script></body></html>`,
  };
}

function safeCallbackCode(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'unknown';
}

export function mailErrorStatus(error: unknown): MailApiResult {
  const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 502;
  const message = error instanceof Error ? error.message : 'El. pašto nepavyko perskaityti.';
  return { status, body: { error: { code: 'MAIL_IMPORT_FAILED', message } } };
}
