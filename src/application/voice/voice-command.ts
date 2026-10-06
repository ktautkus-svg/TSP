export const VOICE_ACTIONS = ['status_delivered', 'open_navigation', 'report_issue', 'none'] as const;

export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export type VoiceCommandResult = {
  status: 'success';
  transcription: string;
  action: VoiceAction;
};

export const VOICE_LANGUAGE = 'lt-LT';

const PRODUCTION_VOICE_API_URL = 'https://firo-voice-dmfmgwluca-lz.a.run.app';
const MIN_AUDIO_BYTES = 64;

export function voiceApiBaseUrl(
  envUrl = process.env.EXPO_PUBLIC_VOICE_API_URL,
  fallbackUrl = PRODUCTION_VOICE_API_URL,
): string {
  const configured = envUrl?.trim();
  return (configured || fallbackUrl).replace(/\/+$/, '');
}

export function voiceCommandUrl(baseUrl = ''): string {
  const configured = baseUrl.trim();
  if (!configured) return '/api/voice-command';
  return `${configured.replace(/\/+$/, '')}/api/voice-command`;
}

export function resolveVoiceAction(value: unknown): VoiceAction {
  return VOICE_ACTIONS.includes(value as VoiceAction) ? (value as VoiceAction) : 'none';
}

export function interpretLithuanianCommand(transcription: string): VoiceAction {
  const text = transcription.toLocaleLowerCase(VOICE_LANGUAGE);
  if (text.includes('pristatyt')) return 'status_delivered';
  if (text.includes('navigacij')) return 'open_navigation';
  if (text.includes('klaid')) return 'report_issue';
  return 'none';
}

export function parseVoiceCommandResult(payload: unknown): VoiceCommandResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Serveris grąžino netinkamą atsakymą.');
  }
  const record = payload as Record<string, unknown>;
  if (record.status !== 'success') {
    throw new Error('Balso komandos atpažinti nepavyko.');
  }
  const transcription = typeof record.transcription === 'string' ? record.transcription : '';
  const action = resolveVoiceAction(record.action);
  return {
    status: 'success',
    transcription,
    action: action === 'none' ? interpretLithuanianCommand(transcription) : action,
  };
}

export function voiceActionLabel(action: VoiceAction): string {
  if (action === 'status_delivered') return 'Pažymėti pristatyta';
  if (action === 'open_navigation') return 'Atidaryti navigaciją';
  if (action === 'report_issue') return 'Pažymėti klaidą';
  return 'Komanda neatpažinta';
}

export function voiceStatusLabel(state: 'idle' | 'recording' | 'processing' | 'error', result?: VoiceCommandResult | null, error?: string | null): string {
  if (state === 'recording') return 'FIRO klauso. Kalbėkite, tyla sustabdys įrašą. Arba palieskite BAIGTI.';
  if (state === 'processing') return 'APDOROJU. Atpažįstama lietuviška komanda…';
  if (state === 'error') return error?.trim() || 'Nepavyko susisiekti su balso serveriu.';
  if (result?.transcription) {
    if (result.action === 'none') return `${result.transcription} · Komanda neatpažinta`;
    return `${result.transcription} · Komanda įvykdyta: ${voiceActionLabel(result.action)}`;
  }
  return 'Mikrofonas laukia. Pasakykite: pristatyta, navigacija arba klaida.';
}

export function voiceButtonLabel(state: 'idle' | 'recording' | 'processing' | 'error'): string {
  if (state === 'recording') return 'BAIGTI';
  if (state === 'processing') return 'APDOROJU';
  return 'BALSO KOMANDA';
}

export const VOICE_FAILURE_MESSAGE = 'Nepavyko atpažinti balso. Bandykite dar kartą.';

export function voiceRequestErrorMessage(error: unknown, status?: number): string {
  if (status === 401) return 'Reikia prisijungti.';
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.startsWith('Įrašas tuščias')
      || message.startsWith('Mikrofonas')
      || message.startsWith('Komanda atpažinta')
      || message === 'Reikia prisijungti.'
    ) return message;
  }
  return VOICE_FAILURE_MESSAGE;
}

export function voiceAudioFileName(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'command.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'command.mp3';
  if (mime.includes('wav')) return 'command.wav';
  return 'command.webm';
}

export function microphoneErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError' || /permission|denied|not allowed|neleid/i.test(message)) {
    return 'Mikrofonas neleidžiamas. iPhone nustatymuose leiskite FiRo naudoti mikrofoną ir bandykite dar kartą.';
  }
  if (name === 'NotFoundError') return 'Mikrofonas nerastas.';
  if (name === 'NotReadableError') return 'Mikrofoną jau naudoja kita programa. Uždarykite ją ir bandykite dar kartą.';
  if (name === 'SecurityError' || /secure context|https/i.test(message)) {
    return 'Mikrofonui reikia saugaus HTTPS ryšio. Atidarykite įdiegtą FiRo PWA.';
  }
  return message.trim() || 'Mikrofonas nepasiekiamas.';
}

export async function sendVoiceCommand(
  blob: Blob,
  fetchImpl: typeof fetch = fetch,
  endpoint = voiceCommandUrl(),
): Promise<VoiceCommandResult> {
  if (blob.size < MIN_AUDIO_BYTES) {
    throw new Error('Įrašas tuščias. Palaikykite mygtuką ir pakartokite komandą.');
  }
  const body = new FormData();
  body.append('audio', blob, voiceAudioFileName(blob.type));
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(28_000),
    });
  } catch (error) {
    throw new Error(voiceRequestErrorMessage(error));
  }
  if (!response.ok) {
    throw new Error(voiceRequestErrorMessage(new Error(`status ${response.status}`), response.status));
  }
  return parseVoiceCommandResult(await response.json());
}

export function pickRecorderMimeType(
  isTypeSupported: (type: string) => boolean = (type) => (
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported(type)
      : false
  ),
): string {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ].find((type) => isTypeSupported(type)) ?? '';
}

export function canUseBrowserVoiceRecording(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined = globalThis.navigator?.mediaDevices,
): boolean {
  return Boolean(mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}
