import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { EmployeesIcon, SettingsIcon, VehicleIcon } from '@/components/app-icons';
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
import { devWarn } from '@/ui/dev-log';

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
  const toggleSection = (section: SettingsSection) => setOpenSection((current) => current === section ? null : section);

  const refreshDiagnostics = useCallback(async () => {
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
  }, [db]);

  useEffect(() => {
    void refreshDiagnostics();
    void navigationPreference.get()
      .then(setDefaultNavigation)
      .catch((error) => {
        devWarn('NAVIGATION_PREFERENCE_LOAD_FAILED', error);
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
  }, [navigationPreference, refreshDiagnostics]);

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
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={styles.screen}>
      <FoundationScreen showFoundationNotice={false} title="Nustatymai" description="Vietos, navigacija ir programos parinktys.">
        <View style={styles.settingsGroup} testID="account-settings-section">
          <Text style={styles.groupLabel}>PASKYRA</Text>
          <View style={styles.groupBody}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'account' }} onPress={() => toggleSection('account')} style={styles.settingsRow}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Vartotojas</Text>
                <Text style={styles.rowValue}>{profile.displayName} · {roleLabel(profile.role)}</Text>
              </View>
              <Text style={styles.advancedChevron}>{openSection === 'account' ? '⌃' : '⌄'}</Text>
            </Pressable>
            {openSection === 'account' ? (
              <View style={styles.expandedContent} testID="account-settings-content">
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
        </View>

        {profile.role === 'admin' ? <View style={styles.settingsGroup} testID="admin-management-shortcuts">
          <Text style={styles.groupLabel}>ADMINISTRAVIMAS</Text>
          <View style={styles.managementSection}>
          <View style={styles.managementGrid}>
            <Pressable
              accessibilityLabel="Redaguoti vairuotojus ir darbuotojus"
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/admin', params: { section: 'employees', returnTo: 'settings' } } as Href)}
              style={styles.managementCard}
              testID="open-employee-management">
              <View style={styles.managementIcon}><EmployeesIcon /></View>
              <View style={styles.flex}><Text style={styles.title}>Vairuotojai</Text><Text style={styles.meta}>Duomenys, PIN ir leidimai</Text></View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Redaguoti automobilius"
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/admin', params: { section: 'fleet', returnTo: 'settings' } } as Href)}
              style={styles.managementCard}
              testID="open-vehicle-management">
              <View style={styles.managementIcon}><VehicleIcon /></View>
              <View style={styles.flex}><Text style={styles.title}>Automobiliai</Text><Text style={styles.meta}>Numeriai, modeliai ir keliamoji galia</Text></View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
          <Pressable style={styles.adminPanelLink} onPress={() => router.push({ pathname: '/admin', params: { returnTo: 'settings' } } as Href)} testID="open-admin-panel">
            <SettingsIcon size={20} />
            <Text style={styles.adminPanelLinkText}>Visas administratoriaus valdymas</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          </View>
        </View> : null}

        <View style={styles.settingsGroup}>
          <Text style={styles.groupLabel}>MARŠRUTAS IR NAVIGACIJA</Text>
          <View style={styles.groupBody}>
            <Pressable style={styles.settingsRow} onPress={() => router.push('/settings/locations' as Href)}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Sandėlis ir namų vieta</Text>
                <Text style={styles.rowValue}>Keisti numatytąsias maršruto vietas</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <View style={styles.groupDivider} />
            <Pressable style={styles.settingsRow} onPress={() => router.push('/vehicle' as Href)} testID="open-vehicle-settings">
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Transporto priemonė</Text>
                <Text style={styles.rowValue}>Vardas, numeris ir kuro tipas šiame įrenginyje</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <View style={styles.groupDivider} />
            <Pressable style={styles.settingsRow} onPress={() => router.push('/fuel' as Href)} testID="open-fuel-settings">
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Degalų pylimai</Text>
                <Text style={styles.rowValue}>Pilno bako pylimų taisyklės ir sąnaudų skaičiavimas</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <View style={styles.groupDivider} />
            <View testID="default-navigation-setting">
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'navigation' }} onPress={() => toggleSection('navigation')} style={styles.settingsRow}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>Numatytoji navigacija</Text>
                  <Text style={styles.rowValue}>{NAVIGATION_OPTIONS.find((option) => option.value === defaultNavigation)?.label ?? 'Nepasirinkta'}</Text>
                </View>
                <Text style={styles.advancedChevron}>{openSection === 'navigation' ? '⌃' : '⌄'}</Text>
              </Pressable>
              {openSection === 'navigation' ? (
                <View style={styles.expandedContent} testID="navigation-settings-content">
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
          </View>
        </View>

        <View style={styles.settingsGroup}>
          <Text style={styles.groupLabel}>PROGRAMA</Text>
          <View style={styles.groupBody}>
            <View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'appearance' }} onPress={() => toggleSection('appearance')} style={styles.settingsRow}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>Išvaizda</Text>
                  <Text style={styles.rowValue}>{THEME_OPTIONS.find((option) => option.mode === preference)?.label ?? 'Sistema'}</Text>
                </View>
                <Text style={styles.advancedChevron}>{openSection === 'appearance' ? '⌃' : '⌄'}</Text>
              </Pressable>
              {openSection === 'appearance' ? (
                <View style={styles.expandedContent} testID="appearance-settings-content">
                  <View style={styles.segmentRow}>
                    {THEME_OPTIONS.map(({ mode, label }) => {
                      const active = preference === mode;
                      return <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.segment, active && styles.segmentActive]} onPress={() => setPreference(mode)}>
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                      </Pressable>;
                    })}
                  </View>
                </View>
              ) : null}
            </View>
            <View style={styles.groupDivider} />
            <View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'gateway' }} onPress={() => toggleSection('gateway')} style={styles.settingsRow}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>Gateway ryšys</Text>
                  <View style={styles.statusLine}><View style={[styles.statusDot, gatewayConnected ? styles.statusDotOk : styles.statusDotWarning]} /><Text style={gatewayConnected ? styles.ok : styles.warning}>{gatewayConnected ? 'Prijungtas' : 'Dar neprijungtas'}</Text></View>
                </View>
                <Text style={styles.advancedChevron}>{openSection === 'gateway' ? '⌃' : '⌄'}</Text>
              </Pressable>
              {openSection === 'gateway' ? (
                <View style={styles.expandedContent} testID="gateway-settings-content">
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
            <View style={styles.groupDivider} />
            <View testID="data-backup-section">
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSection === 'data' }} onPress={() => toggleSection('data')} style={styles.settingsRow}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>Duomenys ir atsarginė kopija</Text>
                  <Text style={styles.rowValue}>Saugyklos būsena, eksportas ir atkūrimas</Text>
                </View>
                <Text style={styles.advancedChevron}>{openSection === 'data' ? '⌃' : '⌄'}</Text>
              </Pressable>
              {openSection === 'data' ? (
                <View style={styles.expandedContent} testID="data-backup-content">
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
          </View>
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
      </FoundationScreen>
      {profile.role === 'driver' ? <DriverAppTabs active="settings" /> : null}
      </View>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 900, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  settingsGroup: { gap: spacing.xs },
  groupLabel: { ...type.label, color: colors.textMuted, paddingHorizontal: spacing.xs },
  groupBody: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  settingsRow: { minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowValue: { ...type.secondary, color: colors.textMuted, marginTop: 2 },
  groupDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
  expandedContent: { marginHorizontal: spacing.sm, marginBottom: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, gap: spacing.sm },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusDotOk: { backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  managementSection: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  managementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  managementCard: { minHeight: 86, flexGrow: 1, flexBasis: 280, minWidth: 0, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  managementIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft },
  adminPanelLink: { minHeight: 48, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  adminPanelLinkText: { ...type.secondaryStrong, color: colors.textSecondary, flex: 1 },
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
  headerAction: { minWidth: 176, minHeight: 52, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.brandNavy, fontSize: 16 },
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
  advancedChevron: { color: colors.info, fontSize: 26, fontFamily: type.button.fontFamily },
  advancedDivider: { height: 1, marginVertical: spacing.xs, backgroundColor: colors.border },
});
