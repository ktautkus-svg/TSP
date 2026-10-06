import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_VOICE_UPSTREAM = 'https://firo-voice-dmfmgwluca-lz.a.run.app';
const MAX_AUDIO_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 26_000;

export function voiceUpstreamBase(envUrl = process.env.VOICE_API_URL): string {
  const configured = envUrl?.trim();
  return (configured || DEFAULT_VOICE_UPSTREAM).replace(/\/+$/, '');
}

export async function readLimitedBody(request: AsyncIterable<Uint8Array | string>, maxBytes = MAX_AUDIO_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new VoiceProxyError(413, 'AUDIO_TOO_LARGE', 'Įrašas per ilgas. Pakartokite trumpą komandą.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function forwardVoiceAudio(
  body: Buffer,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
  upstreamBase = voiceUpstreamBase(),
): Promise<{ status: number; body: string }> {
  if (body.length < 64) {
    throw new VoiceProxyError(400, 'EMPTY_AUDIO', 'Įrašas tuščias. Palaikykite mygtuką ir pakartokite komandą.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${upstreamBase}/api/voice-command`, {
      method: 'POST',
      headers: { 'content-type': contentType || 'application/octet-stream' },
      body: new Uint8Array(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new VoiceProxyError(502, 'VOICE_UPSTREAM', 'Nepavyko atpažinti balso. Bandykite dar kartą.');
    }
    return { status: 200, body: text };
  } catch (error) {
    if (error instanceof VoiceProxyError) throw error;
    throw new VoiceProxyError(504, 'VOICE_TIMEOUT', 'Nepavyko atpažinti balso. Bandykite dar kartą.');
  } finally {
    clearTimeout(timer);
  }
}

export async function handleVoiceCommandProxy(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (request.method !== 'POST') {
    return sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Nepavyko atpažinti balso. Bandykite dar kartą.' } });
  }
  try {
    const body = await readLimitedBody(request);
    const contentType = String(request.headers['content-type'] ?? 'application/octet-stream');
    const forwarded = await forwardVoiceAudio(body, contentType, fetchImpl);
    logVoice({ event: 'voice_command', requestId, bytes: body.length, mime: contentType.split(';')[0], status: 200 });
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(forwarded.body);
  } catch (error) {
    const proxyError = error instanceof VoiceProxyError
      ? error
      : new VoiceProxyError(502, 'VOICE_PROXY', 'Nepavyko atpažinti balso. Bandykite dar kartą.');
    logVoice({ event: 'voice_command_failed', requestId, category: proxyError.code, status: proxyError.status });
    sendJson(response, proxyError.status, { error: { code: proxyError.code, message: proxyError.message } });
  }
}

export class VoiceProxyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function logVoice(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...event, at: new Date().toISOString() }));
}
