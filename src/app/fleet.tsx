import { Stack, useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function FleetScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const canManageVehicles = profile.role === 'admin' || permissions.canManageVehicles;
  const open = (href: Href) => router.push(href);

  return <>
    <Stack.Screen options={{ title: 'Automobiliai' }} />
    <FoundationScreen
      contentMaxWidth={900}
      description={canManageVehicles ? 'Vieno automobilio terminai, techniniai duomenys, kilometražas ir kuras — viename modulyje.' : 'Redagavimo teisė nesuteikta — parametrus matote tik peržiūrai.'}
      showFoundationNotice={false}
      title="Automobiliai">
      <View style={styles.cards} testID="fleet-hub-menu">
        <FleetCard
          description="TA, kelių mokestis, servisas — datos ir neskubūs gedimai kiekvienam automobiliui."
          icon="service"
          onPress={() => open({ pathname: '/vehicle', params: { returnTo: 'fleet' } } as Href)}
          styles={styles}
          testID="fleet-open-terminai"
          title="Terminai" />
        <FleetCard
          description="Numeris, modelis, bakas, PLL talpa, matmenys ir kuro norma."
          icon="vehicles"
          onPress={() => open({ pathname: '/admin', params: { section: 'fleet', returnTo: 'fleet' } } as Href)}
          styles={styles}
          testID="fleet-open-technical"
          title="Techniniai duomenys" />
        <FleetCard
          description="Odometro įvedimas per kelionės lapą ir nuvažiuotų kilometrų statistika."
          icon="statistics"
          onPress={() => open({ pathname: '/statistics', params: { returnTo: 'fleet' } } as Href)}
          styles={styles}
          testID="fleet-open-km"
          title="Kilometražas" />
        <FleetCard
          description="Kuro likučio patvirtinimai, korekcijos ir pylimų taisyklės."
          icon="trip-sheet"
          onPress={() => open({ pathname: '/admin', params: { section: 'fleet', returnTo: 'fleet' } } as Href)}
          styles={styles}
          testID="fleet-open-fuel"
          title="Kuras" />
      </View>
    </FoundationScreen>
  </>;
}

function FleetCard({ title, description, icon, onPress, testID, styles }: {
  title: string;
  description: string;
  icon: Parameters<typeof MenuArtwork>[0]['kind'];
  onPress: () => void;
  testID: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} testID={testID}>
    <View style={styles.cardIcon}><MenuArtwork kind={icon} size={48} /></View>
    <View style={styles.cardCopy}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDescription}>{description}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  cards: { gap: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 84, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  cardPressed: { opacity: 0.88 },
  cardIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { ...type.sectionTitle, color: colors.text, fontSize: 17 },
  cardDescription: { ...type.secondary, color: colors.textMuted },
  chevron: { fontSize: 22, color: colors.textMuted },
});
