import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  canUseBrowserVoiceRecording,
  microphoneErrorMessage,
  pickRecorderMimeType,
  sendVoiceCommand,
  voiceButtonLabel,
  voiceRequestErrorMessage,
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
  start: (timeslice?: number) => void;
  stop: () => void;
  requestData?: () => void;
  state?: string;
  stream: { getTracks: () => { stop: () => void }[] };
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void | Promise<void>) | null;
  onerror: (() => void) | null;
};

const MAX_RECORDING_MS = 8_000;
const CHUNK_MS = 250;
const FLUSH_MS = 80;
const SILENCE_STOP_MS = 1_200;
const SPEECH_RMS = 0.035;

export function VoiceCommandButton({ disabled = false, onAction }: VoiceCommandButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorderRef = useRef<BrowserRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finishingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<{ close: () => void } | null>(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const [state, setState] = useState<VoiceState>('idle');
  const [result, setResult] = useState<VoiceCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = Platform.OS === 'web' && canUseBrowserVoiceRecording();

  const stopTracks = (recorder: BrowserRecorder | null) => {
    recorder?.stream.getTracks().forEach((track) => track.stop());
  };

  const stopSilenceWatch = () => {
    if (silenceTimerRef.current !== null) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const finishRecording = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    stopSilenceWatch();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopTracks(recorder);
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/mp4' });
    chunksRef.current = [];
    if (blob.size < 64) {
      finishingRef.current = false;
      setResult(null);
      setError('Įrašas tuščias. Palaikykite mygtuką ir pakartokite komandą.');
      setState('error');
      return;
    }
    setState('processing');
    try {
      const next = await sendVoiceCommand(blob);
      setResult(next);
      setError(null);
      if (next.action === 'none') {
        setState('idle');
        return;
      }
      try {
        await Promise.resolve(onActionRef.current(next.action));
        setState('idle');
      } catch {
        setError('Komanda atpažinta, bet veiksmas nepavyko.');
        setState('error');
      }
    } catch (reason) {
      setResult(null);
      setError(voiceRequestErrorMessage(reason));
      setState('error');
    } finally {
      finishingRef.current = false;
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    stopSilenceWatch();
    try {
      if (recorder.state !== 'inactive') recorder.requestData?.();
    } catch {
      // Safari may reject requestData after the track has already ended.
    }
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
        return;
      }
    } catch {
      stopTracks(recorder);
      recorderRef.current = null;
      void finishRecording();
      return;
    }
    stopTracks(recorder);
    recorderRef.current = null;
    void finishRecording();
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
    let recorder: BrowserRecorder;
    try {
      recorder = (mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)) as BrowserRecorder;
    } catch (reason) {
      stream.getTracks().forEach((track) => track.stop());
      throw reason;
    }
    chunksRef.current = [];
    finishingRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      globalThis.setTimeout(() => {
        void finishRecording();
      }, FLUSH_MS);
    };
    recorder.onerror = () => {
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      stopSilenceWatch();
      stopTracks(recorder);
      recorderRef.current = null;
      setError('Įrašymas nutrūko. Mikrofonas išjungtas.');
      setState('error');
    };
    recorderRef.current = recorder;
    recorder.start(CHUNK_MS);
    watchForSilence(stream);
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current === recorder) stopRecording();
    }, MAX_RECORDING_MS);
    setError(null);
    setResult(null);
    setState('recording');
  };

  const watchForSilence = (stream: MediaStream) => {
    const AudioContextCtor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = context;
      const samples = new Uint8Array(analyser.fftSize);
      let heardSpeech = false;
      let silenceMs = 0;
      silenceTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const rms = Math.sqrt(energy / samples.length);
        if (rms >= SPEECH_RMS) {
          heardSpeech = true;
          silenceMs = 0;
          return;
        }
        if (!heardSpeech) return;
        silenceMs += 100;
        if (silenceMs >= SILENCE_STOP_MS) stopRecording();
      }, 100);
    } catch {
      // Silence detection is optional. The BAIGTI button and 8s cap still stop the mic.
    }
  };

  const stopRecordingRef = useRef<() => void>(() => {});
  stopRecordingRef.current = stopRecording;

  const toggleRecording = () => {
    if (disabled || state === 'processing') return;
    if (state === 'recording') {
      stopRecording();
      return;
    }
    void startRecording().catch((reason) => {
      setError(microphoneErrorMessage(reason));
      setState('error');
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const releaseIfHidden = () => {
      if (document.visibilityState === 'hidden') stopRecordingRef.current();
    };
    const releaseOnPageHide = () => stopRecordingRef.current();
    document.addEventListener('visibilitychange', releaseIfHidden);
    window.addEventListener('pagehide', releaseOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', releaseIfHidden);
      window.removeEventListener('pagehide', releaseOnPageHide);
      if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current);
      stopSilenceWatch();
      stopTracks(recorderRef.current);
      recorderRef.current = null;
    };
  }, []);

  const buttonLabel = voiceButtonLabel(state);

  return (
    <View style={styles.wrap} testID="voice-command">
      <Pressable
        accessibilityLabel={state === 'recording' ? 'FIRO klauso. Baigti balso komandą' : 'Įrašyti balso komandą'}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || state === 'processing' || !available, busy: state === 'recording' || state === 'processing' }}
        disabled={disabled || state === 'processing' || !available}
        onPress={toggleRecording}
        style={({ pressed }) => [
          styles.button,
          state === 'recording' && styles.recording,
          state === 'processing' && styles.processing,
          (disabled || state === 'processing' || !available) && styles.disabled,
          pressed && styles.pressed,
        ]}
        testID="voice-command-button">
        <MicIcon color={state === 'recording' || state === 'processing' ? colors.textInverse : colors.brandNavy} size={18} />
        <Text style={[styles.buttonText, (state === 'recording' || state === 'processing') && styles.recordingText]}>
          {buttonLabel}
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
  processing: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
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
