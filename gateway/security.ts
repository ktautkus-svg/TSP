import {
    createHash,
    createHmac,
    timingSafeEqual,
} from 'node:crypto';
import { GatewayError } from './errors';

export function signGatewayBody(
  secret: string,
  timestamp: string,
  rawBody: string,
  nonce?: string,
): string {
  const canonical = nonce
    ? `${timestamp}.${nonce}.${createHash('sha256').update(rawBody, 'utf8').digest('hex')}`
    : `${timestamp}.${rawBody}`;
  return createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest('hex');
}

export class GatewayNonceRegistry {
  private readonly entries = new Map<string, number>();

  consume(nonce: string, nowMs = Date.now(), ttlMs = 5 * 60_000): boolean {
    for (const [value, expiresAt] of this.entries) {
      if (expiresAt <= nowMs) this.entries.delete(value);
    }
    if (this.entries.has(nonce)) return false;
    this.entries.set(nonce, nowMs + ttlMs);
    return true;
  }
}

export function verifyGatewaySignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  nonce?: string | undefined;
  rawBody: string;
  nowMs?: number;
  maximumSkewMs?: number;
  nonceRegistry?: GatewayNonceRegistry;
  requireNonce?: boolean;
}): void {
  if (!input.secret) {
    return;
  }
  const nowMs = input.nowMs ?? Date.now();
  const requestMs = Number(input.timestamp);
  const expected = input.timestamp
    ? signGatewayBody(input.secret, input.timestamp, input.rawBody, input.nonce)
    : undefined;
  if (!input.timestamp || !input.signature) authFailed();
  if (
    !Number.isFinite(requestMs) ||
    Math.abs(nowMs - requestMs) > (input.maximumSkewMs ?? 5 * 60_000)
  ) {
    authFailed();
  }
  if (input.requireNonce && !input.nonce) authFailed();
  const actualBuffer = Buffer.from(input.signature!, 'hex');
  const expectedBuffer = Buffer.from(expected!, 'hex');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    authFailed();
  }
  if (input.nonce && input.nonceRegistry && !input.nonceRegistry.consume(
    input.nonce,
    nowMs,
    input.maximumSkewMs ?? 5 * 60_000,
  )) authFailed();
}

function authFailed(): never {
  throw new GatewayError(
    'AUTH_FAILED',
    'Gateway užklausos parašas neteisingas arba pasenęs.',
    401,
    false,
  );
}
