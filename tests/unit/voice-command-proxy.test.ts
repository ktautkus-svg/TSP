import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { forwardVoiceAudio, readLimitedBody, VoiceProxyError } from '../../server/voice-command-proxy';

describe('voice command proxy', () => {
  it('forwards the iPhone audio MIME type to the Lithuanian upstream and returns the transcript', async () => {
    const calls: { url: string; contentType?: string; language: string }[] = [];
    const result = await forwardVoiceAudio(
      Buffer.alloc(128, 1),
      'audio/mp4',
      async (input, init) => {
        calls.push({
          url: String(input),
          contentType: new Headers(init?.headers).get('content-type') ?? undefined,
          language: 'lt-LT',
        });
        return new Response(JSON.stringify({
          status: 'success',
          transcription: 'pristatyta',
          action: 'status_delivered',
        }), { status: 200 });
      },
      'https://voice.example.run.app',
    );
    expect(calls).toEqual([{
      url: 'https://voice.example.run.app/api/voice-command',
      contentType: 'audio/mp4',
      language: 'lt-LT',
    }]);
    expect(result.body).toContain('pristatyta');
  });

  it('turns upstream and timeout failures into a Lithuanian error without executing a command', async () => {
    await expect(forwardVoiceAudio(Buffer.alloc(128), 'audio/mp4', async () => new Response('no', { status: 500 }), 'https://voice.example'))
      .rejects.toMatchObject({ code: 'VOICE_UPSTREAM', message: 'Nepavyko atpažinti balso. Bandykite dar kartą.' });
    await expect(forwardVoiceAudio(Buffer.alloc(128), 'audio/webm', async () => {
      throw new Error('socket hang up');
    }, 'https://voice.example')).rejects.toBeInstanceOf(VoiceProxyError);
    await expect(forwardVoiceAudio(Buffer.alloc(8), 'audio/mp4')).rejects.toMatchObject({ code: 'EMPTY_AUDIO' });
  });

  it('rejects an oversized recording before calling the provider', async () => {
    await expect(readLimitedBody((async function* () {
      yield Buffer.alloc(20);
    })(), 10)).rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' });
  });

  it('is wired into the production server before the generic API proxy', () => {
    const server = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');
    expect(server).toContain("url.pathname === '/api/voice-command'");
    expect(server).toContain('handleVoiceCommandProxy');
    expect(server.indexOf("url.pathname === '/api/voice-command'")).toBeLessThan(server.indexOf("url.pathname.startsWith('/api/')"));
  });
});
