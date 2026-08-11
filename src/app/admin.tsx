import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { assignRouteToDriver } from '@/application/auth/route-assignment-sync';
import { LocalAccessService } from '@/application/auth/local-access';
import { useLocalAccess } from '@/application/auth/local-access-context';
import {
  DRIVER_PERMISSION_KEYS,
  DRIVER_PERMISSION_LABELS,
  normalizeDriverPermissions,
  roleLabel,
  type DriverPermissionKey,
} from '@/application/auth/employee-permissions';
import { FoundationScreen } from '@/components/foundation-screen';
import {
  employeeApi,
  loginEmployee,
  type EmployeeProfile,
  type EmployeeRole,
  type ServerRouteAssignment,
} from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type Counts = { routes: number; activeRoutes: number; completedRoutes: number; stops: number };
type RouteChoice = { id: string; date: string; status: string; total_stops: number };

export default function AdminScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { username, profile, online, logout } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const localAccess = useMemo(() => new LocalAccessService(db), [db]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [users, setUsers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [routes, setRoutes] = useState<RouteChoice[]>([]);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState<EmployeeRole>('driver');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [routeCount, active, completed, stops, localRoutes] = await Promise.all([
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM routes'),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM routes WHERE status NOT IN ('completed','cancelled')"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM routes WHERE status = 'completed'"),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM delivery_stops'),
      db.getAllAsync<RouteChoice>("SELECT id, date, status, total_stops FROM routes WHERE status NOT IN ('completed','cancelled') ORDER BY created_at DESC"),
    ]);
    setCounts({
      routes: routeCount?.count ?? 0,
      activeRoutes: active?.count ?? 0,
      completedRoutes: completed?.count ?? 0,
      stops: stops?.count ?? 0,
    });
    setRoutes(localRoutes);
    if (profile.role === 'admin' && online) {
      const [userResponse, assignmentResponse] = await Promise.all([
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      ]);
      setUsers(userResponse.users);
      setAssignments(assignmentResponse.assignments);
    }
  }, [db, online, profile.role]);

  useEffect(() => { void load().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Duomenų nuskaityti nepavyko.')); }, [load]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await action(); } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Veiksmas nepavyko.');
    } finally { setBusy(false); }
  };

  const createEmployee = () => run(async () => {
    await employeeApi('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username: newUsername, displayName: newName, pin: newPin, role: newRole }),
    });
    setNewName(''); setNewUsername(''); setNewPin(''); setNewRole('driver');
    setMessage('Darbuotojo paskyra sukurta.');
    await load();
  });

  const toggleEmployee = (employee: EmployeeProfile) => run(async () => {
    await employeeApi(`/api/admin/users/${encodeURIComponent(employee.id)}`, {
      method: 'PATCH', body: JSON.stringify({ disabled: !employee.disabled }),
    });
    setMessage(employee.disabled ? 'Darbuotojo paskyra įjungta.' : 'Darbuotojo paskyra išjungta.');
    await load();
  });

  const togglePermission = (employee: EmployeeProfile, key: DriverPermissionKey) => run(async () => {
    const permissions = normalizeDriverPermissions(employee.permissions);
    await employeeApi(`/api/admin/users/${encodeURIComponent(employee.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ permissions: { ...permissions, [key]: !permissions[key] } }),
    });
    setMessage('Vairuotojo leidimai atnaujinti.');
    await load();
  });

  const assignRoute = () => run(async () => {
    if (!selectedDriverId || !selectedRouteId) throw new Error('Pasirinkite vairuotoją ir maršrutą.');
    await assignRouteToDriver(db, selectedRouteId, selectedDriverId);
    setSelectedDriverId(''); setSelectedRouteId('');
    setMessage('Maršrutas priskirtas vairuotojui. Jis bus parsiųstas prisijungus telefone.');
    await load();
  });

  const changePin = () => run(async () => {
    if (nextPin !== confirmPin) throw new Error('Naujo PIN pakartojimas nesutampa.');
    await employeeApi(`/api/admin/users/${encodeURIComponent(profile.id)}`, {
      method: 'PATCH', body: JSON.stringify({ pin: nextPin }),
    });
    await loginEmployee(username, nextPin);
    await localAccess.changePin(currentPin, nextPin);
    setCurrentPin(''); setNextPin(''); setConfirmPin('');
    setMessage('PIN pakeistas. Kituose įrenginiuose reikės prisijungti iš naujo.');
  });

  const input = (value: string, setter: (value: string) => void, placeholder: string, secure = false) => (
    <TextInput value={value} onChangeText={setter} secureTextEntry={secure} keyboardType={secure ? 'number-pad' : 'default'}
      autoCapitalize="none" placeholder={placeholder} placeholderTextColor={colors.textMuted} style={styles.input} />
  );

  const goHome = () => router.replace('/' as Href);

  return (
    <>
      <Stack.Screen options={{
        gestureEnabled: false, headerBackVisible: false,
        headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžios meniu</Text></Pressable>,
        headerRight: () => null,
      }} />
      <FoundationScreen showFoundationNotice={false} title="Administratoriaus panelė" description="Darbuotojai, rolės ir maršrutų priskyrimai.">
        <View style={styles.card} testID="admin-account-summary">
          <Text style={styles.title}>{profile.displayName}</Text>
          <Text style={styles.username}>@{username} · {roleLabel(profile.role)}</Text>
          <Text style={styles.meta}>{online ? 'Serveris pasiekiamas ✓' : 'Veikiama neprisijungus · valdymo pakeitimai negalimi'}</Text>
        </View>

        <View style={styles.metrics}>
          <Metric label="Maršrutai" value={counts?.routes} styles={styles} />
          <Metric label="Aktyvūs" value={counts?.activeRoutes} styles={styles} />
          <Metric label="Užbaigti" value={counts?.completedRoutes} styles={styles} />
          <Metric label="Taškai" value={counts?.stops} styles={styles} />
        </View>

        {profile.role === 'admin' ? <>
          <View style={styles.card} testID="employee-create-form">
            <Text style={styles.title}>Naujas darbuotojas</Text>
            {input(newName, setNewName, 'Vardas ir pavardė')}
            {input(newUsername, setNewUsername, 'Prisijungimo vardas')}
            {input(newPin, (value) => setNewPin(value.replace(/\D/g, '').slice(0, 8)), '6–8 skaitmenų pradinis PIN', true)}
            <View style={styles.choiceRow}>{(['driver', 'dispatcher'] as EmployeeRole[]).map((role) =>
              <Pressable key={role} onPress={() => setNewRole(role)} style={[styles.choice, newRole === role && styles.choiceActive]}>
                <Text style={[styles.choiceText, newRole === role && styles.choiceTextActive]}>{roleLabel(role)}</Text>
              </Pressable>)}</View>
            <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void createEmployee()}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Sukurti darbuotoją</Text>}
            </Pressable>
          </View>

          <View style={styles.card} testID="employee-list">
            <Text style={styles.title}>Darbuotojai</Text>
            {users.map((employee) => <View key={employee.id} style={styles.employeeBlock}>
              <View style={styles.listRow}>
                <View style={styles.listContent}><Text style={styles.listTitle}>{employee.displayName}</Text><Text style={styles.meta}>@{employee.username} · {roleLabel(employee.role)}{employee.disabled ? ' · Išjungta' : ''}</Text></View>
                {employee.id !== profile.id ? <Pressable onPress={() => void toggleEmployee(employee)} style={styles.smallButton}><Text style={styles.smallButtonText}>{employee.disabled ? 'Įjungti' : 'Išjungti'}</Text></Pressable> : null}
              </View>
              {employee.role === 'driver' ? <View style={styles.permissions}>
                <Text style={styles.sectionLabel}>Vairuotojo leidimai</Text>
                {DRIVER_PERMISSION_KEYS.map((key) => {
                  const enabled = normalizeDriverPermissions(employee.permissions)[key];
                  const copy = DRIVER_PERMISSION_LABELS[key];
                  return <Pressable key={key} onPress={() => void togglePermission(employee, key)} style={styles.permissionRow} testID={`permission-${employee.id}-${key}`}>
                    <View style={styles.permissionCopy}><Text style={styles.permissionTitle}>{copy.title}</Text><Text style={styles.permissionDescription}>{copy.description}</Text></View>
                    <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}><View style={[styles.switchThumb, enabled && styles.switchThumbOn]} /></View>
                  </Pressable>;
                })}
              </View> : null}
            </View>)}
          </View>

          <View style={styles.card} testID="route-assignment-form">
            <Text style={styles.title}>Priskirti maršrutą vairuotojui</Text>
            <Text style={styles.sectionLabel}>1. Vairuotojas</Text>
            <View style={styles.choiceColumn}>{users.filter((item) => item.role === 'driver' && !item.disabled).map((driver) =>
              <Pressable key={driver.id} onPress={() => setSelectedDriverId(driver.id)} style={[styles.selection, selectedDriverId === driver.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{driver.displayName}</Text><Text style={styles.meta}>@{driver.username}</Text>
              </Pressable>)}</View>
            <Text style={styles.sectionLabel}>2. Maršrutas šiame įrenginyje</Text>
            <View style={styles.choiceColumn}>{routes.map((route) =>
              <Pressable key={route.id} onPress={() => setSelectedRouteId(route.id)} style={[styles.selection, selectedRouteId === route.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{route.date} · {route.total_stops} tašk.</Text><Text style={styles.meta}>{route.status}</Text>
              </Pressable>)}</View>
            <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void assignRoute()}>
              <Text style={styles.primaryText}>Priskirti maršrutą</Text>
            </Pressable>
            {assignments.length ? <Text style={styles.meta}>Serverio priskyrimų: {assignments.length}</Text> : null}
          </View>
        </> : <View style={styles.card}><Text style={styles.title}>Administratoriaus teisės reikalingos</Text><Text style={styles.meta}>Darbuotojų valdymą mato tik administratorius.</Text></View>}

        <View style={styles.card}>
          <Text style={styles.title}>Keisti savo PIN</Text>
          {input(currentPin, (value) => setCurrentPin(value.replace(/\D/g, '').slice(0, 8)), 'Dabartinis PIN', true)}
          {input(nextPin, (value) => setNextPin(value.replace(/\D/g, '').slice(0, 8)), 'Naujas 6–8 skaitmenų PIN', true)}
          {input(confirmPin, (value) => setConfirmPin(value.replace(/\D/g, '').slice(0, 8)), 'Pakartokite naują PIN', true)}
          <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void changePin()}><Text style={styles.primaryText}>Pakeisti PIN</Text></Pressable>
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={() => router.push('/dispatcher' as Href)}><Text style={styles.primaryText}>Atidaryti dispečerio skydelį</Text></Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.push('/settings' as Href)}><Text style={styles.secondaryText}>Nustatymai ir atsarginė kopija</Text></Pressable>
        <Pressable style={styles.lockButton} onPress={() => { void logout(); }}><Text style={styles.lockText}>Atsijungti</Text></Pressable>
      </FoundationScreen>
    </>
  );
}

function Metric({ label, value, styles }: { label: string; value: number | undefined; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value ?? '–'}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  title: { ...type.sectionTitle, color: colors.text },
  username: { ...type.sectionTitle, color: colors.info },
  meta: { ...type.secondary, color: colors.textMuted },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: '46%', flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, alignItems: 'center' },
  metricValue: { ...type.readout, color: colors.info },
  metricLabel: { ...type.secondaryStrong, color: colors.textMuted },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSubtle, color: colors.text, ...type.body },
  primaryButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...type.button, color: colors.textSecondary },
  lockButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  lockText: { ...type.button, color: colors.textInverse },
  message: { ...type.bodyStrong, color: colors.text, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft },
  disabled: { opacity: 0.5 },
  headerAction: { minWidth: 170, minHeight: 48, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.textInverse },
  choiceRow: { flexDirection: 'row', gap: spacing.sm },
  choiceColumn: { gap: spacing.xs },
  choice: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  choiceText: { ...type.secondaryStrong, color: colors.text },
  choiceTextActive: { color: colors.textInverse },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  employeeBlock: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  listContent: { flex: 1, minWidth: 0 },
  listTitle: { ...type.cardTitle, color: colors.text },
  smallButton: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  smallButtonText: { ...type.secondaryStrong, color: colors.text },
  selection: { padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  selectionActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  sectionLabel: { ...type.label, color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.xs },
  permissions: { gap: spacing.xs, paddingLeft: spacing.sm },
  permissionRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  permissionCopy: { flex: 1, minWidth: 0 },
  permissionTitle: { ...type.bodyStrong, color: colors.text },
  permissionDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  switchTrack: { width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: colors.border },
  switchTrackOn: { backgroundColor: colors.success },
  switchThumb: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: colors.textInverse },
  switchThumbOn: { alignSelf: 'flex-end' },
});
