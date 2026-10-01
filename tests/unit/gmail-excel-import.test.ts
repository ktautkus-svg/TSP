import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildGmailSearchQuery,
  excelAttachmentsFromPayload,
  gmailAuthorizationUrl,
  isExcelFileName,
  mailboxBelongsTo,
} from '../../src/domain/mail-excel';
import { MemoryMailConnectionRepository } from '../../server/mail-connection-store';
import { encryptSecret, decryptSecret } from '../../server/mail-token-crypto';
import { handleMailImport, mailErrorStatus } from '../../server/mail-import-api';
import { readGmailOAuthConfig } from '../../server/gmail-mailbox';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const importScreen = readFileSync(resolve(root, 'src/app/import/index.tsx'), 'utf8');
const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://firo.example/api/mail/callback',
  tokenKey: 'test-mail-token-key-with-enough-length',
};

describe('gmail excel import', () => {
  it('asks only for readonly Gmail access and searches by sender, subject, file and date', () => {
    const url = new URL(gmailAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://firo.example/api/mail/callback',
      state: 'state-1',
    }));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(buildGmailSearchQuery({
      from: 'sandelis@example.com',
      subject: 'Ryto maršrutas',
      filename: 'marsrutas.xlsx',
      date: '2026-09-29',
    })).toContain('from:"sandelis@example.com"');
    expect(buildGmailSearchQuery({ date: '2026-09-29' })).toContain('after:2026/09/29');
    expect(buildGmailSearchQuery({ date: '2026-09-29' })).toContain('before:2026/09/30');
    expect(isExcelFileName('Maršrutas.XLSX')).toBe(true);
    expect(isExcelFileName('senas-formatas.xls')).toBe(false);
    expect(isExcelFileName('pastaba.pdf')).toBe(false);
  });

  it('lists excel attachments without returning message body data', () => {
    const attachments = excelAttachmentsFromPayload({
      headers: [{ name: 'Subject', value: 'Ryto maršrutas' }],
      parts: [
        { mimeType: 'text/plain', body: { data: 'secret-body' } },
        { filename: 'marsrutas.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: { attachmentId: 'att-1', size: 1200 } },
        { filename: 'nuotrauka.jpg', body: { attachmentId: 'att-2', size: 50 } },
      ],
    });
    expect(attachments).toEqual([{ id: 'att-1', filename: 'marsrutas.xlsx', size: 1200 }]);
    expect(JSON.stringify(attachments)).not.toContain('secret-body');
  });

  it('stores mailbox tokens encrypted and never shows one employee another mailbox', async () => {
    const token = 'ya29.secret-refresh-token-value';
    const encrypted = encryptSecret(token, config.tokenKey);
    expect(encrypted.cipherText).not.toContain(token);
    expect(decryptSecret(encrypted, config.tokenKey)).toBe(token);

    const repository = new MemoryMailConnectionRepository();
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      seen.push(`${url} ${authorization}`);
      if (url.includes('/messages?')) return jsonResponse({ messages: [{ id: 'msg-1' }] });
      if (url.includes('/messages/msg-1')) {
        return jsonResponse({
          id: 'msg-1',
          payload: {
            headers: [
              { name: 'From', value: 'sandelis@example.com' },
              { name: 'Subject', value: 'Ryto maršrutas' },
              { name: 'Date', value: 'Tue, 29 Sep 2026 08:00:00 +0300' },
            ],
            parts: [{ filename: 'marsrutas.xlsx', body: { attachmentId: 'att-1', size: 20 } }],
          },
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    await repository.saveConnection({
      userId: 'driver-a',
      provider: 'gmail',
      email: 'a@example.com',
      refreshToken: encryptSecret('refresh-a', config.tokenKey),
      accessToken: encryptSecret('access-a', config.tokenKey),
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    const own = await handleMailImport({
      method: 'GET',
      pathname: '/api/mail/messages',
      url: '/api/mail/messages?from=sandelis',
      body: null,
      profileId: 'driver-a',
      repository,
      fetcher,
      config,
      nowMs: Date.parse('2026-09-29T12:00:00.000Z'),
    });
    expect(own?.status).toBe(200);
    expect(JSON.stringify(own?.body)).toContain('marsrutas.xlsx');
    expect(JSON.stringify(own?.body)).not.toContain('secret-body');
    expect(seen.some((line) => line.includes('Bearer access-a'))).toBe(true);

    let otherFailure: unknown;
    try {
      await handleMailImport({
        method: 'GET',
        pathname: '/api/mail/messages',
        url: '/api/mail/messages',
        body: null,
        profileId: 'driver-b',
        repository,
        fetcher,
        config,
        nowMs: Date.parse('2026-09-29T12:00:00.000Z'),
      });
    } catch (error) {
      otherFailure = error;
    }
    expect(mailErrorStatus(otherFailure).status).toBe(409);
    expect(JSON.stringify(mailErrorStatus(otherFailure).body)).not.toContain('access-a');
    expect(mailboxBelongsTo('driver-a', 'driver-b')).toBe(false);
    expect(await repository.getConnection('driver-b')).toBeNull();
  });

  it('hands an email attachment to the same Excel import used for a device file', () => {
    const storeAt = importScreen.indexOf('const storeExcelFiles');
    const ingestAt = importScreen.indexOf('const ingestExcelBytes');
    const parseAt = importScreen.indexOf('parseLogisticsExcelWorkbook(file.bytes');
    expect(storeAt).toBeGreaterThan(-1);
    expect(ingestAt).toBeGreaterThan(storeAt);
    expect(parseAt).toBeGreaterThan(storeAt);
    expect(parseAt).toBeLessThan(ingestAt);
    expect(importScreen).toContain('onImported={ingestExcelBytes}');
    const picker = readFileSync(resolve(root, 'src/components/gmail-excel-picker.tsx'), 'utf8');
    expect(picker).toContain('testID="import-from-email"');
    expect(picker).toContain('Importuoti iš el. pašto');
    expect(picker).toContain("window.open('', 'firo-gmail-oauth'");
    expect(picker).not.toContain('window.location.assign(result.url)');
    expect(picker).not.toContain("outcome.current === 'error' || popup.closed");
    expect(picker).toContain('if (next.connected) setNotice(null)');
  });

  it('rejects Cloud Run values that accidentally include the variable name', () => {
    expect(readGmailOAuthConfig({
      NODE_ENV: 'test',
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'GMAIL_OAUTH_CLIENT_SECRET=wrongly-pasted',
      GMAIL_OAUTH_REDIRECT_URI: 'https://firo.example/api/mail/callback',
      MAIL_TOKEN_ENCRYPTION_KEY: 'token-key',
    })).toBeNull();
  });

  it('finishes OAuth in a lightweight window instead of opening a second FIRO database', async () => {
    const repository = new MemoryMailConnectionRepository();
    await repository.saveState('state-1', 'driver-a', '2099-01-01T00:00:00.000Z');
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 3600 });
      }
      if (url.includes('/profile')) return jsonResponse({ emailAddress: 'a@example.com' });
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const result = await handleMailImport({
      method: 'GET',
      pathname: '/api/mail/callback',
      url: '/api/mail/callback?code=oauth-code&state=state-1',
      body: null,
      profileId: null,
      repository,
      fetcher,
      config,
    });

    expect(result?.status).toBe(200);
    expect(result?.html).toContain('Gmail prijungtas');
    expect(result?.html).toContain('firo:gmail-oauth');
    expect(result?.html).not.toContain('meta http-equiv="refresh"');
    expect(await repository.getConnection('driver-a')).not.toBeNull();
  });
  it('accepts a real long Gmail attachment id and keeps the picker feedback visible', () => {
    const mailbox = readFileSync(resolve(import.meta.dirname, '../../server/gmail-mailbox.ts'), 'utf8');
    // Real attachment ids are long base64url blobs; the 200-character message-id
    // limit rejected every genuine attachment and the click looked dead.
    expect(mailbox).toContain('assertGmailAttachmentId(attachmentId)');
    expect(mailbox).toMatch(/assertGmailAttachmentId[\s\S]*\{1,4000\}/);
    const picker = readFileSync(resolve(import.meta.dirname, '../../src/components/gmail-excel-picker.tsx'), 'utf8');
    // The failure notice sits above the attachment list, not below the fold.
    expect(picker.indexOf('testID="gmail-notice"')).toBeLessThan(picker.indexOf('gmail-attachment-'));
    expect(picker).toContain("accessibilityRole=\"button\"");
    expect(picker).toContain("'Imama…'");
  });

});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
