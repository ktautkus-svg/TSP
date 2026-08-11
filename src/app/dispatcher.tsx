import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { assignRouteToDriver } from '@/application/auth/route-assignment-sync';
import { syncRoutesWithCloud } from '@/application/sync/route-cloud-sync';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { employeeApi, type EmployeeProfile, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type LocalRoute = {
  id: string;
  date: string;
  status: string;
  total_stops: number;
  total_weight_kg: number;
  estimated_distance_km: number | null;
  estimated_duration_minutes: number | null;
  start_location_json: string | null;
  end_location_json: string | null;
};

export default function DispatcherScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const desktop = width >= 980;
  const [routes, setRoutes] = useState<LocalRoute[]>([]);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Dispatchers create and own routes on this device (the "+ Planuoti
    // maršrutą" flow below), but the home screen redirects them here before its
    // sync effect runs, so their own routes never reached the cloud and a
    // dispatcher planning on a desktop saw nothing on their tablet. Same
    // protocol as the driver path, just the trigger that was missing.
    if (online) {
      await syncRoutesWithCloud(db).catch((reason) => {
        if (__DEV__) console.warn('ROUTE_CLOUD_SYNC_FAILED', reason);
      });
    }
    const localRoutes = await db.getAllAsync<LocalRoute>(
      `SELECT id, date, status, total_stops, total_weight_kg, estimated_distance_km,
              estimated_duration_minutes, start_location_json, end_location_json
       FROM routes
       WHERE status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC`,
    );
    setRoutes(localRoutes);
    setSelectedRouteId((current) => current && localRoutes.some((route) => route.id === current)
      ? current
      : localRoutes[0]?.id ?? null);
    if (!online) return;
    const [userResponse, assignmentResponse] = await Promise.all([
      employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
      employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
    ]);
    const availableDrivers = userResponse.users.filter((user) => user.role === 'driver' && !user.disabled);
    setDrivers(availableDrivers);
    setAssignments(assignmentResponse.assignments);
    setSelectedDriverId((current) => current && availableDrivers.some((driver) => driver.id === current)
      ? current
      : availableDrivers.find((driver) => !assignmentResponse.assignments.some((assignment) => assignment.driverId === driver.id && isActiveAssignment(assignment)))?.id ?? null);
  }, [db, online]);

  useEffect(() => {
    if (!['admin', 'dispatcher'].includes(profile.role)) {
      router.replace('/' as Href);
      return;
    }
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Skydelio duomenų gauti nepavyko.'));
  }, [load, profile.role, router]);

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) ?? null;
  const assign = async () => {
    if (busy || !selectedRoute || !selectedDriver) return;
    if (selectedRoute.status !== 'planned') {
      setMessage('Pirmiausia užbaikite maršruto planavimą ir pasirinkite variantą.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await assignRouteToDriver(db, selectedRoute.id, selectedDriver.id);
      setMessage(`Maršrutas priskirtas: ${selectedDriver.displayName}. Vairuotojas jį gaus prisijungęs.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Maršruto priskirti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const activeAssignments = assignments.filter(isActiveAssignment);
  const freeDrivers = drivers.filter((driver) => !activeAssignments.some((assignment) => assignment.driverId === driver.id));

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Dispečerio skydelis', headerBackVisible: false }} />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.eyebrow}>TSP · DARBO VALDYMAS</Text>
            <Text style={styles.pageTitle}>Maršrutų planavimas</Text>
            <Text style={styles.subtitle}>Paruoškite maršrutą ir perduokite jį konkrečiam vairuotojui.</Text>
          </View>
          <View style={styles.topActions}>
            <Pressable style={styles.secondaryButton} onPress={() => void load()}><Text style={styles.secondaryText}>Atnaujinti</Text></Pressable>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/import' as Href)}><Text style={styles.primaryText}>+ Planuoti maršrutą</Text></Pressable>
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric label="Aktyvūs priskyrimai" value={activeAssignments.length} styles={styles} />
          <Metric label="Laisvi vairuotojai" value={freeDrivers.length} styles={styles} />
          <Metric label="Vairuotojai" value={drivers.length} styles={styles} />
          <Metric label="Ruošiami maršrutai" value={routes.length} styles={styles} />
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!online ? <Text style={styles.warning}>Prisijunkite prie interneto — priskyrimas vairuotojui saugomas serveryje.</Text> : null}

        <View style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          <View style={[styles.panel, desktop && styles.routePanel]}>
            <View style={styles.panelHeading}>
              <View><Text style={styles.panelTitle}>1. Maršrutas</Text><Text style={styles.panelHint}>Pasirinkite suplanuotą maršrutą</Text></View>
              <Text style={styles.countBadge}>{routes.length}</Text>
            </View>
            {routes.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTitle}>Paruoštų maršrutų nėra</Text><Text style={styles.panelHint}>Importuokite Excel arba įveskite adresus ir pasirinkite maršruto variantą.</Text></View>
            ) : routes.map((route) => {
              const alreadyAssigned = assignments.some((assignment) => assignment.routeId === route.id && isActiveAssignment(assignment));
              return <Pressable key={route.id} onPress={() => setSelectedRouteId(route.id)} style={[styles.routeCard, selectedRouteId === route.id && styles.selectedCard]}>
                <View style={styles.routeCardTop}><Text style={styles.routeDate}>{formatDate(route.date)}</Text><StatusBadge status={alreadyAssigned ? 'assigned' : route.status} styles={styles} /></View>
                <Text style={styles.routeNumbers}>{route.total_stops} taškų · {Math.round(route.total_weight_kg)} kg · {formatKm(route.estimated_distance_km)}</Text>
                <Text numberOfLines={1} style={styles.routeEndpoint}>{endpointLabel(route.start_location_json)} → {endpointLabel(route.end_location_json)}</Text>
              </Pressable>;
            })}
          </View>

          <View style={[styles.panel, desktop && styles.driverPanel]}>
            <View style={styles.panelHeading}><View><Text style={styles.panelTitle}>2. Vairuotojas</Text><Text style={styles.panelHint}>Pasirinkite, kam perduoti darbą</Text></View><Text style={styles.countBadge}>{freeDrivers.length}</Text></View>
            <View style={styles.driverGrid}>
              {drivers.map((driver) => {
                const assignment = activeAssignments.find((item) => item.driverId === driver.id);
                const unavailable = Boolean(assignment);
                return <Pressable
                  key={driver.id}
                  disabled={unavailable}
                  onPress={() => setSelectedDriverId(driver.id)}
                  style={[styles.driverCard, selectedDriverId === driver.id && styles.selectedCard, unavailable && styles.unavailable]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials(driver.displayName)}</Text></View>
                  <View style={styles.driverText}><Text style={styles.driverName}>{driver.displayName}</Text><Text style={styles.panelHint}>@{driver.username}</Text></View>
                  <Text style={[styles.availability, unavailable && styles.busyText]}>{unavailable ? 'Turi maršrutą' : 'Laisvas'}</Text>
                </Pressable>;
              })}
            </View>
          </View>

          <View style={[styles.panel, desktop && styles.actionPanel]}>
            <Text style={styles.panelTitle}>3. Patvirtinimas</Text>
            <Summary label="Maršrutas" value={selectedRoute ? `${formatDate(selectedRoute.date)} · ${selectedRoute.total_stops} taškų` : 'Nepasirinktas'} styles={styles} />
            <Summary label="Vairuotojas" value={selectedDriver?.displayName ?? 'Nepasirinktas'} styles={styles} />
            <Pressable disabled={busy || !online || !selectedRoute || !selectedDriver} onPress={() => void assign()} style={[styles.assignButton, (busy || !online || !selectedRoute || !selectedDriver) && styles.disabled]}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.assignText}>Priskirti vairuotojui</Text>}
            </Pressable>
            <Pressable style={styles.permissionsLink} onPress={() => router.push('/admin' as Href)}><Text style={styles.permissionsText}>Darbuotojai ir leidimai →</Text></Pressable>
          </View>
        </View>

        <View style={styles.assignmentsPanel}>
          <Text style={styles.panelTitle}>Vairuotojų maršrutai</Text>
          {activeAssignments.length === 0 ? <Text style={styles.panelHint}>Šiuo metu vairuotojams nieko nepriskirta.</Text> : activeAssignments.map((assignment) => (
            <View key={assignment.id} style={styles.assignmentRow}>
              <View><Text style={styles.driverName}>{assignment.driverName}</Text><Text style={styles.panelHint}>{formatDate(String(assignment.routeSnapshot.route.date ?? ''))} · {Number(assignment.routeSnapshot.route.total_stops ?? 0)} taškų</Text></View>
              <StatusBadge status={assignment.status} styles={styles} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function isActiveAssignment(assignment: ServerRouteAssignment): boolean { return !['completed', 'cancelled'].includes(assignment.status); }
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { month: 'short', day: 'numeric', weekday: 'short' }).format(date); }
function formatKm(value: number | null): string { return value === null ? 'atstumas dar neskaičiuotas' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value)} km`; }
function endpointLabel(json: string | null): string { try { const value = JSON.parse(json ?? '{}') as { normalizedAddress?: string; originalAddress?: string }; return value.normalizedAddress ?? value.originalAddress ?? 'Nenurodyta'; } catch { return 'Nenurodyta'; } }
function statusLabel(status: string): string { return ({ draft: 'Ruošiamas', planned: 'Paruoštas', assigned: 'Priskirtas', downloaded: 'Atsisiųstas', in_progress: 'Vykdomas', loading: 'Kraunamas', loaded: 'Pakrautas' } as Record<string, string>)[status] ?? status; }
function Metric({ label, value, styles }: { label: string; value: number; styles: ReturnType<typeof createStyles> }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function StatusBadge({ status, styles }: { status: string; styles: ReturnType<typeof createStyles> }) { return <Text style={styles.statusBadge}>{statusLabel(status)}</Text>; }
function Summary({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) { return <View style={styles.summary}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: spacing.xl, gap: spacing.lg },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg },
  eyebrow: { ...type.label, color: colors.textMuted },
  pageTitle: { ...type.pageTitle, color: colors.text, fontSize: 32, lineHeight: 38 },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: spacing.xs },
  topActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: 'center', backgroundColor: colors.actionPrimary },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  secondaryText: { ...type.button, color: colors.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { minWidth: 170, flexGrow: 1, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricValue: { ...type.pageTitle, color: colors.info },
  metricLabel: { ...type.secondaryStrong, color: colors.textMuted },
  message: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, color: colors.info },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  workspace: { gap: 16 },
  workspaceDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  panel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  routePanel: { flex: 1.05, minWidth: 0 },
  driverPanel: { flex: 1.15, minWidth: 0 },
  actionPanel: { width: 300 },
  panelHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  panelTitle: { ...type.sectionTitle, color: colors.text, fontSize: 19, lineHeight: 24 },
  panelHint: { ...type.secondary, color: colors.textMuted },
  countBadge: { minWidth: 30, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', textAlign: 'center', backgroundColor: colors.infoSoft, color: colors.info, fontFamily: type.secondaryStrong.fontFamily },
  empty: { paddingVertical: 24, gap: 5 },
  emptyTitle: { ...type.cardTitle, color: colors.text },
  routeCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  selectedCard: { borderColor: colors.info, borderWidth: 2, backgroundColor: colors.infoSoft },
  routeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  routeDate: { ...type.cardTitle, color: colors.text, fontSize: 16 },
  statusBadge: { ...type.meta, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.accentSoft, color: colors.success },
  routeNumbers: { ...type.bodyStrong, color: colors.textSecondary },
  routeEndpoint: { ...type.secondary, color: colors.textMuted },
  driverGrid: { gap: 9 },
  driverCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 10 },
  unavailable: { opacity: 0.5, backgroundColor: colors.disabledSurface },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft },
  avatarText: { ...type.bodyStrong, color: colors.info },
  driverText: { flex: 1, minWidth: 0 },
  driverName: { ...type.cardTitle, color: colors.text },
  availability: { ...type.meta, color: colors.success },
  busyText: { color: colors.warning },
  summary: { gap: 3, paddingVertical: 6 },
  summaryLabel: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  summaryValue: { ...type.bodyStrong, color: colors.text },
  assignButton: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  assignText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  disabled: { opacity: 0.45 },
  permissionsLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  permissionsText: { ...type.button, color: colors.info },
  assignmentsPanel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  assignmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
});

