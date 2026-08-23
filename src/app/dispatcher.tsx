import { Stack, useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { ChevronRightIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { GroupedMenuRow, GroupedMenuSection } from '@/components/grouped-menu';
import { MenuArtwork } from '@/components/menu-artwork';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

export default function DispatcherHomeScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = width < 720;
  const open = (href: Href) => router.push(href);

  return <>
    <Stack.Screen options={{ title: 'Dispečerio skydelis' }} />
    <FoundationScreen
      contentMaxWidth={1180}
      description=""
      showHeading={false}
      showFoundationNotice={false}
      title="Dispečerio skydelis">
      <View style={styles.identity}>
        <View style={styles.identityAccent} />
        <View style={styles.identityBody}><Text style={styles.eyebrow}>PRISIJUNGĘS DARBUOTOJAS</Text><Text style={styles.identityName}>{profile.displayName}</Text></View>
        <Text style={styles.identityRole}>{profile.role === 'admin' ? 'Administratorius' : 'Dispečeris'}</Text>
      </View>

      <View style={[styles.menuSections, compact && styles.menuSectionsCompact]} testID="dispatcher-home-menu">
        <View style={styles.primaryActions} testID="dispatcher-primary-actions">
          <Pressable
            accessibilityRole="button"
            onPress={() => open('/import' as Href)}
            style={({ pressed }) => [styles.featuredPrimary, pressed && styles.featuredPressed]}
            testID="dispatcher-create-route">
            <View style={styles.featuredIconPrimary}><MenuArtwork kind="route" size={52} /></View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredTitlePrimary}>Kurti maršrutą</Text>
              <Text style={styles.featuredDescriptionPrimary}>Importas, adresai, naujas darbas.</Text>
            </View>
            <ChevronRightIcon color={colors.textInverse} size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => open('/route-management' as Href)}
            style={({ pressed }) => [styles.featuredSecondary, pressed && styles.featuredPressed]}
            testID="dispatcher-edit-routes">
            <View style={styles.featuredIconSecondary}><MenuArtwork kind="edit" size={52} /></View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredTitleSecondary}>Redaguoti ir priskirti</Text>
              <Text style={styles.featuredDescriptionSecondary}>Eiliškumas, priskyrimas, užbaigimas.</Text>
            </View>
            <ChevronRightIcon color={colors.info} size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => open('/execute-route' as Href)}
            style={({ pressed }) => [styles.featuredSecondary, pressed && styles.featuredPressed]}
            testID="dispatcher-execute-route">
            <View style={styles.featuredIconSecondary}><MenuArtwork kind="execute" size={52} /></View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredTitleSecondary}>Vykdyti maršrutą</Text>
              <Text style={styles.featuredDescriptionSecondary}>Pasirinkti vairuotoją ir tęsti jo darbą.</Text>
            </View>
            <ChevronRightIcon color={colors.info} size={20} />
          </Pressable>
        </View>
        <View style={styles.menuGroup}><GroupedMenuSection label="APSKAITA">
          <GroupedMenuRow description="Odometrai, kilometrai, kuro norma ir spausdinimas." icon={<MenuArtwork kind="trip-sheet" />} onPress={() => open({ pathname: '/trip-sheet', params: { returnTo: 'dispatcher' } } as Href)} title="Kelionės lapai" tone="neutral" />
          <GroupedMenuRow description="Kilometrai, taškai, svoris, atlygis ir kokybė pagal laikotarpį." icon={<MenuArtwork kind="statistics" />} onPress={() => open({ pathname: '/statistics', params: { returnTo: 'dispatcher' } } as Href)} title="Statistika" tone="info" />
        </GroupedMenuSection></View>
      </View>
    </FoundationScreen>
  </>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  identity: { minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md, overflow: 'hidden' },
  identityAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.accent },
  identityBody: { flex: 1, minWidth: 0, marginLeft: spacing.xs },
  eyebrow: { ...type.label, color: colors.textMuted },
  identityName: { ...type.sectionTitle, color: colors.text, marginTop: 2, fontSize: 19, fontWeight: '700' },
  identityRole: { ...type.secondaryStrong, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, overflow: 'hidden' },
  menuSections: { gap: spacing.lg },
  menuSectionsCompact: { flexDirection: 'column' },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  featuredPrimary: { flexGrow: 1, flexBasis: 260, minHeight: 86, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.actionPrimary, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featuredSecondary: { flexGrow: 1, flexBasis: 260, minHeight: 86, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.info, flexDirection: 'row', alignItems: 'center', gap: spacing.md, shadowColor: '#101828', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  featuredPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  featuredIconPrimary: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  featuredIconSecondary: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  featuredCopy: { flex: 1, minWidth: 0, gap: 1 },
  featuredTitlePrimary: { ...type.sectionTitle, color: colors.textInverse, fontSize: 17, lineHeight: 21 },
  featuredDescriptionPrimary: { ...type.secondary, color: colors.borderStrong },
  featuredTitleSecondary: { ...type.sectionTitle, color: colors.text, fontSize: 17, lineHeight: 21 },
  featuredDescriptionSecondary: { ...type.secondary, color: colors.textSecondary },
  menuGroup: { minWidth: 0, width: '100%' },
});
