import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  canUseBrowserVoiceRecording,
  pickRecorderMimeType,
  sendVoiceCommand,
  voiceStatusLabel,
  type VoiceAction,
  type VoiceCommandResult,
} from '@/application/voice/voice-command';
import { MicIcon } from '@/components/dashboard-icons';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';

type VoiceState = 'idle' | 'recording' | 'processing' | 'error';

type VoiceCommandButtonProps = {
  disabled?: boolean;
  onAction: (action: VoiceAction) => void;
};

type BrowserRecorder = {
  start: () => void;
  stop: () => void;
  stream: { getTracks: () => { stop: () => void }[] };
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void | Promise<void>) | null;
};

const MAX_RECORDING_MS = 8_000;

export function VoiceCommandButton({ disabled = false, onAction }: VoiceCommandButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorderRef = useRef<BrowserRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [state, setState] = useState<VoiceState>('idle');
  const [result, setResult] = useState<VoiceCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = Platform.OS === 'web' && canUseBrowserVoiceRecording();

  const stopTracks = (recorder: BrowserRecorder | null) => {
    recorder?.stream.getTracks().forEach((track) => track.stop());
  };

  const finishRecording = async () => {
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopTracks(recorder);
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
    chunksRef.current = [];
    setState('processing');
    try {
      const next = await sendVoiceCommand(blob);
      setResult(next);
      setError(null);
      setState('idle');
      if (next.action !== 'none') onAction(next.action);
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : 'Nepavyko susisiekti su balso serveriu.');
      setState('error');
    }
  };

  const startRecording = async () => {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Šis įrenginys nepalaiko balso įrašymo. Naudokite Firo PWA naršyklėje.');
      setState('error');
      return;
    }
    const stream = await mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickRecorderMimeType();
    const recorder = (mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)) as BrowserRecorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      void finishRecording();
    };
    recorderRef.current = recorder;
    recorder.start();
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current === recorder) recorder.stop();
    }, MAX_RECORDING_MS);
    setError(null);
    setState('recording');
  };

  const toggleRecording = () => {
    if (disabled || state === 'processing') return;
    if (state === 'recording') {
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      recorderRef.current?.stop();
      return;
    }
    void startRecording().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Mikrofonas nepasiekiamas.');
      setState('error');
    });
  };

  useEffect(() => () => {
    if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current);
    stopTracks(recorderRef.current);
    recorderRef.current = null;
  }, []);

  return (
    <View style={styles.wrap} testID="voice-command">
      <Pressable
        accessibilityLabel={state === 'recording' ? 'Baigti balso komandą' : 'Įrašyti balso komandą'}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || state === 'processing' || !available }}
        disabled={disabled || state === 'processing' || !available}
        onPress={toggleRecording}
        style={({ pressed }) => [
          styles.button,
          state === 'recording' && styles.recording,
          (disabled || state === 'processing' || !available) && styles.disabled,
          pressed && styles.pressed,
        ]}
        testID="voice-command-button">
        <MicIcon color={state === 'recording' ? colors.textInverse : colors.brandNavy} size={18} />
        <Text style={[styles.buttonText, state === 'recording' && styles.recordingText]}>
          {state === 'recording' ? 'BAIGTI ĮRAŠĄ' : 'BALSO KOMANDA'}
        </Text>
      </Pressable>
      <Text style={styles.status} testID="voice-command-status">
        {available
          ? voiceStatusLabel(state, result, error)
          : 'Balso komandos veikia Firo PWA naršyklėje su mikrofonu.'}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  wrap: { gap: 6 },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brandNavy,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  recording: {
    backgroundColor: colors.brandBurgundy,
    borderColor: colors.brandBurgundy,
  },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.88 },
  buttonText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.brandNavy,
  },
  recordingText: { color: colors.textInverse },
  status: { ...type.meta, color: colors.textMuted },
});
