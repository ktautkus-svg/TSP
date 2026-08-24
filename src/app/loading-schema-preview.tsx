import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { FoundationScreen } from '@/components/foundation-screen';
import { LoadingSchemaCard } from '@/components/loading-schema-card';
import {
  cargoLayoutFromAssignedVehicle,
  recommendLoadingSchema,
  type LoadingSchemaStopInput,
} from '@/domain/loading-schema';
import { employeeApi, type ServerFleetVehicle } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const STOP_COUNTS = [4, 6, 8, 10, 13] as const;

export default function LoadingSchemaPreviewScreen() {
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageVehicles);

  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [stopCount, setStopCount] = useState<number>(8);
  const [heavyEveryOther, setHeavyEveryOther] = useState(true);

  useEffect(() => {
    if (!allowed) { router.replace(roleHomePath(profile.role) as Href); return; }
    if (!online) return;
    employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles')
      .then((response) => {
        setVehicles(response.vehicles);
        if (response.vehicles.length > 0) setVehicleId((current) => current ?? response.vehicles[0].id);
      })
      .catch(() => undefined);
  }, [allowed, online, profile.role, router]);

  const vehicle = vehicles.find((item) => item.id === vehicleId) ?? null;
  const cargoLayout = useMemo(() => cargoLayoutFromAssignedVehicle(vehicle), [vehicle]);
  const stops = useMemo<LoadingSchemaStopInput[]>(() => Array.from({ length: stopCount }, (_, index) => ({
    id: `preview-stop-${index + 1}`,
    loadingSequence: stopCount - index,
    deliveryOrder: index + 1,
    weightKg: heavyEveryOther && index % 2 === 0 ? 60 : 8,
    recipient: `Gavėjas ${index + 1}`,
    address: `Bandomasis adresas ${index + 1}`,
  })), [heavyEveryOther, stopCount]);
  const schema = useMemo(
    () => recommendLoadingSchema(stops, {
      bodyKind: cargoLayout.bodyKind,
      hasSideDoor: cargoLayout.hasSideDoor,
      maximumPayloadKg: cargoLayout.maximumPayloadKg,
    }),
    [cargoLayout.bodyKind, cargoLayout.hasSideDoor, cargoLayout.maximumPayloadKg, stops],
  );

  if (!allowed) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Krovimo schema (peržiūra)' }} />
      <FoundationScreen
        contentMaxWidth={900}
        description="Bandomieji taškai — ne realus maršrutas. Skirta pasitikrinti, kaip schema atrodo kiekvienam automobiliui, neinant į konkretų reisą."
        showFoundationNotice={false}
        title="Krovimo schema (peržiūra)">

        <View style={styles.panel}>
          <Text style={styles.fieldLabel}>AUTOMOBILIS</Text>
          <View style={styles.choices} testID="loading-preview-vehicle-filter">
            {vehicles.map((item) => <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: vehicleId === item.id }}
              onPress={() => setVehicleId(item.id)}
              style={[styles.choice, vehicleId === item.id && styles.choiceActive]}>
              <Text style={[styles.choiceText, vehicleId === item.id && styles.choiceTextActive]}>{item.registrationNumber}</Text>
            </Pressable>)}
          </View>

          <Text style={styles.fieldLabel}>TAŠKŲ SKAIČIUS</Text>
          <View style={styles.choices} testID="loading-preview-stop-count">
            {STOP_COUNTS.map((count) => <Pressable
              key={count}
              accessibilityRole="button"
              accessibilityState={{ selected: stopCount === count }}
              onPress={() => setStopCount(count)}
              style={[styles.choice, stopCount === count && styles.choiceActive]}>
              <Text style={[styles.choiceText, stopCount === count && styles.choiceTextActive]}>{count}</Text>
            </Pressable>)}
            <TextInput
              accessibilityLabel="Kitas taškų skaičius"
              keyboardType="number-pad"
              onChangeText={(value) => { const parsed = Number(value); if (Number.isFinite(parsed) && parsed > 0) setStopCount(Math.min(30, Math.round(parsed))); }}
              placeholder="Kita"
              style={styles.customCountInput}
              value={STOP_COUNTS.includes(stopCount as typeof STOP_COUNTS[number]) ? '' : String(stopCount)}
            />
          </View>

          <Pressable accessibilityRole="button" onPress={() => setHeavyEveryOther((value) => !value)} style={[styles.choice, heavyEveryOther && styles.choiceActive]}>
            <Text style={[styles.choiceText, heavyEveryOther && styles.choiceTextActive]}>{heavyEveryOther ? 'Kas antras taškas sunkus (paletė)' : 'Visi taškai lengvi'}</Text>
          </Pressable>
        </View>

        {vehicle ? <LoadingSchemaCard schema={schema} cargoLayout={cargoLayout} /> : <Text style={styles.meta}>Pasirinkite automobilį.</Text>}
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  panel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.sm },
  fieldLabel: { ...type.label, color: colors.textMuted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  choiceActive: { backgroundColor: colors.info, borderColor: colors.info },
  choiceText: { ...type.secondaryStrong, color: colors.text },
  choiceTextActive: { color: colors.textInverse },
  customCountInput: { minHeight: 44, minWidth: 80, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, ...type.bodyStrong, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
});
