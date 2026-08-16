import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type DisplayTripSheet = ServerTripSheet & { source: 'server' | 'local' };

export default function TripSheetScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const [sheets, setSheets] = useState<DisplayTripSheet[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (online) {
        if (profile.role === 'driver') await pushCompletedRouteAssignmentProgress(db);
        const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
        setSheets(response.tripSheets.map((sheet) => ({ ...sheet, source: 'server' })));
      } else {
        setSheets((await repository.list()).map(localSheet));
        setMessage('Rodomi šiame įrenginyje išsaugoti kelionės lapai. Prisijungus bus rodomi serverio duomenys.');
      }
    } catch (error) {
      const local = await repository.list().catch(() => []);
      setSheets(local.map(localSheet));
      setMessage(error instanceof Error ? error.message : 'Kelionės lapų atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [db, online, profile.role, repository]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const syncLocal = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await repository.syncAllCompletedDates();
      await load();
      setMessage('Kelionės lapai atnaujinti.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kelionės lapo atnaujinti nepavyko.');
      setBusy(false);
    }
  };

  const drivers = useMemo(() => [...new Map(sheets.map((sheet) => [sheet.driverId, sheet.driverName])).entries()], [sheets]);
  const visible = profile.role === 'driver' || selectedDriverId === 'all'
    ? sheets
    : sheets.filter((sheet) => sheet.driverId === selectedDriverId);
  const print = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.print();
    else setMessage('PDF arba spausdinimą atidarykite interneto naršyklėje.');
  };
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, title: 'Kelionės lapai' }} />
      <FoundationScreen showFoundationNotice={false} title="Kelionės lapai" description={profile.role === 'driver'
        ? 'Jūsų užbaigtų maršrutų faktiniai darbo duomenys.'
        : 'Visų vairuotojų užbaigti maršrutai, odometrai ir automobiliai.'}>
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} disabled={busy} onPress={() => { void load(); }} testID="refresh-trip-sheets">
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Atnaujinti</Text>}
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={print} testID="print-trip-sheets"><Text style={styles.secondaryText}>Spausdinti / PDF</Text></Pressable>
        </View>
        {!online ? <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => { void syncLocal(); }} testID="sync-trip-sheets"><Text style={styles.secondaryText}>Atnaujinti iš įrenginio maršrutų</Text></Pressable> : null}
        {profile.role !== 'driver' && drivers.length > 1 ? <View style={styles.filters} testID="trip-sheet-driver-filter">
          <Filter label="Visi vairuotojai" active={selectedDriverId === 'all'} onPress={() => setSelectedDriverId('all')} styles={styles} />
          {drivers.map(([id, name]) => <Filter key={id} label={name} active={selectedDriverId === id} onPress={() => setSelectedDriverId(id)} styles={styles} />)}
        </View> : null}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!busy && visible.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Kelionės lapų dar nėra</Text><Text style={styles.meta}>Lapas atsiras automatiškai vairuotojui užbaigus priskirtą maršrutą ir įvedus galutinį odometrą.</Text></View> : null}
        {visible.map((sheet) => <TripSheetCard key={sheet.id} sheet={sheet} styles={styles} />)}
      </FoundationScreen>
    </>
  );
}

function TripSheetCard({ sheet, styles }: { sheet: DisplayTripSheet; styles: ReturnType<typeof createStyles> }) {
  const distance = sheet.actualDistanceKm ?? (sheet.startOdometer !== null && sheet.endOdometer !== null ? sheet.endOdometer - sheet.startOdometer : sheet.plannedDistanceKm);
  return <View style={styles.sheet} testID={`trip-sheet-${sheet.id}`}>
    <View style={styles.sheetHeader}>
      <View style={styles.flex}><Text style={styles.date}>{formatDate(sheet.date)}</Text><Text style={styles.driver}>{sheet.driverName}</Text></View>
      <View style={styles.routeBadge}><Text style={styles.routeBadgeText}>{sheet.routeNumbers.join(', ') || 'MARŠRUTAS'}</Text></View>
    </View>
    <View style={styles.vehicleBar}>
      <Text style={styles.vehicleNumber}>{sheet.vehicle?.registrationNumber ?? 'Automobilis nepriskirtas'}</Text>
      {sheet.vehicle ? <Text style={styles.meta}>{sheet.vehicle.model} · iki {formatWeightKg(sheet.vehicle.maximumPayloadKg)} kg</Text> : null}
    </View>
    <View style={styles.metrics}>
      <Metric label="ODOMETRAS" value={`${formatNumber(sheet.startOdometer)} → ${formatNumber(sheet.endOdometer)}`} styles={styles} />
      <Metric label="NUVAŽIUOTA" value={distance === null ? '—' : `${formatNumber(distance)} km`} styles={styles} />
      <Metric label="DARBO LAIKAS" value={formatDuration(sheet.durationMinutes)} styles={styles} />
      <Metric label="TAŠKAI" value={`${sheet.deliveredStops} / ${sheet.totalStops}`} styles={styles} />
      <Metric label="PRISTATYTA" value={`${formatWeightKg(sheet.deliveredWeightKg)} kg`} styles={styles} />
      <Metric label="PLANUOTA" value={`${formatWeightKg(sheet.totalWeightKg)} kg`} styles={styles} />
      {sheet.vehicle?.fuelRemainingLiters !== null && sheet.vehicle?.fuelRemainingLiters !== undefined ? <Metric label="KURO LIKUTIS STARTUOJANT" value={`${formatNumber(sheet.vehicle.fuelRemainingLiters)} l`} styles={styles} /> : null}
    </View>
    {sheet.compensation ? <View style={styles.compensation} testID={`compensation-${sheet.id}`}>
      <View style={styles.compensationHeader}>
        <View style={styles.flex}>
          <Text style={styles.compensationEyebrow}>{sheet.compensation.preliminary ? 'PRELIMINARUS DIENOS ATLYGIS' : 'GALUTINIS DIENOS ATLYGIS'}</Text>
          <Text style={styles.compensationTotal}>{formatMoney(sheet.compensation.totalNetEur)} netto</Text>
        </View>
        <Text style={styles.compensationSource}>{sheet.compensation.distanceSource === 'odometer' ? 'pagal odometrą' : 'pagal planuojamus km'}</Text>
      </View>
      <View style={styles.compensationRows}>
        <Text style={styles.compensationLine}>Diena: {formatMoney(sheet.compensation.fixedAmountEur)}</Text>
        <Text style={styles.compensationLine}>Km: {formatNumber(sheet.compensation.distanceKm)} × {formatMoney(sheet.compensation.rates.perKmEur)} = {formatMoney(sheet.compensation.distanceAmountEur)}</Text>
        <Text style={styles.compensationLine}>Svoris: {formatWeightKg(sheet.compensation.weightKg)} kg × {formatMoney(sheet.compensation.rates.perKgEur)} = {formatMoney(sheet.compensation.weightAmountEur)}</Text>
        <Text style={styles.compensationLine}>Taškai: {sheet.compensation.stops} × {formatMoney(sheet.compensation.rates.perStopEur)} = {formatMoney(sheet.compensation.stopsAmountEur)}</Text>
      </View>
    </View> : null}
    <View style={styles.routeBlock}><Text style={styles.routeLabel}>PRADŽIA · {formatTime(sheet.startedAt)}</Text><Text style={styles.routeAddress}>{sheet.startAddress}</Text></View>
    <View style={styles.routeBlock}><Text style={styles.routeLabel}>PABAIGA · {formatTime(sheet.completedAt)}</Text><Text style={styles.routeAddress}>{sheet.endAddress}</Text></View>
  </View>;
}

function Filter({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable onPress={onPress} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function localSheet(sheet: TripSheetWithRoutes): DisplayTripSheet {
  return {
    id: sheet.id, assignmentId: sheet.id, routeId: sheet.routeIds[0] ?? sheet.id, routeNumbers: [], date: sheet.date, status: 'completed',
    driverId: 'local', driverName: 'Šio įrenginio vairuotojas', vehicle: { id: sheet.vehicleId, registrationNumber: sheet.vehicleName, model: sheet.vehicleName, maximumPayloadKg: 0 },
    startOdometer: sheet.startOdometer, endOdometer: sheet.endOdometer, actualDistanceKm: sheet.actualDistanceKm,
    plannedDistanceKm: sheet.plannedDistanceKm, startedAt: sheet.actualStartAt, completedAt: sheet.completedAt,
    durationMinutes: sheet.actualDurationMinutes, totalStops: sheet.totalStops, deliveredStops: sheet.totalStops,
    totalWeightKg: sheet.totalDeliveredWeightKg, deliveredWeightKg: sheet.totalDeliveredWeightKg,
    startAddress: sheet.startLocation.address ?? sheet.startLocation.label, endAddress: sheet.endLocation.address ?? sheet.endLocation.label, compensation: null, source: 'local',
  };
}

function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'long' }).format(date); }
function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value); }
function formatDuration(minutes: number | null): string { if (minutes === null) return '—'; const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} val. ${rest} min.` : `${rest} min.`; }
function formatTime(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit' }).format(date); }
function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 120, minHeight: 48, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, secondaryText: { ...type.button, color: colors.textSecondary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, filter: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, justifyContent: 'center' }, filterActive: { backgroundColor: colors.info, borderColor: colors.info }, filterText: { ...type.secondaryStrong, color: colors.text }, filterTextActive: { color: colors.textInverse },
  message: { ...type.secondary, color: colors.textMuted }, empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  sheet: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, flex: { flex: 1, minWidth: 0 }, date: { ...type.sectionTitle, color: colors.text }, driver: { ...type.bodyStrong, color: colors.info, marginTop: 2 },
  routeBadge: { borderRadius: radius.sm, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, routeBadgeText: { ...type.label, color: colors.info },
  vehicleBar: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 2 }, vehicleNumber: { ...type.readout, color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, minWidth: 115, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle, gap: 2 }, metricLabel: { ...type.label, color: colors.textMuted }, metricValue: { ...type.bodyStrong, color: colors.text },
  compensation: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceSubtle, gap: spacing.sm }, compensationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, compensationEyebrow: { ...type.label, color: colors.success }, compensationTotal: { ...type.readout, color: colors.text, marginTop: 2 }, compensationSource: { ...type.secondary, color: colors.textMuted }, compensationRows: { gap: 3 }, compensationLine: { ...type.secondary, color: colors.textSecondary },
  routeBlock: { borderLeftWidth: 3, borderLeftColor: colors.info, paddingLeft: spacing.sm, gap: 2 }, routeLabel: { ...type.label, color: colors.textMuted }, routeAddress: { ...type.body, color: colors.text }, cardTitle: { ...type.sectionTitle, color: colors.text }, meta: { ...type.secondary, color: colors.textMuted },
});
