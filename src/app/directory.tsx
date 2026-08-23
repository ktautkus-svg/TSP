import { Stack, useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function DirectoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const open = (href: Href) => router.push(href);

  return <>
    <Stack.Screen options={{ title: 'Kontaktai' }} />
    <FoundationScreen
      contentMaxWidth={900}
      description="Klientai ir administracijos kontaktai — viename modulyje."
      showFoundationNotice={false}
      title="Kontaktai">
      <View style={styles.cards} testID="directory-hub-menu">
        <DirectoryCard
          description="Sukaupti gavėjai, adresai ir trūkstami kontaktai iš maršrutų."
          icon="clients"
          onPress={() => open({ pathname: '/clients', params: { returnTo: 'directory' } } as unknown as Href)}
          styles={styles}
          testID="directory-open-clients"
          title="Klientai" />
        <DirectoryCard
          description="Administracija, kritiniai numeriai ir skambinimas iš maršruto."
          icon="navigation"
          onPress={() => open({ pathname: '/contacts', params: { returnTo: 'directory' } } as unknown as Href)}
          styles={styles}
          testID="directory-open-contacts"
          title="Administracija ir ryšys" />
      </View>
    </FoundationScreen>
  </>;
}

function DirectoryCard({ title, description, icon, onPress, testID, styles }: {
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
