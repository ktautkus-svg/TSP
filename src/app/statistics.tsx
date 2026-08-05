import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { StatBarChart } from '@/components/stat-bar-chart';
import { StatisticsRepository } from '@/database/repositories/statistics-repository';
import type { StatisticsPeriodTotals, StatisticsSnapshot } from '@/domain/statistics';
import { formatLithuanianDate } from '@/ui/history-labels';
import { durationLabel } from '@/ui/route-eta-labels';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function StatisticsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new StatisticsRepository(db), [db]);
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.getSnapshot().then((data) => {
      if (!mounted) return;
      setSnapshot(data);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('STATISTICS_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Statistikos atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository]));

  const goHome = () => router.replace('/' as Href);

  const empty = snapshot !== null && snapshot.allTime.routeCount === 0;

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
      headerRight: () => null,
    }} />
    <FoundationScreen
      showFoundationNotice={false}
      title="Statistika"
      description="Paskutinių 12 mėnesių užbaigti ir atšaukti maršrutai.">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>Statistikos dar nėra</Text>
          <Text style={styles.meta}>Užbaikite bent vieną maršrutą — skaičiai atsiras čia.</Text>
        </View>
      ) : null}
      {snapshot && !empty ? (
        <>
          <View style={styles.tileRow}>
            <SummaryTile styles={styles} label="Šiandien" totals={snapshot.today} />
            <SummaryTile styles={styles} label="Ši savaitė" totals={snapshot.thisWeek} />
            <SummaryTile styles={styles} label="Šis mėnuo" totals={snapshot.thisMonth} />
            <SummaryTile styles={styles} label="12 mėn." totals={snapshot.allTime} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kilometrai per dieną (30 d.)</Text>
            <StatBarChart
              colors={colors}
              color={colors.primary}
              data={snapshot.dailySeries.map((day) => ({ label: shortDayLabel(day.date), value: day.km }))}
              valueFormatter={(value) => `${value.toFixed(0)} km`}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kilometrai per mėnesį (12 mėn.)</Text>
            <StatBarChart
              colors={colors}
              color={colors.info}
              data={snapshot.monthlySeries.map((month) => ({ label: shortMonthLabel(month.month), value: month.km }))}
              valueFormatter={(value) => `${value.toFixed(0)} km`}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pristatymo baigtys (12 mėn.)</Text>
            <OutcomeBar styles={styles} colors={colors} totals={snapshot.allTime} />
          </View>

          {snapshot.failureReasons.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nesėkmės priežastys</Text>
              {snapshot.failureReasons.map((item) => (
                <View key={item.reason} style={styles.failureRow}>
                  <Text style={styles.meta}>{item.reason}</Text>
                  <Text style={styles.failureCount}>{item.count}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {snapshot.bestDay ? (
            <View style={styles.highlightCard}>
              <Text style={styles.cardTitle}>Geriausia diena</Text>
              <Text style={styles.meta}>
                {formatLithuanianDate(snapshot.bestDay.date)} — {snapshot.bestDay.km.toFixed(1)} km
                {snapshot.bestDay.kmIsActual ? '' : ' (planuota)'}
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vidurkiai (12 mėn.)</Text>
            <Text style={styles.meta}>Km taškui: {snapshot.averageKmPerStop === null ? '—' : `${snapshot.averageKmPerStop.toFixed(2)} km`}</Text>
            <Text style={styles.meta}>Taškų maršrutui: {snapshot.averageStopsPerRoute === null ? '—' : snapshot.averageStopsPerRoute.toFixed(1)}</Text>
            <Text style={styles.meta}>Maršruto trukmė: {snapshot.averageRouteDurationMinutes === null ? '—' : durationLabel(snapshot.averageRouteDurationMinutes)}</Text>
          </View>
        </>
      ) : null}
      <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
    </FoundationScreen>
    </>
  );
}

function SummaryTile({ styles, label, totals }: { styles: ReturnType<typeof createStyles>; label: string; totals: StatisticsPeriodTotals }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{totals.totalKm.toFixed(0)} km</Text>
      <Text style={styles.tileMeta}>{totals.deliveredStops} pristatyta{totals.failedStops > 0 ? ` · ${totals.failedStops} nepavyko` : ''}</Text>
    </View>
  );
}

function OutcomeBar({ styles, colors, totals }: { styles: ReturnType<typeof createStyles>; colors: ColorPalette; totals: StatisticsPeriodTotals }) {
  const total = totals.deliveredStops + totals.failedStops + totals.unmarkedStops;
  if (total === 0) return <Text style={styles.meta}>Dar nėra pažymėtų taškų.</Text>;
  return (
    <>
      <View style={styles.outcomeBar}>
        <View style={{ flex: totals.deliveredStops, backgroundColor: colors.success }} />
        <View style={{ flex: totals.failedStops, backgroundColor: colors.danger }} />
        <View style={{ flex: totals.unmarkedStops, backgroundColor: colors.warning }} />
      </View>
      <View style={styles.outcomeLegendRow}>
        <Text style={[styles.outcomeLegend, { color: colors.success }]}>Pristatyta {totals.deliveredStops}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.danger }]}>Nepavyko {totals.failedStops}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.warning }]}>Nepažymėta {totals.unmarkedStops}</Text>
      </View>
    </>
  );
}

function shortDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'Europe/Vilnius', day: '2-digit', month: '2-digit' }).format(date);
}

function shortMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey}-01T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return monthKey;
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'Europe/Vilnius', month: 'short', year: '2-digit' }).format(date);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  empty: { padding: spacing.lg, borderRadius: 16, backgroundColor: colors.surface, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  highlightCard: { padding: spacing.md, borderRadius: 16, backgroundColor: colors.primarySoft, gap: spacing.xs },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, minWidth: '45%', padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  tileLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  tileMeta: { color: colors.textMuted, fontSize: 13 },
  failureRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  failureCount: { color: colors.text, fontWeight: '800' },
  outcomeBar: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  outcomeLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  outcomeLegend: { fontSize: 12, fontWeight: '700' },
  homeButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  homeText: { color: colors.primary, fontWeight: '800' },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.primary, fontWeight: '800' },
});
