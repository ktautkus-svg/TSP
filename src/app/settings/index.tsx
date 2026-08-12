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
import {
  NavigationPreference,
  type NavigationProvider,
} from '@/application/settings/navigation-preference';
import type { ThemeMode } from '@/application/settings/theme-preference';
import { FoundationScreen } from '@/components/foundation-screen';
import { DriverAppTabs } from '@/components/driver-app-tabs';
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
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleLabel, sessionStateLabel } from '@/application/auth/employee-permissions';
import { StatusBadge } from '@/components/ui-primitives';

const appVersion = Constants.expoConfig?.version ?? '1.0.0';

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Šviesus' },
  { mode: 'dark', label: 'Tamsus' },
  { mode: 'system', label: 'Sistema' },
];

const NAVIGATION_OPTIONS: { value: NavigationProvider; label: string }[] = [
  { value: 'waze', label: 'Waze' },
  { value: 'apple_maps', label: 'Apple Maps' },
  { value: 'google_maps', label: 'Google Maps' },
];

type StorageDiagnostics = {
  schemaVersion: number;
  lastWriteAt: string;
  standalone: boolean;
  serviceWorker: string;
  persistent: boolean | null;
};

type SettingsSection = 'account' | 'appearance' | 'navigation' | 'gateway' | 'data';

export default function SettingsScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { profile, online, logout } = useLocalAccess();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigationPreference = useMemo(() => new NavigationPreference(db), [db]);
  const [deviceSecret, setDeviceSecret] = useState('');
  const [defaultNavigation, setDefaultNavigation] = useState<NavigationProvider>('waze');
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const goHome = () => router.replace('/' as Href);
  const toggleSection = (section: SettingsSection) => setOpenSection((current) => current === section ? null : section);

  useEffect(() => {
    void refreshDiagnostics();
    void navigationPreference.get()
      .then(setDefaultNavigation)
      .catch((error) => {
        if (__DEV__) console.warn('NAVIGATION_PREFERENCE_LOAD_FAILED', error);
      });
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

  async function changeDefaultNavigation(value: NavigationProvider) {
    const previous = defaultNavigation;
    setDefaultNavigation(value);
    try {
      await navigationPreference.save(value);
      setMessage(`Numatytoji navigacija: ${NAVIGATION_OPTIONS.find((option) => option.value === value)?.label ?? value}.`);
    } catch (error) {
      setDefaultNavigation(previous);
      setMessage(error instanceof Error ? error.message : 'Navigacijos pasirinkimo išsaugoti nepavyko.');
    }
  }

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

  function confirmLogout() {
    Alert.alert(
      'Atsijungti?',
      'Kitą kartą reikės įvesti prisijungimo vardą ir PIN.',
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Atsijungti', style: 'destructive', onPress: () => { void logout(); } },
      ],
    );
  }

  function confirmSwitchAccount() {
    Alert.alert(
      'Keisti paskyrą?',
      'Būsite atjungti nuo šios paskyros, kad galėtumėte prisijungti kitu darbuotojo vardu.',
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Keisti paskyrą', style: 'destructive', onPress: () => { void logout(); } },
      ],
    );
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
        headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžios meniu</Text></Pressable>,
        headerRight: () => null,
      }} />
      <View style={styles.screen}>
      <FoundationScreen showFoundationNotice={false} title="Nustatymai" description="Vietos, navigacija ir programos parinktys.">
        <View style={styles.section} testID="account-settings-section">
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'account' }} onPress={() => toggleSection('account')} style={styles.advancedToggle}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>Paskyra</Text>
              <Text style={styles.meta}>{profile.displayName}</Text>
            </View>
            <Text style={styles.advancedChevron}>{openSection === 'account' ? '⌃' : '⌄'}</Text>
          </Pressable>
          {openSection === 'account' ? (
            <View style={styles.advancedContent} testID="account-settings-content">
              <Text style={styles.meta}>Prisijungta kaip @{profile.username}</Text>
              <View style={styles.badgeRow}>
                <StatusBadge label={roleLabel(profile.role)} tone="neutral" />
                <StatusBadge label={sessionStateLabel(online).label} tone={sessionStateLabel(online).tone} />
              </View>
              <Pressable style={styles.secondaryButton} onPress={confirmSwitchAccount} testID="switch-account-button"><Text style={styles.secondaryText}>Keisti paskyrą</Text></Pressable>
              <Pressable style={styles.logoutButton} onPress={confirmLogout} testID="logout-button"><Text style={styles.logoutText}>Atsijungti</Text></Pressable>
            </View>
          ) : null}
        </View>

        {profile.role === 'admin' ? <Pressable style={styles.card} onPress={() => router.push('/admin' as Href)} testID="open-admin-panel">
          <View style={styles.flex}>
            <Text style={styles.title}>Administratoriaus panelė</Text>
            <Text style={styles.meta}>Prisijungimas, PIN ir įrenginio duomenų santrauka</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable> : null}

        <Pressable style={styles.card} onPress={() => router.push('/settings/locations' as Href)}>
          <View style={styles.flex}>
            <Text style={styles.title}>Sandėlis ir namų vieta</Text>
            <Text style={styles.meta}>Keisti numatytąsias maršruto vietas</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.section}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'appearance' }} onPress={() => toggleSection('appearance')} style={styles.advancedToggle}>
            <Text style={styles.sectionTitle}>Išvaizda</Text>
            <Text style={styles.advancedChevron}>{openSection === 'appearance' ? '⌃' : '⌄'}</Text>
          </Pressable>
          {openSection === 'appearance' ? (
            <View style={styles.segmentRow} testID="appearance-settings-content">
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
          ) : null}
        </View>

        <View style={styles.section} testID="default-navigation-setting">
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'navigation' }} onPress={() => toggleSection('navigation')} style={styles.advancedToggle}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>Numatytoji navigacija</Text>
              <Text style={styles.meta}>{NAVIGATION_OPTIONS.find((option) => option.value === defaultNavigation)?.label ?? 'Nepasirinkta'}</Text>
            </View>
            <Text style={styles.advancedChevron}>{openSection === 'navigation' ? '⌃' : '⌄'}</Text>
          </Pressable>
          {openSection === 'navigation' ? (
            <View style={styles.advancedContent} testID="navigation-settings-content">
              <Text style={styles.meta}>Paspaudus „Navigacija“ pasirinkta programa bus atidaryta iškart.</Text>
              <View style={styles.navigationOptions}>
                {NAVIGATION_OPTIONS.map(({ value, label }) => {
                  const active = defaultNavigation === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      onPress={() => { void changeDefaultNavigation(value); }}
                      style={[styles.navigationOption, active && styles.navigationOptionActive]}
                      testID={`navigation-provider-${value}`}
                    >
                      <View style={[styles.radio, active && styles.radioActive]} />
                      <Text style={[styles.navigationOptionText, active && styles.navigationOptionTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'gateway' }} onPress={() => toggleSection('gateway')} style={styles.advancedToggle}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>Gateway</Text>
              <Text style={gatewayConnected ? styles.ok : styles.warning}>{gatewayConnected ? 'Prijungtas ✓' : 'Dar neprijungtas'}</Text>
            </View>
            <Text style={styles.advancedChevron}>{openSection === 'gateway' ? '⌃' : '⌄'}</Text>
          </Pressable>
          {openSection === 'gateway' ? (
            <View style={styles.advancedContent} testID="gateway-settings-content">
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
          ) : null}
        </View>

        <View style={styles.section} testID="data-backup-section">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: openSection === 'data' }}
            onPress={() => toggleSection('data')}
            style={styles.advancedToggle}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>Duomenys ir atsarginė kopija</Text>
              <Text style={styles.meta}>Saugyklos būsena, eksportas ir atkūrimas</Text>
            </View>
            <Text style={styles.advancedChevron}>{openSection === 'data' ? '⌃' : '⌄'}</Text>
          </Pressable>
          {openSection === 'data' ? (
            <View style={styles.advancedContent} testID="data-backup-content">
              <Text style={styles.ok}>SQLite veikia ✓</Text>
              <Text style={styles.meta}>Schemos versija: {diagnostics?.schemaVersion ?? 'tikrinama'}</Text>
              <Text style={styles.meta}>Paskutinis sėkmingas įrašymas: {diagnostics ? new Date(diagnostics.lastWriteAt).toLocaleString('lt-LT') : 'tikrinama'}</Text>
              <Text style={styles.meta}>Paleista kaip aplikacija: {diagnostics?.standalone ? 'taip' : 'ne'}</Text>
              <Text style={styles.meta}>Service worker: {diagnostics?.serviceWorker ?? 'tikrinama'}</Text>
              <Text style={styles.meta}>Patvari naršyklės saugykla: {diagnostics?.persistent === null ? 'nepalaikoma' : diagnostics?.persistent ? 'suteikta' : 'negarantuota'}</Text>
              <View style={styles.advancedDivider} />
              <Text style={styles.meta}>Kopijoje nėra API raktų ar Gateway įrenginio rakto.</Text>
              <Pressable disabled={busy} style={styles.primaryButton} onPress={() => void exportBackup()}><Text style={styles.primaryText}>Eksportuoti atsarginę kopiją</Text></Pressable>
              <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => void chooseBackup()}><Text style={styles.secondaryText}>Atkurti iš atsarginės kopijos</Text></Pressable>
            </View>
          ) : null}
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
      </FoundationScreen>
      {profile.role === 'driver' ? <DriverAppTabs active="settings" /> : null}
      </View>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 900, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  card: { minHeight: 72, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { ...type.sectionTitle, color: colors.text },
  title: { ...type.cardTitle, color: colors.text },
  meta: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ok: { ...type.secondaryStrong, color: colors.success },
  warning: { ...type.secondaryStrong, color: colors.warning },
  chevron: { color: colors.info, fontSize: 32 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSubtle, color: colors.text, ...type.body },
  primaryButton: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { ...type.button, color: colors.textInverse, textAlign: 'center' },
  secondaryButton: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary, textAlign: 'center' },
  logoutButton: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  logoutText: { ...type.button, color: colors.danger, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  message: { ...type.body, color: colors.text, backgroundColor: colors.infoSoft, borderRadius: radius.md, padding: spacing.md },
  homeButton: { minHeight: 60, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary, fontSize: 16 },
  headerAction: { minWidth: 176, minHeight: 52, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  segmentRow: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  segmentText: { ...type.secondaryStrong, color: colors.textMuted },
  segmentTextActive: { color: colors.textInverse },
  navigationOptions: { gap: spacing.xs },
  navigationOption: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navigationOptionActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  navigationOptionText: { ...type.bodyStrong, color: colors.text },
  navigationOptionTextActive: { ...type.bodyStrong, color: colors.info },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.textMuted, backgroundColor: 'transparent' },
  radioActive: { borderWidth: 5, borderColor: colors.info, backgroundColor: colors.surface },
  advancedToggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  advancedChevron: { color: colors.info, fontSize: 26, fontFamily: type.button.fontFamily },
  advancedContent: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  advancedDivider: { height: 1, marginVertical: spacing.xs, backgroundColor: colors.border },
});
