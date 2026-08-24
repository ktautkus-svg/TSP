import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import {
  DEFAULT_ROUTE_PRICE_SETTINGS,
  normalizeRoutePriceSettings,
  type RoutePriceSettings,
} from '@/application/routes/route-price';
import { FoundationScreen } from '@/components/foundation-screen';
import { RoutePriceSettingsPanel } from '@/components/route-price-settings-panel';
import { employeeApi, type EmployeeProfile, type ServerFleetVehicle } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function FinancialSettingsScreen() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [settings, setSettings] = useState<RoutePriceSettings>(() => normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const canEdit = profile.role === 'admin' || (profile.role === 'dispatcher' && normalizeEmployeePermissions(profile.permissions).canManageFinancials);

  const load = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const [settingsResponse, usersResponse, vehiclesResponse] = await Promise.all([
        employeeApi<{ settings: RoutePriceSettings }>('/api/admin/route-price-settings'),
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
      ]);
      setSettings(addDirectoryProfiles(normalizeRoutePriceSettings(settingsResponse.settings), usersResponse.users, vehiclesResponse.vehicles));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Finansinių parametrų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <>
    <Stack.Screen options={{ title: 'Finansiniai duomenys' }} />
    <FoundationScreen
      contentMaxWidth={1120}
      description="Vienoje vietoje valdykite kuro, automobilio, darbo užmokesčio ir rezervo parametrus."
      showFoundationNotice={false}
      title="Finansiniai duomenys">
      {!online ? <Text style={styles.warning}>Parametrų keitimui reikia interneto ryšio.</Text> : null}
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
      {busy ? <View style={styles.loading}><ActivityIndicator color={colors.info} /><Text style={styles.loadingText}>Kraunami parametrai…</Text></View> : <RoutePriceSettingsPanel
        canEdit={canEdit}
        onClose={() => router.replace(financialReturnTarget(returnTo))}
        onSaved={setSettings}
        settings={settings}
      />}
    </FoundationScreen>
  </>;
}

function financialReturnTarget(returnTo: string | undefined): Href {
  if (returnTo === 'admin') return '/admin';
  if (returnTo === 'settings') return '/settings';
  if (returnTo === 'finance') return '/finance' as Href;
  if (returnTo === 'finance-wages') return '/finance/wages' as Href;
  return '/dispatcher';
}

function addDirectoryProfiles(settings: RoutePriceSettings, users: EmployeeProfile[], vehicles: ServerFleetVehicle[]): RoutePriceSettings {
  const driverCosts = { ...settings.driverCosts };
  for (const driver of users.filter((user) => user.role === 'driver' && !user.disabled)) {
    const key = driver.displayName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('lt-LT');
    if (!driverCosts[key]) driverCosts[key] = { ...settings.defaultDriverCost };
  }

  const vehicleCosts = { ...settings.vehicleCosts };
  for (const vehicle of vehicles) {
    const key = vehicle.registrationNumber.trim().toUpperCase();
    if (vehicleCosts[key]) continue;
    const size = vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.mediumMax
      ? 'large'
      : vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.smallMax ? 'medium' : 'small';
    vehicleCosts[key] = { ...settings.fallbackVehicleCosts[size] };
  }
  return { ...settings, driverCosts, vehicleCosts };
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  loading: { minHeight: 120, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { ...type.secondary, color: colors.textMuted },
  message: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, color: colors.danger },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
});
