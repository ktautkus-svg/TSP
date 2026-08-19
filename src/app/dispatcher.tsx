import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { ChevronRightIcon, ExcelIcon, EmployeesIcon, PencilIcon, RouteIcon, SettingsIcon, TripSheetIcon, VehicleIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { GroupedMenuRow, GroupedMenuSection } from '@/components/grouped-menu';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function DispatcherHomeScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = width < 720;
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const canManageEmployees = profile.role === 'admin' || permissions.canManageEmployees;
  const canManageVehicles = profile.role === 'admin' || permissions.canManageVehicles;
  const canManageFinancials = profile.role === 'admin' || permissions.canManageFinancials;
  const open = (href: Href) => router.push(href);

  return <>
    <Stack.Screen options={{ title: 'Dispečerio skydelis' }} />
    <FoundationScreen
      contentMaxWidth={1180}
      description="Pasirinkite, ką norite atlikti. Kiekviena užduotis atidaroma atskirame aiškiame lange."
      showFoundationNotice={false}
      title="Dispečerio skydelis">
      <View style={styles.identity}>
        <View><Text style={styles.eyebrow}>PRISIJUNGĘS DARBUOTOJAS</Text><Text style={styles.identityName}>{profile.displayName}</Text></View>
        <Text style={styles.identityRole}>{profile.role === 'admin' ? 'Administratorius' : 'Dispečeris'}</Text>
      </View>

      <View style={[styles.menuSections, compact && styles.menuSectionsCompact]} testID="dispatcher-home-menu">
        <View style={styles.primaryActions} testID="dispatcher-primary-actions">
          <Pressable
            accessibilityRole="button"
            onPress={() => open('/import' as Href)}
            style={({ pressed }) => [styles.featuredPrimary, pressed && styles.featuredPressed]}
            testID="dispatcher-create-route">
            <View style={styles.featuredIconPrimary}><RouteIcon color={colors.textInverse} size={26} /></View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredEyebrowPrimary}>PAGRINDINIS VEIKSMAS</Text>
              <Text style={styles.featuredTitlePrimary}>Kurti maršrutą</Text>
              <Text style={styles.featuredDescriptionPrimary}>Importuoti failą, įvesti adresus ir suplanuoti naują darbą.</Text>
            </View>
            <ChevronRightIcon color={colors.textInverse} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => open('/route-management' as Href)}
            style={({ pressed }) => [styles.featuredSecondary, pressed && styles.featuredPressed]}
            testID="dispatcher-edit-routes">
            <View style={styles.featuredIconSecondary}><PencilIcon color={colors.info} size={24} /></View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredEyebrowSecondary}>DARBO VALDYMAS</Text>
              <Text style={styles.featuredTitleSecondary}>Redaguoti ir priskirti</Text>
              <Text style={styles.featuredDescriptionSecondary}>Peržiūrėti, keisti eiliškumą, priskirti vairuotojui arba užbaigti kabantį maršrutą.</Text>
            </View>
            <ChevronRightIcon color={colors.info} size={22} />
          </Pressable>
        </View>
        <View style={styles.menuGroup}><GroupedMenuSection label="IŠTEKLIAI">
          <GroupedMenuRow description={canManageEmployees ? 'Duomenys, prisijungimai ir leidimai.' : 'Redagavimo teisė nesuteikta.'} disabled={!canManageEmployees} icon={<EmployeesIcon color={colors.info} size={23} />} onPress={() => open({ pathname: '/admin', params: { section: 'employees', returnTo: 'dispatcher' } } as Href)} title="Vairuotojai" />
          <GroupedMenuRow description={canManageVehicles ? 'Numeriai, modeliai ir keliamoji galia.' : 'Redagavimo teisė nesuteikta.'} disabled={!canManageVehicles} icon={<VehicleIcon color={colors.textSecondary} size={23} />} onPress={() => open({ pathname: '/admin', params: { section: 'fleet', returnTo: 'dispatcher' } } as Href)} title="Automobiliai" tone="neutral" />
        </GroupedMenuSection></View>
        <View style={styles.menuGroup}><GroupedMenuSection label="APSKAITA">
          <GroupedMenuRow description={canManageFinancials ? 'Kuras, draudimas, mokesčiai ir atlygis.' : 'Parametrai tik peržiūrai.'} icon={<SettingsIcon color={colors.textSecondary} size={23} />} onPress={() => open({ pathname: '/financial-settings', params: { returnTo: 'dispatcher' } } as unknown as Href)} title="Finansiniai duomenys" tone="neutral" />
          <GroupedMenuRow description="Odometrai, kilometrai, kuro norma ir spausdinimas." icon={<TripSheetIcon color={colors.textSecondary} size={23} />} onPress={() => open({ pathname: '/trip-sheet', params: { returnTo: 'dispatcher' } } as Href)} title="Kelionės lapai" tone="neutral" />
        </GroupedMenuSection></View>
      </View>

      <View style={styles.importNote}>
        <ExcelIcon size={22} color={colors.success} />
        <Text style={styles.importNoteText}>Maršrutų importavimo, optimizavimo ir rankinio eiliškumo funkcijos išlieka tos pačios.</Text>
      </View>
    </FoundationScreen>
  </>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  identity: { minHeight: 72, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  eyebrow: { ...type.label, color: colors.textMuted },
  identityName: { ...type.sectionTitle, color: colors.text, marginTop: 2 },
  identityRole: { ...type.secondaryStrong, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, overflow: 'hidden' },
  menuSections: { gap: spacing.lg },
  menuSectionsCompact: { flexDirection: 'column' },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  featuredPrimary: { flexGrow: 1, flexBasis: 320, minHeight: 118, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.actionPrimary, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featuredSecondary: { flexGrow: 1, flexBasis: 320, minHeight: 118, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.info, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featuredPressed: { opacity: 0.92 },
  featuredIconPrimary: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimaryPressed },
  featuredIconSecondary: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft },
  featuredCopy: { flex: 1, minWidth: 0, gap: 3 },
  featuredEyebrowPrimary: { ...type.label, color: colors.textInverse },
  featuredTitlePrimary: { ...type.sectionTitle, color: colors.textInverse, fontSize: 20, lineHeight: 24 },
  featuredDescriptionPrimary: { ...type.secondary, color: colors.textInverse },
  featuredEyebrowSecondary: { ...type.label, color: colors.info },
  featuredTitleSecondary: { ...type.sectionTitle, color: colors.text, fontSize: 20, lineHeight: 24 },
  featuredDescriptionSecondary: { ...type.secondary, color: colors.textSecondary },
  menuGroup: { minWidth: 0, width: '100%' },
  importNote: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importNoteText: { ...type.secondary, color: colors.textSecondary, flex: 1 },
});
