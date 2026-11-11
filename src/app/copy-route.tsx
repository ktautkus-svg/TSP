import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { duplicateRouteToDate } from '@/application/routes/duplicate-route';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { Alert } from '@/ui/alert';
import { devWarn } from '@/ui/dev-log';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function CopyRouteScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [targetDate, setTargetDate] = useState(tomorrow());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([repository.listOperational(null), repository.listHistory(30, null)])
      .then(([operational, history]) => { if (mounted) setRoutes([...operational, ...history]); })
      .catch((reason) => {
        devWarn('COPY_ROUTE_LIST_FAILED', reason);
        if (mounted) setMessage('Maršrutų sąrašo gauti nepavyko.');
      });
    return () => { mounted = false; };
  }, [repository]));

  const copy = (route: Route) => {
    if (busyId) return;
    if (targetDate === route.date) {
      setMessage('Pasirinkite kitą datą nei originalaus maršruto.');
      return;
    }
    Alert.alert(
      'Kopijuoti maršrutą?',
      `${route.date} maršrutas (${route.totalStops} taškų) bus nukopijuotas į ${targetDate} su dabartiniu taškų eiliškumu. Originalas nesikeičia.`,
      [
        { text: 'Atšaukti', style: 'cancel' },
        {
          text: 'Kopijuoti',
          onPress: () => {
            void (async () => {
              setBusyId(route.id);
              setMessage(null);
              try {
                const newRouteId = await duplicateRouteToDate(db, route.id, targetDate);
                router.replace({ pathname: '/route-management', params: { routeId: newRouteId } } as unknown as Href);
              } catch (reason) {
                setMessage(reason instanceof Error ? reason.message : 'Nukopijuoti nepavyko.');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Kopijuoti maršrutą' }} />
      <FoundationScreen showFoundationNotice={false} title="Kopijuoti maršrutą" description="Pasirinkite maršrutą ir datą. Kopija perima taškų eiliškumą, bet prasideda iš naujo.">
        <View style={styles.dateRow}>
          <Text style={styles.label}>Kopijos data</Text>
          <DateInput onChangeText={setTargetDate} style={styles.dateInput} value={targetDate} />
        </View>
        {routes.length === 0 ? <Text style={styles.meta}>Maršrutų šiame įrenginyje nėra.</Text> : null}
        {routes.map((route) => (
          <Pressable
            accessibilityRole="button"
            disabled={busyId !== null}
            key={route.id}
            onPress={() => copy(route)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed, busyId !== null && styles.disabled]}
            testID={`copy-route-${route.id}`}>
            <View style={styles.rowBody}>
              <Text style={styles.title}>{route.date} · {route.totalStops} taškų</Text>
              <Text style={styles.meta}>{Math.round(route.totalWeightKg)} kg · būsena: {route.status}</Text>
            </View>
            <Text style={styles.action}>{busyId === route.id ? 'Kopijuojama…' : 'Kopijuoti'}</Text>
          </Pressable>
        ))}
        {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  dateRow: { gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },
  dateInput: { minHeight: 44 },
  row: { minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowBody: { flex: 1, minWidth: 0 },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textSecondary },
  action: { ...type.secondaryStrong, color: colors.info },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
  error: { ...type.secondary, color: colors.danger },
});
