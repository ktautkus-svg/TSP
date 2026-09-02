import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { importAssignmentSnapshot, prepareAssignmentSnapshotImport } from '@/application/auth/route-assignment-sync';
import { effectiveAssignmentStatus, isActiveAssignment } from '@/application/auth/route-assignment-status';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { resolveRouteDestination } from '@/application/routes/route-navigation';
import { ScreenContainer } from '@/components/screen-container';
import { employeeApi, type EmployeeProfile, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function ExecuteRouteScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online, setActingDriver } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!online) throw new Error('Maršrutui vykdyti reikia ryšio su serveriu.');
    const [usersResponse, assignmentsResponse] = await Promise.all([
      employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
      employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
    ]);
    const availableAssignments = assignmentsResponse.assignments.filter(isActiveAssignment);
    const availableDriverIds = new Set(availableAssignments.map((assignment) => assignment.driverId));
    const availableDrivers = usersResponse.users.filter((user) => user.role === 'driver' && !user.disabled && availableDriverIds.has(user.id));
    setDrivers(availableDrivers);
    setAssignments(availableAssignments);
    setSelectedDriverId((current) => availableDrivers.some((driver) => driver.id === current) ? current : availableDrivers[0]?.id ?? '');
  }, [online]);

  useEffect(() => {
    if (!['admin', 'dispatcher'].includes(profile.role)) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Duomenų gauti nepavyko.')).finally(() => setBusy(false));
  }, [load, profile.role, router]);

  const driverAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.driverId === selectedDriverId),
    [assignments, selectedDriverId],
  );
  const selectedAssignment = driverAssignments.find((assignment) => assignment.id === selectedAssignmentId) ?? driverAssignments[0] ?? null;

  useEffect(() => {
    setSelectedAssignmentId((current) => driverAssignments.some((assignment) => assignment.id === current)
      ? current
      : driverAssignments[0]?.id ?? '');
  }, [driverAssignments]);

  const execute = async () => {
    if (!selectedAssignment || busy) return;
    setBusy(true);
    setError(null);
    try {
      await prepareAssignmentSnapshotImport(db, selectedAssignment, assignments);
      await importAssignmentSnapshot(db, selectedAssignment, selectedAssignment.driverId);
      // Marks this device as "driving as" the selected driver, the same
      // signal the home-screen picker sets — otherwise every driver-only
      // action on the route (starting loading, etc.) stayed unreachable for
      // admin/dispatcher even after importing and opening it.
      const driver = drivers.find((item) => item.id === selectedAssignment.driverId);
      if (driver) await setActingDriver({ id: driver.id, displayName: driver.displayName });
      const route = selectedAssignment.routeSnapshot.route;
      const destination = resolveRouteDestination(String(route.status ?? 'planned') as 'draft' | 'planned' | 'loading' | 'loaded' | 'in_progress' | 'completed' | 'cancelled', {
        routeId: selectedAssignment.routeId,
        completionStartedAt: typeof route.completion_started_at === 'string' ? route.completion_started_at : null,
        hasSelectedCandidate: Boolean(route.selected_candidate_id),
      });
      router.push({
        pathname: destination.pathname,
        params: { ...destination.params, returnTo: 'execute-route' },
      } as Href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maršruto atidaryti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return <SafeAreaView style={styles.safeArea}>
    <Stack.Screen options={{ title: 'Vykdyti maršrutą' }} />
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>ADMINISTRATORIAUS REŽIMAS</Text>
          <Text style={styles.title}>Vykdyti vairuotojo maršrutą</Text>
          <Text style={styles.helper}>Pasirinkite vairuotoją ir jo priskirtą maršrutą. Atlikti veiksmai bus įrašomi pasirinkto vairuotojo maršrute.</Text>
        </View>
        {busy && drivers.length === 0 ? <ActivityIndicator color={colors.info} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!busy && drivers.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Vykdomų maršrutų nėra</Text><Text style={styles.helper}>Pirmiausia dispečerio lange priskirkite maršrutą vairuotojui.</Text></View> : null}
        {drivers.length > 0 ? <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>1. Vairuotojas</Text>
            <View style={styles.grid}>{drivers.map((driver) => <Pressable key={driver.id} onPress={() => setSelectedDriverId(driver.id)} style={[styles.choice, selectedDriverId === driver.id && styles.choiceSelected]}>
              <Text style={styles.cardTitle}>{driver.displayName}</Text><Text style={styles.helper}>@{driver.username}</Text>
            </Pressable>)}</View>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>2. Maršrutas</Text>
            <View style={styles.grid}>{driverAssignments.map((assignment) => <Pressable key={assignment.id} onPress={() => setSelectedAssignmentId(assignment.id)} style={[styles.choice, selectedAssignment?.id === assignment.id && styles.choiceSelected]}>
              <Text style={styles.cardTitle}>{formatDate(String(assignment.routeSnapshot.route.date ?? ''))}</Text>
              <Text style={styles.helper}>{Number(assignment.routeSnapshot.route.total_stops ?? 0)} taškų · {statusLabel(effectiveAssignmentStatus(assignment))}</Text>
            </Pressable>)}</View>
          </View>
          <Pressable accessibilityLabel="Vykdyti pasirinktą maršrutą" accessibilityRole="button" disabled={!selectedAssignment || busy} onPress={() => void execute()} style={[styles.executeButton, (!selectedAssignment || busy) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.executeText}>Vykdyti pasirinktą maršrutą</Text>}
          </Pressable>
        </> : null}
      </ScrollView>
    </ScreenContainer>
  </SafeAreaView>;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'long' }).format(date);
}

function statusLabel(status: string): string {
  return ({ assigned: 'Priskirtas', downloaded: 'Parsiųstas', in_progress: 'Vykdomas' } as Record<string, string>)[status] ?? status;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, width: '100%', maxWidth: 1100, alignSelf: 'center', padding: spacing.xl, gap: spacing.lg },
  heading: { gap: spacing.xs },
  eyebrow: { ...type.label, color: colors.info },
  title: { ...type.pageTitle, color: colors.text },
  helper: { ...type.body, color: colors.textMuted },
  error: { ...type.bodyStrong, color: colors.danger, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  empty: { padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { ...type.sectionTitle, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minWidth: 220, flexBasis: 220, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
  choiceSelected: { borderWidth: 2, borderColor: colors.info, backgroundColor: colors.infoSoft },
  cardTitle: { ...type.cardTitle, color: colors.text },
  executeButton: { minHeight: 56, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  executeText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  disabled: { opacity: 0.45 },
});
