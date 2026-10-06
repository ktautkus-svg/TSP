import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canUseBrowserVoiceRecording,
  interpretLithuanianCommand,
  microphoneErrorMessage,
  parseVoiceCommandResult,
  pickRecorderMimeType,
  resolveVoiceAction,
  sendVoiceCommand,
  VOICE_LANGUAGE,
  voiceApiBaseUrl,
  voiceAudioFileName,
  voiceButtonLabel,
  voiceCommandUrl,
  voiceStatusLabel,
} from '../../src/application/voice/voice-command';

describe('Lithuanian voice commands', () => {
  it('builds the Cloud Run voice endpoint from the public base URL', () => {
    expect(voiceApiBaseUrl(' https://voice.example.run.app/ ', 'https://fallback.example')).toBe('https://voice.example.run.app');
    expect(voiceCommandUrl('https://voice.example.run.app/')).toBe('https://voice.example.run.app/api/voice-command');
    expect(voiceApiBaseUrl('', 'https://firo-voice-dmfmgwluca-lz.a.run.app')).toBe('https://firo-voice-dmfmgwluca-lz.a.run.app');
  });

  it('accepts only known Firo voice actions', () => {
    expect(resolveVoiceAction('status_delivered')).toBe('status_delivered');
    expect(resolveVoiceAction('open_navigation')).toBe('open_navigation');
    expect(resolveVoiceAction('report_issue')).toBe('report_issue');
    expect(resolveVoiceAction('delete_everything')).toBe('none');
  });

  it('parses a successful ASR payload and posts audio as multipart', async () => {
    expect(parseVoiceCommandResult({
      status: 'success',
      transcription: 'krovinys pristatytas',
      action: 'status_delivered',
    })).toEqual({
      status: 'success',
      transcription: 'krovinys pristatytas',
      action: 'status_delivered',
    });

    const calls: { url: string; method?: string }[] = [];
    const result = await sendVoiceCommand(new Blob([new Uint8Array(128)], { type: 'audio/webm' }), async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({
        status: 'success',
        transcription: 'atidaryk navigaciją',
        action: 'open_navigation',
      }), { status: 200 });
    }, 'https://voice.example.run.app/api/voice-command');

    expect(calls).toEqual([{ url: 'https://voice.example.run.app/api/voice-command', method: 'POST' }]);
    expect(result.action).toBe('open_navigation');
  });

  it('explains idle, listening, transcribing, executed and unrecognized states in Lithuanian', () => {
    expect(VOICE_LANGUAGE).toBe('lt-LT');
    expect(voiceStatusLabel('idle')).toContain('Mikrofonas laukia');
    expect(voiceStatusLabel('idle')).toContain('pristatyta');
    expect(voiceStatusLabel('recording')).toContain('FIRO klauso');
    expect(voiceStatusLabel('recording')).toContain('Įrašoma');
    expect(voiceStatusLabel('processing')).toContain('Atpažįstama');
    expect(voiceStatusLabel('idle', { status: 'success', transcription: 'yra klaida', action: 'report_issue' }))
      .toBe('yra klaida · Komanda įvykdyta: Pažymėti klaidą');
    expect(voiceStatusLabel('idle', { status: 'success', transcription: 'kita stotelė', action: 'none' }))
      .toBe('kita stotelė · Komanda neatpažinta');
    expect(voiceStatusLabel('error', null, 'Mikrofonas neleidžiamas.')).toBe('Mikrofonas neleidžiamas.');
    expect(voiceButtonLabel('idle')).toBe('BALSO KOMANDA');
    expect(voiceButtonLabel('recording')).toBe('KLAUSOSI');
    expect(voiceButtonLabel('processing')).toBe('ATPAŽĮSTAMA');
  });

  it('maps the existing Lithuanian phrases and ignores commands that are not implemented', () => {
    expect(interpretLithuanianCommand('krovinys pristatytas')).toBe('status_delivered');
    expect(interpretLithuanianCommand('pažymėti pristatyta')).toBe('status_delivered');
    expect(interpretLithuanianCommand('atidaryk navigaciją')).toBe('open_navigation');
    expect(interpretLithuanianCommand('yra klaida')).toBe('report_issue');
    expect(interpretLithuanianCommand('pakrauta')).toBe('none');
    expect(interpretLithuanianCommand('kita stotelė')).toBe('none');
    expect(interpretLithuanianCommand('yra problema')).toBe('none');
    expect(parseVoiceCommandResult({ status: 'success', transcription: 'pristatyta', action: 'none' }).action)
      .toBe('status_delivered');
  });

  it('names the upload after the Safari or Chrome mime type and refuses an empty recording', async () => {
    expect(voiceAudioFileName('audio/mp4')).toBe('command.m4a');
    expect(voiceAudioFileName('audio/webm;codecs=opus')).toBe('command.webm');
    await expect(sendVoiceCommand(new Blob(['x'], { type: 'audio/mp4' }), async () => {
      throw new Error('should not post empty audio');
    })).rejects.toThrow('Įrašas tuščias');
    expect(microphoneErrorMessage({ name: 'NotAllowedError', message: 'Permission denied' }))
      .toContain('Mikrofonas neleidžiamas');
  });

  it('picks a supported recorder mime type and refuses environments without getUserMedia', () => {
    expect(pickRecorderMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    expect(canUseBrowserVoiceRecording(undefined)).toBe(false);
  });

  it('wires the mic control into the active delivery stop', () => {
    const delivery = readFileSync(resolve(import.meta.dirname, '../../src/app/route/[id]/delivery.tsx'), 'utf8');
    const button = readFileSync(resolve(import.meta.dirname, '../../src/components/voice-command-button.tsx'), 'utf8');
    expect(delivery).toContain('VoiceCommandButton');
    expect(delivery).toContain("action === 'status_delivered'");
    expect(delivery).toContain("action === 'open_navigation'");
    expect(delivery).toContain("action === 'report_issue'");
    expect(button).toContain('testID="voice-command"');
    expect(button).toContain('testID="voice-command-button"');
    expect(button).toContain('const MAX_RECORDING_MS = 8_000');
    expect(button).toContain('recorder.start(CHUNK_MS)');
    expect(button).toContain("document.visibilityState === 'hidden'");
    expect(button).toContain('pagehide');
    expect(button).toContain('microphoneErrorMessage');
  });
});
