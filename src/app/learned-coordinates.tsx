import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { FoundationScreen } from '@/components/foundation-screen';
import {
  filterLearnedCoordinates,
  learnedCoordinateCsv,
  rejectionReasonLabel,
  toLearnedCoordinateRow,
  type LearnedCoordinateRow,
  type LearnedCoordinateStatus,
} from '@/domain/learned-coordinate-audit';
import { employeeApi } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const STATUSES: { id: LearnedCoordinateStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Visi' },
  { id: 'used', label: 'Naudojama' },
  { id: 'needs_samples', label: 'Laukia mėginių' },
  { id: 'imprecise', label: 'Netiksli' },
  { id: 'rejected', label: 'Atmesta' },
];

export default function LearnedCoordinatesScreen() {
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [rows, setRows] = useState<LearnedCoordinateRow[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<LearnedCoordinateStatus | 'all'>('all');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const allowed = profile.role === 'admin';

  const load = useCallback(async () => {
    if (!allowed) return;
    setBusy(true);
    try {
      const response = await employeeApi<{ pins: LearnedCoordinateRow[] }>('/api/admin/learned-coordinates');
      setRows((response.pins ?? []).map(toLearnedCoordinateRow));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Išmoktų koordinačių gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [allowed]);

  useEffect(() => { void load(); }, [load]);

  const visible = filterLearnedCoordinates(rows, { address: query, status });
  const counts = {
    used: rows.filter((row) => row.status === 'used').length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
    needs: rows.filter((row) => row.status === 'needs_samples' || row.status === 'imprecise').length,
  };

  const exportCsv = () => {
    const csv = learnedCoordinateCsv(visible);
    if (typeof document === 'undefined') {
      Alert.alert('Eksportas', 'CSV paruoštas, bet ši aplinka neturi atsisiuntimo.');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'firo-ismoktos-koordinates.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = (row: LearnedCoordinateRow) => {
    Alert.alert('Pašalinti išmoktą tašką?', `${row.address}\nOriginali geokodavimo koordinatė išliks.`, [
      { text: 'Atšaukti', style: 'cancel' },
      { text: 'Pašalinti', style: 'destructive', onPress: () => { void (async () => {
        await employeeApi('/api/admin/learned-coordinates', { method: 'DELETE', body: JSON.stringify({ normalizedAddress: row.normalizedAddress }) });
        await load();
      })(); } },
    ]);
  };

  if (!allowed) return <FoundationScreen title="Išmoktos koordinatės" description="Tik administratorius." showFoundationNotice={false}><Text>Tik administratorius gali peržiūrėti išmoktas koordinates.</Text></FoundationScreen>;

  return (
    <>
      <Stack.Screen options={{ title: 'Išmoktos koordinatės' }} />
      <FoundationScreen title="Išmoktos koordinatės" description="Faktinio pridavimo taškai. Originalus geokodas lieka audite." showFoundationNotice={false}>
        <Text style={styles.title}>Išmoktos pridavimo koordinatės</Text>
        <Text style={styles.meta} testID="learned-coordinate-counts">{rows.length} įrašų · {counts.used} naudojama · {counts.rejected} atmesta · {counts.needs} nepakanka duomenų</Text>
        {!online ? <Text style={styles.warning}>Nėra ryšio. Sąrašas imamas iš serverio, vietiniai mėginiai bus parodyti po sinchronizacijos.</Text> : null}
        {error ? <Text style={styles.warning}>{error}</Text> : null}
        <TextInput value={query} onChangeText={setQuery} placeholder="Filtruoti pagal adresą" style={styles.input} testID="learned-coordinate-filter" />
        <View style={styles.filters}>
          {STATUSES.map((item) => (
            <Pressable key={item.id} onPress={() => setStatus(item.id)} style={[styles.chip, status === item.id && styles.chipActive]}>
              <Text style={styles.chipText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={exportCsv} style={styles.button} testID="learned-coordinate-export"><Text style={styles.buttonText}>Eksportuoti CSV</Text></Pressable>
        {busy ? <ActivityIndicator /> : null}
        {visible.map((row) => (
          <Pressable key={`${row.normalizedAddress}-${row.lastSampledAt}`} onPress={() => setSelected(row.normalizedAddress)} style={styles.card}>
            <Text style={styles.cardTitle}>{row.address}</Text>
            <Text style={styles.meta}>{row.status} · {row.sampleCount} mėg. · {row.differenceM ?? '—'} m · {row.lastSampledAt ?? 'nėra datos'}</Text>
            {selected === row.normalizedAddress ? (
              <View>
                <Text style={styles.meta}>Normalizuotas: {row.normalizedAddress}</Text>
                <Text style={styles.meta}>Gavėjas: {row.recipient ?? '—'}</Text>
                <Text style={styles.meta}>Maršrutas: {row.routeNumber ?? row.orderNumber ?? '—'}</Text>
                <Text style={styles.meta}>Geokodas: {row.geocodeLatitude ?? '—'}, {row.geocodeLongitude ?? '—'}</Text>
                <Text style={styles.meta}>Išmokta: {row.learnedLatitude ?? '—'}, {row.learnedLongitude ?? '—'}</Text>
                <Text style={styles.meta}>Tikslumas: {row.accuracyM ?? '—'} m · {row.driverName ?? row.deviceId ?? '—'}</Text>
                {row.rejectionReason ? <Text style={styles.meta}>Atmesta: {rejectionReasonLabel(row.rejectionReason)}</Text> : null}
                <Pressable onPress={() => remove(row)} style={styles.danger} testID={`learned-coordinate-remove-${row.normalizedAddress}`}><Text style={styles.buttonText}>Pašalinti išmoktą tašką</Text></Pressable>
              </View>
            ) : null}
          </Pressable>
        ))}
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.meta, color: colors.textMuted },
  warning: { color: colors.warning },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, color: colors.text },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.surfaceMuted },
  chipText: { color: colors.text },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.actionPrimary, borderRadius: radius.md },
  buttonText: { color: colors.textInverse },
  card: { gap: spacing.xs, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  cardTitle: { ...type.label, color: colors.text },
  danger: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.danger, borderRadius: radius.md },
});
