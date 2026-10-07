import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { LocalAccessContext, type LocalAccessContextValue } from '@/application/auth/local-access-context';
import {
  createFinanceUiHarnessApi,
  FINANCE_UI_HARNESS_PROFILE,
  type FinanceUiHarnessApi,
} from '@/application/finance/finance-ui-harness-api';
import { FoundationScreen } from '@/components/foundation-screen';
import {
  setEmployeeApiTestTransport,
} from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

import MonthSummaryScreen from './month-summary';
import WagesScreen from './wages';
import TripSheetScreen from '../trip-sheet';

type HarnessTab = 'wages' | 'month' | 'trip';

const HARNESS_ACCESS: LocalAccessContextValue = {
  username: FINANCE_UI_HARNESS_PROFILE.username,
  profile: FINANCE_UI_HARNESS_PROFILE,
  online: true,
  demo: false,
  logout: async () => undefined,
  actingDriver: null,
  setActingDriver: async () => undefined,
};

/**
 * __DEV__-only acceptance harness: mounts the real wages / month-summary /
 * trip-sheet screens with their original styles and handlers. All employeeApi
 * traffic is diverted to an in-memory store (setEmployeeApiTestTransport) so
 * production Firestore / network / credentials are never used.
 *
 * Open: http://localhost:8081/finance/ui-fixture
 */
export default function FinanceUiFixtureScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const apiRef = useRef<FinanceUiHarnessApi | null>(null);
  const [tab, setTab] = useState<HarnessTab>('wages');
  const [screenKey, setScreenKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const allowed = typeof __DEV__ !== 'undefined' && __DEV__;

  useEffect(() => {
    if (!allowed) return undefined;
    const api = createFinanceUiHarnessApi();
    apiRef.current = api;
    setEmployeeApiTestTransport(api.handle);
    setReady(true);
    return () => {
      setEmployeeApiTestTransport(null);
      apiRef.current = null;
    };
  }, [allowed]);

  if (!allowed) {
    return <>
      <Stack.Screen options={{ title: 'FIRO finance UI fixture' }} />
      <FoundationScreen description="Tik vystymo režimas" title="Fixture nepasiekiamas">
        <Text style={styles.meta} testID="finance-ui-fixture-prod-blocked">
          Šis harness veikia tik __DEV__ režime. Produkcijos maršrutas užblokuotas.
        </Text>
      </FoundationScreen>
    </>;
  }

  const remount = () => setScreenKey((value) => value + 1);

  const armError = () => {
    apiRef.current?.armNextFailure();
    setNotice('Kitas rašymo/šalinimo kvietimas grąžins sintetinė klaidą (retry patikrai).');
  };

  const resetStore = () => {
    apiRef.current?.reset();
    setNotice('Sintetinė saugykla atstatyta.');
    remount();
  };

  return <>
    <Stack.Screen options={{ title: 'FIRO finance UI fixture' }} />
    <View style={styles.shell} testID="finance-ui-fixture">
      <View style={styles.chrome}>
        <Text style={styles.title}>FIRO finance UI fixture</Text>
        <Text style={styles.meta} testID="finance-ui-fixture-viewport">
          {`Viewport ${Math.round(width)}×${Math.round(height)} · sintetinė API · tinklas/Firestore užblokuoti`}
        </Text>
        <View style={styles.tabs}>
          {([
            ['wages', 'Atlygis (wages)'],
            ['month', 'Mėnesio suvestinė'],
            ['trip', 'Kelionės lapas'],
          ] as const).map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => { setTab(id); remount(); }}
              style={[styles.tab, tab === id && styles.tabActive]}
              testID={`finance-ui-fixture-tab-${id}`}>
              <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.controls}>
          <Pressable onPress={armError} style={styles.secondary} testID="finance-ui-fixture-arm-error">
            <Text style={styles.secondaryText}>Kitas rašymas → klaida</Text>
          </Pressable>
          <Pressable onPress={resetStore} style={styles.secondary} testID="finance-ui-fixture-reset">
            <Text style={styles.secondaryText}>Atstatyti store</Text>
          </Pressable>
        </View>
        {notice ? <Text style={styles.notice} testID="finance-ui-fixture-notice">{notice}</Text> : null}
        <Text style={styles.hint}>
          Tikri produkto ekranai žemiau: originalūs stiliai, filtrai, redagavimas, šalinimo dialogai.
          Rankiniai priedai: +30 / −12,5 / 0+komentaras / be reiso / 2 reisai 10-02; šalinamas accounting 10-04.
        </Text>
      </View>

      {ready ? (
        <LocalAccessContext.Provider value={HARNESS_ACCESS}>
          <View style={styles.screenHost} key={`${tab}-${screenKey}`} testID={`finance-ui-fixture-host-${tab}`}>
            {tab === 'wages' ? <WagesScreen /> : null}
            {tab === 'month' ? <MonthSummaryScreen /> : null}
            {tab === 'trip' ? <TripSheetScreen /> : null}
          </View>
        </LocalAccessContext.Provider>
      ) : (
        <Text style={styles.meta}>Ruošiamas sintetinis API…</Text>
      )}
    </View>
  </>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  chrome: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  hint: { ...type.secondary, color: colors.textMuted },
  notice: { ...type.secondary, color: colors.warning },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tab: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...type.button, color: colors.text },
  tabTextActive: { color: colors.textInverse },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  secondary: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...type.secondary, color: colors.text },
  screenHost: { flex: 1 },
});
