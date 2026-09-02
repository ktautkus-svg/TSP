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

export default function FinanceHubScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageFinancials);
  const open = (href: Href) => router.push(href);

  if (!allowed) return null;

  return <>
    <Stack.Screen options={{ title: 'Finansai' }} />
    <FoundationScreen
      contentMaxWidth={900}
      description="Pasirinkite, ką norite peržiūrėti: vairuotojų atlygį, reiso savikainą ar skaičiuoklę."
      showFoundationNotice={false}
      title="Finansai">
      <View style={styles.cards} testID="finance-hub-menu">
        <FinanceCard
          description="Kuro sąnaudos ir apskaičiuotas atlygis kiekvienam vairuotojui pagal kelionės lapus."
          icon="finance"
          onPress={() => open({ pathname: '/finance/wages', params: { returnTo: 'finance' } } as unknown as Href)}
          styles={styles}
          testID="finance-open-wages"
          title="Darbuotojų atlygis" />
        <FinanceCard
          description="Kiekvieno reiso savikaina: kuras, kelių mokestis, draudimas ir vairuotojo dalis. Preliminarinė arba galutinė."
          icon="statistics"
          onPress={() => open({ pathname: '/finance/route-price', params: { returnTo: 'finance' } } as unknown as Href)}
          styles={styles}
          testID="finance-open-route-price"
          title="Reiso kaina" />
        <FinanceCard
          description="Greitas preliminarus reiso kainos ir kintamo atlygio skaičiavimas be kelionės lapo."
          icon="finance"
          onPress={() => open({ pathname: '/finance/calculator', params: { returnTo: 'finance' } } as unknown as Href)}
          styles={styles}
          testID="finance-open-calculator"
          title="Skaičiuoklė" />
      </View>
    </FoundationScreen>
  </>;
}

function FinanceCard({ title, description, icon, onPress, testID, styles }: {
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
