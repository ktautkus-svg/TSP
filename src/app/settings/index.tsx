import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';

import {
  createPwaBackup,
  parsePwaBackup,
  restorePwaBackup,
  summarizePwaBackup,
} from '@/application/backup/pwa-backup';
import type { ThemeMode } from '@/application/settings/theme-preference';
import { FoundationScreen } from '@/components/foundation-screen';
import {
  clearGatewayDeviceSecret,
  getGatewayDeviceSecret,
  saveGatewayDeviceSecret,
  verifyGatewayConnection,
} from '@/infrastructure/gateway/device-auth';
import {
  isStandalonePwa,
  requestPersistentStorage,
  serviceWorkerVersion,
} from '@/pwa/runtime';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

const appVersion = Constants.expoConfig?.version ?? '1.0.0';

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Šviesus' },
  { mode: 'dark', label: 'Tamsus' },
  { mode: 'system', label: 'Sistema' },
];

type StorageDiagnostics = {
  schemaVersion: number;
  lastWriteAt: string;
  standalone: boolean;
  serviceWorker: string;
  persistent: boolean | null;
};

export default function SettingsScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [deviceSecret, setDeviceSecret] = useState('');
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics | null>(null);
  const goHome = () => router.replace('/' as Href);

  useEffect(() => {
    void refreshDiagnostics();
    void (async () => {
      const secret = await getGatewayDeviceSecret();
      if (secret) {
        setGatewayConnected(true);
      } else {
        const connected = await verifyGatewayConnection();
        setGatewayConnected(connected);
      }
    })();
  }, []);

  async function refreshDiagnostics() {
    const now = new Date().toISOString();
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    await db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      'pwa_last_successful_write_at',
      now,
      now,
    );
    setDiagnostics({
      schemaVersion: version?.user_version ?? 0,
      lastWriteAt: now,
      standalone: isStandalonePwa(),
      serviceWorker: serviceWorkerVersion() ?? 'neaktyvus',
      persistent: await requestPersistentStorage(),
    });
  }

  async function connectGateway() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveGatewayDeviceSecret(deviceSecret);
      if (!await verifyGatewayConnection()) throw new Error('Įrenginio raktas nepatvirtintas.');
      setGatewayConnected(true);
      setDeviceSecret('');
      setMessage('Gateway prijungtas. Rakto kasdien įvesti nereikės.');
    } catch (error) {
      await clearGatewayDeviceSecret();
      setGatewayConnected(false);
      setMessage(error instanceof Error ? error.message : 'Gateway prijungti nepavyko.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGateway() {
    await clearGatewayDeviceSecret();
    setGatewayConnected(false);
    setMessage('Šis įrenginys atjungtas nuo Gateway.');
  }

  async function exportBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const backup = await createPwaBackup(db, appVersion);
      const text = JSON.stringify(backup, null, 2);
      if (Platform.OS !== 'web') throw new Error('Pilnas PWA eksportas šiame ekrane skirtas web aplikacijai.');
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pristatymai-backup-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('Atsarginė kopija paruošta. Išsaugokite ją „Files“ programoje.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Eksportuoti nepavyko.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      const raw = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
      const backup = parsePwaBackup(raw);
      const summary = summarizePwaBackup(backup);
      Alert.alert(
        'Atkurti atsarginę kopiją?',
        `Bus pakeisti dabartiniai šio įrenginio duomenys. Kopijoje: ${summary.routeCount} maršrutai, ${summary.stopCount} taškai, ${summary.shipmentLineCount} krovinio eilutės.`,
        [
          { text: 'Atšaukti', style: 'cancel' },
          {
            text: 'Atkurti',
            style: 'destructive',
            onPress: () => void performRestore(backup),
          },
        ],
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }

  async function performRestore(backup: ReturnType<typeof parsePwaBackup>) {
    setBusy(true);
    try {
      await restorePwaBackup(db, backup);
      await refreshDiagnostics();
      setMessage('Atsarginė kopija atkurta. Visi pakeitimai įrašyti atomine operacija.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Atkurti nepavyko. Dabartiniai duomenys nepakeisti.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{
        gestureEnabled: false,
        headerBackVisible: false,
        headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
        headerRight: () => null,
      }} />
      <FoundationScreen showFoundationNotice={false} title="Nustatymai" description="Vietos, PWA saugykla, Gateway ir atsarginės kopijos.">
        <Pressable style={styles.card} onPress={() => router.push('/settings/locations' as Href)}>
          <View style={styles.flex}>
            <Text style={styles.title}>Sandėlis ir namų vieta</Text>
            <Text style={styles.meta}>Keisti numatytąsias maršruto vietas</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Išvaizda</Text>
          <View style={styles.segmentRow}>
            {THEME_OPTIONS.map(({ mode, label }) => {
              const active = preference === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}
                  onPress={() => setPreference(mode)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gateway</Text>
          <Text style={gatewayConnected ? styles.ok : styles.warning}>
            {gatewayConnected ? 'Gateway prijungtas ✓' : 'Gateway dar neprijungtas'}
          </Text>
          <TextInput
            value={deviceSecret}
            onChangeText={setDeviceSecret}
            placeholder={gatewayConnected ? 'Naujas įrenginio raktas' : 'Vienkartinis įrenginio raktas'}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable disabled={busy || deviceSecret.trim().length < 32} style={[styles.primaryButton, (busy || deviceSecret.trim().length < 32) && styles.disabled]} onPress={() => void connectGateway()}>
            <Text style={styles.primaryText}>{gatewayConnected ? 'Pakeisti įrenginio raktą' : 'Prijungti Gateway'}</Text>
          </Pressable>
          {gatewayConnected ? <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => void disconnectGateway()}><Text style={styles.secondaryText}>Atjungti šį įrenginį</Text></Pressable> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Duomenų saugykla</Text>
          <Text style={styles.ok}>SQLite veikia ✓</Text>
          <Text style={styles.meta}>Schemos versija: {diagnostics?.schemaVersion ?? 'tikrinama'}</Text>
          <Text style={styles.meta}>Paskutinis sėkmingas įrašymas: {diagnostics ? new Date(diagnostics.lastWriteAt).toLocaleString('lt-LT') : 'tikrinama'}</Text>
          <Text style={styles.meta}>Paleista kaip aplikacija: {diagnostics?.standalone ? 'taip' : 'ne'}</Text>
          <Text style={styles.meta}>Service worker: {diagnostics?.serviceWorker ?? 'tikrinama'}</Text>
          <Text style={styles.meta}>Patvari naršyklės saugykla: {diagnostics?.persistent === null ? 'nepalaikoma' : diagnostics?.persistent ? 'suteikta' : 'negarantuota'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Atsarginė kopija</Text>
          <Text style={styles.meta}>Kopijoje nėra API raktų ar Gateway įrenginio rakto.</Text>
          <Pressable disabled={busy} style={styles.primaryButton} onPress={() => void exportBackup()}><Text style={styles.primaryText}>Eksportuoti atsarginę kopiją</Text></Pressable>
          <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => void chooseBackup()}><Text style={styles.secondaryText}>Atkurti iš atsarginės kopijos</Text></Pressable>
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { minHeight: 72, padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, marginTop: spacing.xs, lineHeight: 21 },
  ok: { color: colors.primary, fontWeight: '800' },
  warning: { color: colors.warning, fontWeight: '800' },
  chevron: { color: colors.primary, fontSize: 32 },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, backgroundColor: colors.surface, color: colors.text },
  primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  secondaryButton: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.primary, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  message: { color: colors.text, backgroundColor: colors.primarySoft, borderRadius: 12, padding: spacing.md, lineHeight: 21 },
  homeButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  homeText: { color: colors.primary, fontWeight: '800' },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.primary, fontWeight: '800' },
  segmentRow: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.textMuted, fontWeight: '800' },
  segmentTextActive: { color: '#fff' },
});
