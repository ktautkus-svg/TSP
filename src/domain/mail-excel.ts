// The shared workbook parser supports ZIP-based Excel workbooks. Legacy .xls
// files are intentionally not advertised because importing one would fail only
// after the user had already selected it from Gmail.
export const EXCEL_FILE_EXTENSIONS = ['.xlsx', '.xlsm'] as const;

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export type MailSearchInput = {
  from?: string;
  subject?: string;
  filename?: string;
  date?: string;
};

export type MailAttachmentSummary = {
  id: string;
  filename: string;
  size: number;
};

export type MailMessageSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
  attachments: MailAttachmentSummary[];
};

export type MailPayloadPart = {
  filename?: string;
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MailPayloadPart[];
};

export function isExcelFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLocaleLowerCase('lt-LT');
  return EXCEL_FILE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

/** Removes characters that would break out of a single Gmail search term. */
export function gmailSearchTerm(value: string | undefined): string {
  return (value ?? '').replace(/["\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function buildGmailSearchQuery(input: MailSearchInput): string {
  const parts = ['has:attachment', '(filename:xlsx OR filename:xlsm)'];
  const from = gmailSearchTerm(input.from);
  const subject = gmailSearchTerm(input.subject);
  const filename = gmailSearchTerm(input.filename);
  if (from) parts.push(`from:${quoteGmailTerm(from)}`);
  if (subject) parts.push(`subject:${quoteGmailTerm(subject)}`);
  if (filename) parts.push(`filename:${quoteGmailTerm(filename)}`);
  const date = (input.date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const before = `${next.getUTCFullYear()}/${String(next.getUTCMonth() + 1).padStart(2, '0')}/${String(next.getUTCDate()).padStart(2, '0')}`;
    parts.push(`after:${date.replaceAll('-', '/')}`);
    parts.push(`before:${before}`);
  }
  return parts.join(' ');
}

export function gmailAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', input.state);
  return url.toString();
}

export function excelAttachmentsFromPayload(payload: MailPayloadPart | undefined): MailAttachmentSummary[] {
  const found: MailAttachmentSummary[] = [];
  const walk = (part: MailPayloadPart | undefined) => {
    if (!part) return;
    const filename = part.filename?.trim() ?? '';
    const attachmentId = part.body?.attachmentId;
    if (filename && attachmentId && isExcelFileName(filename)) {
      found.push({ id: attachmentId, filename, size: part.body?.size ?? 0 });
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return found;
}

export function headerValue(payload: MailPayloadPart | undefined, name: string): string {
  const match = payload?.headers?.find((header) => header.name?.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
  return match?.value?.trim() ?? '';
}

/** A mailbox record is readable only by the employee who connected it. */
export function mailboxBelongsTo(connectionUserId: string, requesterId: string): boolean {
  return connectionUserId.length > 0 && connectionUserId === requesterId;
}

function quoteGmailTerm(value: string): string {
  return `"${value.replaceAll('"', '')}"`;
}
