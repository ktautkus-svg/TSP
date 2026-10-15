import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { FoundationScreen } from '@/components/foundation-screen';
import { lithuanianDateKey } from '@/domain/lithuanian-time';
import { vehicleDocumentLabel, vehicleDocumentState, type VehicleDocumentState } from '@/domain/vehicle-document-status';
import { employeeApi, type ServerFleetVehicle } from '@/infrastructure/auth/employee-session';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const DOCUMENTS: readonly { key: 'technicalInspectionDueOn' | 'insuranceDueOn' | 'roadTaxDueOn' | 'nextServiceDueOn'; label: string }[] = [
  { key: 'technicalInspectionDueOn', label: 'Techninė apžiūra' },
  { key: 'insuranceDueOn', label: 'Civilinis draudimas' },
  { key: 'roadTaxDueOn', label: 'Kelionės mokestis' },
  { key: 'nextServiceDueOn', label: 'Priežiūra' },
];

export default function VehicleDocumentsScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = lithuanianDateKey(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
  const canEdit = profile.role === 'admin' || (profile.role === 'dispatcher' && normalizeEmployeePermissions(profile.permissions).canManageVehicles);
  const compact = width < 720;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles');
      setVehicles([...response.vehicles].sort((left, right) => left.registrationNumber.localeCompare(right.registrationNumber, 'lt-LT')));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Automobilių dokumentų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!['admin', 'dispatcher', 'quality'].includes(profile.role)) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
    void load();
  }, [load, profile.role, router]);

  return <>
    <Stack.Screen options={{ title: 'Automobilių dokumentai' }} />
    <FoundationScreen
      contentMaxWidth={1180}
      description="Techninės apžiūros, civilinio draudimo ir kitų terminų galiojimas. Tuščia data lieka nenurodyta."
      title="Automobilių dokumentai">
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={colors.info} /> : null}
      {!busy && vehicles.length === 0 ? <Text style={styles.empty}>Automobilių sąrašas tuščias.</Text> : null}
      <View style={styles.list}>
        {vehicles.map((vehicle) => <View key={vehicle.id} style={styles.card} testID={`vehicle-document-${vehicle.id}`}>
          <View style={styles.heading}>
            <View style={styles.identity}>
              <Text style={styles.plate}>{vehicle.registrationNumber}</Text>
              <Text style={styles.model}>{vehicle.model}</Text>
            </View>
            {canEdit ? <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/vehicle', params: { vehicleId: vehicle.id, section: 'terms' } } as Href)}
              style={styles.edit}
              testID={`edit-vehicle-document-${vehicle.id}`}>
              <Text style={styles.editText}>Redaguoti</Text>
            </Pressable> : null}
          </View>
          <View style={[styles.terms, compact && styles.termsCompact]}>
            {DOCUMENTS.map((document) => {
              const dueOn = vehicle[document.key] ?? null;
              const state = vehicleDocumentState(dueOn, today);
              return <View key={document.key} style={styles.term}>
                <Text style={styles.termLabel}>{document.label}</Text>
                <Text style={styles.termDate}>{dueOn ? formatDate(dueOn) : 'Nenurodyta'}</Text>
                <Text style={[styles.termState, documentStateStyle(styles, state)]}>{vehicleDocumentLabel(state)}</Text>
              </View>;
            })}
          </View>
        </View>)}
      </View>
    </FoundationScreen>
  </>;
}

function documentStateStyle(styles: ReturnType<typeof createStyles>, state: VehicleDocumentState) {
  if (state === 'valid') return styles.state_valid;
  if (state === 'expiring') return styles.state_expiring;
  if (state === 'expired') return styles.state_expired;
  return styles.state_missing;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  error: { ...type.bodyStrong, color: colors.danger },
  empty: { ...type.body, color: colors.text },
  list: { gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  plate: { ...type.sectionTitle, color: colors.text },
  model: { ...type.secondary, color: colors.textSecondary },
  edit: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  editText: { ...type.button, color: colors.info },
  terms: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  termsCompact: { flexDirection: 'column' },
  term: { flexGrow: 1, flexBasis: 180, minWidth: 140, gap: 2, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  termLabel: { ...type.label, color: colors.text },
  termDate: { ...type.bodyStrong, color: colors.text },
  termState: { ...type.secondaryStrong },
  state_valid: { color: colors.success },
  state_expiring: { color: colors.warning },
  state_expired: { color: colors.danger },
  state_missing: { color: colors.textSecondary },
});
