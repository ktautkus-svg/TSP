import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import {
  ExcelIcon,
  EmployeesIcon,
  PencilIcon,
  RouteIcon,
  SettingsIcon,
  TripSheetIcon,
  VehicleIcon,
} from '@/components/app-icons';
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
        <View style={styles.menuGroup}><GroupedMenuSection label="MARŠRUTAI">
          <GroupedMenuRow description="Importuoti failą, įvesti adresus ir suplanuoti naują darbą." icon={<RouteIcon color={colors.info} size={23} />} onPress={() => open('/import' as Href)} title="Kurti maršrutus" />
          <GroupedMenuRow description="Peržiūrėti, keisti eiliškumą ir priskirti." icon={<PencilIcon color={colors.warning} size={23} />} onPress={() => open('/route-management' as Href)} title="Redaguoti esamus" tone="warning" />
        </GroupedMenuSection></View>
        <View style={styles.menuGroup}><GroupedMenuSection label="IŠTEKLIAI">
          <GroupedMenuRow description={canManageEmployees ? 'Duomenys, prisijungimai ir leidimai.' : 'Redagavimo teisė nesuteikta.'} disabled={!canManageEmployees} icon={<EmployeesIcon color={colors.info} size={23} />} onPress={() => open({ pathname: '/admin', params: { section: 'employees', returnTo: 'dispatcher' } } as Href)} title="Vairuotojai" />
          <GroupedMenuRow description={canManageVehicles ? 'Numeriai, modeliai ir keliamoji galia.' : 'Redagavimo teisė nesuteikta.'} disabled={!canManageVehicles} icon={<VehicleIcon color={colors.success} size={23} />} onPress={() => open({ pathname: '/admin', params: { section: 'fleet', returnTo: 'dispatcher' } } as Href)} title="Automobiliai" tone="success" />
        </GroupedMenuSection></View>
        <View style={styles.menuGroup}><GroupedMenuSection label="APSKAITA">
          <GroupedMenuRow description={canManageFinancials ? 'Kuras, draudimas, mokesčiai ir atlygis.' : 'Parametrai tik peržiūrai.'} icon={<SettingsIcon color={colors.warning} size={23} />} onPress={() => open({ pathname: '/financial-settings', params: { returnTo: 'dispatcher' } } as unknown as Href)} title="Finansiniai duomenys" tone="warning" />
          <GroupedMenuRow description="Odometrai, kilometrai, kuro norma ir spausdinimas." icon={<TripSheetIcon color={colors.success} size={23} />} onPress={() => open({ pathname: '/trip-sheet', params: { returnTo: 'dispatcher' } } as Href)} title="Kelionės lapai" tone="success" />
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
  identity: { minHeight: 72, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  eyebrow: { ...type.label, color: colors.textMuted },
  identityName: { ...type.sectionTitle, color: colors.text, marginTop: 2 },
  identityRole: { ...type.secondaryStrong, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, overflow: 'hidden' },
  menuSections: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md },
  menuSectionsCompact: { flexDirection: 'column' },
  menuGroup: { flexGrow: 1, flexBasis: 330, minWidth: 0, width: '100%' },
  importNote: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importNoteText: { ...type.secondary, color: colors.textSecondary, flex: 1 },
});
