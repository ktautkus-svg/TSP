import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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

      <View style={[styles.menuGrid, compact && styles.menuGridCompact]} testID="dispatcher-home-menu">
        <MenuCard description="Importuoti failą, įvesti adresus ir suplanuoti naują darbą." icon={<RouteIcon color={colors.info} size={26} />} label="Kurti maršrutus" onPress={() => open('/import' as Href)} styles={styles} tone="blue" />
        <MenuCard description="Peržiūrėti sukurtus maršrutus, keisti eiliškumą ir priskirti." icon={<PencilIcon color={colors.warning} size={26} />} label="Redaguoti esamus" onPress={() => open('/route-management' as Href)} styles={styles} tone="amber" />
        <MenuCard description={canManageVehicles ? 'Kurti automobilius, keisti jų duomenis ir priskyrimą.' : 'Automobilių redagavimo teisė nesuteikta.'} disabled={!canManageVehicles} icon={<VehicleIcon color={colors.success} size={26} />} label="Redaguoti automobilius" onPress={() => open({ pathname: '/admin', params: { section: 'fleet' } } as Href)} styles={styles} tone="green" />
        <MenuCard description={canManageEmployees ? 'Kurti vairuotojus, keisti prisijungimus ir duomenis.' : 'Vairuotojų redagavimo teisė nesuteikta.'} disabled={!canManageEmployees} icon={<EmployeesIcon color={colors.info} size={26} />} label="Redaguoti vairuotojus" onPress={() => open({ pathname: '/admin', params: { section: 'employees' } } as Href)} styles={styles} tone="blue" />
        <MenuCard description={canManageFinancials ? 'Kuro kaina, draudimas, kelių mokesčiai ir atlygio skaičiavimas.' : 'Peržiūrėti finansinius parametrus be redagavimo.'} icon={<SettingsIcon color={colors.warning} size={26} />} label="Finansiniai duomenys" onPress={() => open('/financial-settings' as Href)} styles={styles} tone="amber" />
        <MenuCard description="Dienų odometrai, kilometrai, kuro norma ir spausdinimas." icon={<TripSheetIcon color={colors.success} size={26} />} label="Kelionės lapai" onPress={() => open('/trip-sheet' as Href)} styles={styles} tone="green" />
      </View>

      <View style={styles.importNote}>
        <ExcelIcon size={22} color={colors.success} />
        <Text style={styles.importNoteText}>Maršrutų importavimo, optimizavimo ir rankinio eiliškumo funkcijos išlieka tos pačios.</Text>
      </View>
    </FoundationScreen>
  </>;
}

function MenuCard({ label, description, disabled = false, icon, onPress, tone, styles }: {
  label: string;
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  onPress: () => void;
  tone: 'blue' | 'amber' | 'green';
  styles: ReturnType<typeof createStyles>;
}) {
  const toneStyle = tone === 'blue' ? styles.iconBlue : tone === 'amber' ? styles.iconAmber : styles.iconGreen;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.menuCard, disabled && styles.menuCardDisabled, pressed && styles.menuCardPressed]}>
    <View style={[styles.iconBox, toneStyle]}>{icon}</View>
    <View style={styles.menuCopy}><Text style={styles.menuTitle}>{label}</Text><Text style={styles.menuDescription}>{description}</Text></View>
    <Text style={styles.arrow}>→</Text>
  </Pressable>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  identity: { minHeight: 72, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  eyebrow: { ...type.label, color: colors.textMuted },
  identityName: { ...type.sectionTitle, color: colors.text, marginTop: 2 },
  identityRole: { ...type.secondaryStrong, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, overflow: 'hidden' },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  menuGridCompact: { flexDirection: 'column' },
  menuCard: { minWidth: 300, flexBasis: 480, flexGrow: 1, minHeight: 116, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  menuCardPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  menuCardDisabled: { opacity: 0.52 },
  iconBox: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconBlue: { backgroundColor: colors.infoSoft },
  iconAmber: { backgroundColor: colors.warningSoft },
  iconGreen: { backgroundColor: colors.accentSoft },
  menuCopy: { flex: 1, minWidth: 0, gap: 4 },
  menuTitle: { ...type.cardTitle, color: colors.text },
  menuDescription: { ...type.secondary, color: colors.textMuted },
  arrow: { ...type.sectionTitle, color: colors.textMuted },
  importNote: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importNoteText: { ...type.secondary, color: colors.textSecondary, flex: 1 },
});
