import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  clearLocationPermissionLock,
  dismissFiroLocationExplanation,
  LOCATION_SETTINGS_INSTRUCTION,
  readLocationPermissionStatus,
  requestSystemLocationPermission,
  shouldShowFiroLocationExplanation,
  shouldShowLocationSettingsInstruction,
  type DeviceLocationPermission,
} from '@/application/location/location-permission';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type } from '@/ui/tokens';

type Props = {
  onGranted?: () => void;
};

/**
 * One FIRO explanation for the whole delivery screen. It is not shown per stop,
 * and it is not the browser permission dialog. The system dialog opens only
 * after the driver taps "Leisti vietą".
 */
export function LocationPermissionPrompt({ onGranted }: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<DeviceLocationPermission | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [showInstruction, setShowInstruction] = useState(false);
  const [busy, setBusy] = useState(false);
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  useEffect(() => {
    let active = true;
    void readLocationPermissionStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      setShowExplanation(shouldShowFiroLocationExplanation(next));
      setShowInstruction(shouldShowLocationSettingsInstruction(next));
      if (next === 'granted') onGrantedRef.current?.();
    });
    return () => {
      active = false;
      clearLocationPermissionLock();
    };
  }, []);

  if (showExplanation) {
    return (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="firo-location-explanation">
        <Text style={[styles.title, { color: colors.text }]}>FIRO gali įsiminti kiemo vietą</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Leidimas reikalingas vieną kartą, kad užbaigus pristatymą būtų išsaugota tiksli iškrovimo koordinatė. Tai nėra pakartotinis klausimas prie kiekvieno sustojimo.
        </Text>
        <View style={styles.row}>
          <Pressable
            disabled={busy}
            testID="firo-location-allow"
            style={[styles.button, { backgroundColor: colors.actionPrimary }]}
            onPress={() => {
              setBusy(true);
              void requestSystemLocationPermission()
                .then((next) => {
                  setStatus(next);
                  setShowExplanation(false);
                  setShowInstruction(shouldShowLocationSettingsInstruction(next));
                  if (next === 'granted') onGranted?.();
                })
                .finally(() => {
                  setBusy(false);
                  clearLocationPermissionLock();
                });
            }}>
            <Text style={[styles.buttonText, { color: colors.textInverse }]}>{busy ? 'Tikrinama…' : 'Leisti vietą'}</Text>
          </Pressable>
          <Pressable
            testID="firo-location-dismiss"
            style={[styles.button, { backgroundColor: colors.surfaceMuted }]}
            onPress={() => {
              dismissFiroLocationExplanation();
              setShowExplanation(false);
              setShowInstruction(true);
            }}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Ne dabar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (showInstruction && status !== 'granted') {
    return (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="firo-location-settings-instruction">
        <Text style={[styles.body, { color: colors.text }]}>{LOCATION_SETTINGS_INSTRUCTION}</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderRadius: radius.md },
  title: { ...type.label },
  body: { ...type.meta },
  row: { flexDirection: 'row', gap: spacing.sm },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md },
  buttonText: { ...type.label },
});
