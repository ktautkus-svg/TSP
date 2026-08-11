import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function TripSheetScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const [sheets, setSheets] = useState<TripSheetWithRoutes[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setSheets(await repository.list()); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Kelionės lapų atkurti nepavyko.'); }
    finally { setBusy(false); }
  }, [repository]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await repository.syncAllCompletedDates();
      setSheets(next);
      setMessage(next.length ? 'Kelionės lapai atnaujinti pagal užbaigtus maršrutus.' : 'Užbaigtų maršrutų dar nėra.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kelionės lapo atnaujinti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Kelionės lapai"
      description="Faktiniai dienos duomenys sudaromi iš užbaigtų maršrutų ir odometro rodmenų.">
      <Pressable style={styles.primaryButton} disabled={busy} onPress={() => { void sync(); }} testID="sync-trip-sheets">
        {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Atnaujinti iš užbaigtų maršrutų</Text>}
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => router.push('/vehicle' as Href)}>
        <Text style={styles.secondaryText}>Transporto priemonė</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {!busy && sheets.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>Kelionės lapų dar nėra</Text>
          <Text style={styles.meta}>Užbaikite bent vieną maršrutą ir paspauskite atnaujinimo mygtuką.</Text>
        </View>
      ) : null}
      {sheets.map((sheet) => (
        <View key={sheet.id} style={styles.card} testID={`trip-sheet-${sheet.date}`}>
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{formatDate(sheet.date)}</Text>
              <Text style={styles.meta}>{sheet.vehicleName} · {sheet.routeIds.length} maršrutas(-ai)</Text>
            </View>
            <Text style={styles.distance}>{formatDistance(sheet.actualDistanceKm ?? sheet.plannedDistanceKm)}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric styles={styles} label="ODOMETRAS" value={formatOdometers(sheet.startOdometer, sheet.endOdometer)} />
            <Metric styles={styles} label="PRISTATYTA" value={`${sheet.totalStops} tšk. · ${formatWeightKg(sheet.totalDeliveredWeightKg)} kg`} />
            <Metric styles={styles} label="LAIKAS" value={formatDuration(sheet.actualDurationMinutes)} />
          </View>
          <Text style={styles.routeLine}>{sheet.startLocation.address ?? sheet.startLocation.label}</Text>
          <Text style={styles.routeLine}>→ {sheet.endLocation.address ?? sheet.endLocation.label}</Text>
        </View>
      ))}
    </FoundationScreen>
  );
}

function Metric({ styles, label, value }: { styles: ReturnType<typeof createStyles>; label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'long' }).format(parsed);
}

function formatDistance(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value)} km`;
}

function formatOdometers(start: number | null, end: number | null): string {
  if (start === null && end === null) return 'Nenurodyta';
  return `${start ?? '—'} → ${end ?? '—'}`;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} val. ${rest} min.` : `${rest} min.`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  primaryButton: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...type.button, color: colors.textSecondary },
  message: { color: colors.textMuted, lineHeight: 20 },
  empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  cardTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  distance: { ...type.readout, color: colors.info },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 120, flexGrow: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.infoSoft, gap: 3 },
  metricLabel: { ...type.label, color: colors.textMuted },
  metricValue: { ...type.bodyStrong, color: colors.text },
  routeLine: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
