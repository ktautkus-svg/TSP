export const VOICE_ACTIONS = ['status_delivered', 'open_navigation', 'report_issue', 'none'] as const;

export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export type VoiceCommandResult = {
  status: 'success';
  transcription: string;
  action: VoiceAction;
};

const PRODUCTION_VOICE_API_URL = 'https://firo-voice-dmfmgwluca-lz.a.run.app';

export function voiceApiBaseUrl(
  envUrl = process.env.EXPO_PUBLIC_VOICE_API_URL,
  fallbackUrl = PRODUCTION_VOICE_API_URL,
): string {
  const configured = envUrl?.trim();
  return (configured || fallbackUrl).replace(/\/+$/, '');
}

export function voiceCommandUrl(baseUrl = voiceApiBaseUrl()): string {
  return `${voiceApiBaseUrl(baseUrl)}/api/voice-command`;
}

export function resolveVoiceAction(value: unknown): VoiceAction {
  return VOICE_ACTIONS.includes(value as VoiceAction) ? (value as VoiceAction) : 'none';
}

export function parseVoiceCommandResult(payload: unknown): VoiceCommandResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Serveris grąžino netinkamą atsakymą.');
  }
  const record = payload as Record<string, unknown>;
  if (record.status !== 'success') {
    throw new Error('Balso komandos atpažinti nepavyko.');
  }
  return {
    status: 'success',
    transcription: typeof record.transcription === 'string' ? record.transcription : '',
    action: resolveVoiceAction(record.action),
  };
}

export function voiceStatusLabel(state: 'idle' | 'recording' | 'processing' | 'error', result?: VoiceCommandResult | null, error?: string | null): string {
  if (state === 'recording') return 'Įrašoma. Palieskite dar kartą arba palaukite 8 sek.';
  if (state === 'processing') return 'Atpažįstama lietuviška komanda…';
  if (state === 'error') return error?.trim() || 'Nepavyko susisiekti su balso serveriu.';
  if (result?.transcription) {
    const actionLabel = result.action === 'status_delivered'
      ? 'Pažymėti pristatyta'
      : result.action === 'open_navigation'
        ? 'Atidaryti navigaciją'
        : result.action === 'report_issue'
          ? 'Pažymėti klaidą'
          : 'Komanda neatpažinta';
    return `${result.transcription} · ${actionLabel}`;
  }
  return 'Pasakykite: pristatyta, navigacija arba klaida.';
}

export async function sendVoiceCommand(
  blob: Blob,
  fetchImpl: typeof fetch = fetch,
  endpoint = voiceCommandUrl(),
): Promise<VoiceCommandResult> {
  const body = new FormData();
  body.append('audio', blob, 'command.webm');
  const response = await fetchImpl(endpoint, { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`Balso serveris atsakė ${response.status}.`);
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
