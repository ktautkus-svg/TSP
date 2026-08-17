import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { assignRouteToDriver } from '@/application/auth/route-assignment-sync';
import { markRouteDeletedForCloud } from '@/application/sync/route-cloud-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import { LocalAccessService } from '@/application/auth/local-access';
import { useLocalAccess } from '@/application/auth/local-access-context';
import {
  DRIVER_PERMISSION_KEYS,
  DRIVER_PERMISSION_LABELS,
  MANAGEMENT_PERMISSION_KEYS,
  MANAGEMENT_PERMISSION_LABELS,
  normalizeEmployeePermissions,
  normalizeDriverPermissions,
  roleLabel,
  type EmployeePermissionKey,
} from '@/application/auth/employee-permissions';
import { FoundationScreen } from '@/components/foundation-screen';
import { Alert } from '@/ui/alert';
import {
  employeeApi,
  loginEmployee,
  type EmployeeProfile,
  type EmployeeRole,
  type FuelReport,
  type ServerFleetVehicle,
  type ServerRouteAssignment,
} from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type Counts = { routes: number; activeRoutes: number; completedRoutes: number; stops: number };
type RouteChoice = { id: string; date: string; status: string; total_stops: number };

export default function AdminScreen() {
  const router = useRouter();
  const { section: requestedSection } = useLocalSearchParams<{ section?: string }>();
  const db = useSQLiteContext();
  const { username, profile, online, logout } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const desktop = width >= 1100;
  const tablet = width >= 720;
  const localAccess = useMemo(() => new LocalAccessService(db), [db]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [users, setUsers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [fuelReports, setFuelReports] = useState<FuelReport[]>([]);
  const [routes, setRoutes] = useState<RouteChoice[]>([]);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<EmployeeRole>('driver');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [editEmployeeUsername, setEditEmployeeUsername] = useState('');
  const [editEmployeeName, setEditEmployeeName] = useState('');
  const [editEmployeeRole, setEditEmployeeRole] = useState<EmployeeRole>('driver');
  const [editEmployeePin, setEditEmployeePin] = useState('');
  const [editEmployeeEmail, setEditEmployeeEmail] = useState('');
  const [editEmployeePhone, setEditEmployeePhone] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedAssignmentVehicleId, setSelectedAssignmentVehicleId] = useState('');
  const [assignmentPicker, setAssignmentPicker] = useState<'driver' | 'vehicle' | 'route' | null>(null);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [newVehiclePayload, setNewVehiclePayload] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedVehicleDriverId, setSelectedVehicleDriverId] = useState('');
  const [editVehicleNumber, setEditVehicleNumber] = useState('');
  const [editVehicleModel, setEditVehicleModel] = useState('');
  const [editVehiclePayload, setEditVehiclePayload] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const focus = requestedSection === 'employees' || requestedSection === 'fleet' ? requestedSection : null;
  const currentPermissions = normalizeEmployeePermissions(profile.permissions);
  const canManageEmployees = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageEmployees);
  const canManageVehicles = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageVehicles);
  const canManageFinancials = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageFinancials);
  const canOpenWorkspace = focus === 'employees' ? canManageEmployees : focus === 'fleet' ? canManageVehicles : profile.role === 'admin';

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
    if (['admin', 'dispatcher'].includes(profile.role) && online) {
      const [userResponse, assignmentResponse, vehicleResponse, fuelResponse] = await Promise.all([
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
        employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
        profile.role === 'admin'
          ? employeeApi<{ reports: FuelReport[] }>('/api/admin/fuel-reports')
          : Promise.resolve({ reports: [] as FuelReport[] }),
      ]);
      setUsers(userResponse.users);
      setAssignments(assignmentResponse.assignments);
      setVehicles(vehicleResponse.vehicles);
      setFuelReports(fuelResponse.reports);
    }
  }, [db, online, profile.role]);

  useEffect(() => { void load().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Duomenų nuskaityti nepavyko.')); }, [load]);
  useEffect(() => {
    if (focus) setExpandedSection(focus);
  }, [focus]);

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
      body: JSON.stringify({ username: newUsername, displayName: newName, pin: newPin, role: newRole, email: newEmail, phone: newPhone }),
    });
    setNewName(''); setNewUsername(''); setNewPin(''); setNewEmail(''); setNewPhone(''); setNewRole('driver');
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

  const togglePermission = (employee: EmployeeProfile, key: EmployeePermissionKey) => run(async () => {
    const permissions = normalizeEmployeePermissions(employee.permissions);
    await employeeApi(`/api/admin/users/${encodeURIComponent(employee.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ permissions: { ...permissions, [key]: !permissions[key] } }),
    });
    setMessage('Vairuotojo leidimai atnaujinti.');
    await load();
  });

  const assignRoute = () => run(async () => {
    if (!selectedDriverId || !selectedRouteId || !selectedAssignmentVehicleId) throw new Error('Pasirinkite vairuotoją, automobilį ir maršrutą.');
    await assignRouteToDriver(db, selectedRouteId, selectedDriverId, selectedAssignmentVehicleId);
    setSelectedDriverId(''); setSelectedRouteId(''); setSelectedAssignmentVehicleId('');
    setMessage('Maršrutas priskirtas vairuotojui. Jis bus parsiųstas prisijungus telefone.');
    await load();
  });

  const cancelRoute = (route: RouteChoice) => {
    Alert.alert('Atšaukti maršrutą?', 'Maršrutas nebesimatys kaip aktyvus ir neblokuos naujo maršruto kūrimo.', [
      { text: 'Ne', style: 'cancel' },
      { text: 'Atšaukti', style: 'destructive', onPress: () => { void run(async () => {
        const linked = assignments.filter((assignment) => assignment.routeId === route.id && !['completed', 'cancelled'].includes(assignment.status));
        for (const assignment of linked) {
          await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}/cancel`, { method: 'POST' });
        }
        await new CancelDraftRoute(db).execute(route.id);
        await requestSync('mutation');
        setSelectedRouteId((current) => current === route.id ? '' : current);
        setMessage('Maršrutas atšauktas.');
        await load();
      }); } },
    ]);
  };

  const deleteRoute = (route: RouteChoice) => {
    Alert.alert('Ištrinti maršrutą?', 'Bus pašalintas maršrutas, jo priskyrimai ir bandomieji rezultatai. Veiksmo atšaukti negalima.', [
      { text: 'Ne', style: 'cancel' },
      { text: 'Ištrinti', style: 'destructive', onPress: () => { void run(async () => {
        const linked = assignments.filter((assignment) => assignment.routeId === route.id);
        for (const assignment of linked) {
          await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}`, { method: 'DELETE' });
        }
        await new CancelDraftRoute(db).execute(route.id);
        await markRouteDeletedForCloud(db, route.id);
        await requestSync('mutation');
        setSelectedRouteId((current) => current === route.id ? '' : current);
        setMessage('Maršrutas ištrintas.');
        await load();
      }); } },
    ]);
  };

  const cancelServerAssignment = (assignment: ServerRouteAssignment) => run(async () => {
    await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}/cancel`, { method: 'POST' });
    const local = routes.find((route) => route.id === assignment.routeId);
    if (local) {
      await new CancelDraftRoute(db).execute(local.id);
      await requestSync('mutation');
    }
    setMessage('Vairuotojo maršrutas atšauktas.');
    await load();
  });

  const deleteServerAssignment = (assignment: ServerRouteAssignment) => run(async () => {
    await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}`, { method: 'DELETE' });
    const local = routes.find((route) => route.id === assignment.routeId);
    if (local) {
      await new CancelDraftRoute(db).execute(local.id);
      await markRouteDeletedForCloud(db, local.id);
      await requestSync('mutation');
    }
    setMessage('Priskyrimas ir maršrutas ištrinti.');
    await load();
  });

  const selectEmployee = (employee: EmployeeProfile) => {
    setSelectedEmployeeId(employee.id);
    setEditEmployeeUsername(employee.username);
    setEditEmployeeName(employee.displayName);
    setEditEmployeeRole(employee.role);
    setEditEmployeePin('');
    setEditEmployeeEmail(employee.email ?? '');
    setEditEmployeePhone(employee.phone ?? '');
  };

  const saveEmployee = () => run(async () => {
    if (!selectedEmployeeId) throw new Error('Pasirinkite darbuotoją.');
    const patch: Record<string, unknown> = {
      username: editEmployeeUsername,
      displayName: editEmployeeName,
      email: editEmployeeEmail,
      phone: editEmployeePhone,
    };
    if (profile.role === 'admin') patch.role = editEmployeeRole;
    if (editEmployeePin.trim()) patch.pin = editEmployeePin;
    await employeeApi(`/api/admin/users/${encodeURIComponent(selectedEmployeeId)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    setEditEmployeePin('');
    setSelectedEmployeeId('');
    setMessage('Darbuotojo duomenys ir prisijungimo vardas atnaujinti.');
    await load();
  });

  const createVehicle = () => run(async () => {
    const maximumPayloadKg = Number(newVehiclePayload.replace(',', '.'));
    if (!newVehicleNumber.trim() || !newVehicleModel.trim() || !Number.isFinite(maximumPayloadKg)) {
      throw new Error('Įveskite automobilio numerį, modelį ir maksimalų krovinio svorį.');
    }
    await employeeApi('/api/admin/vehicles', {
      method: 'POST',
      body: JSON.stringify({ registrationNumber: newVehicleNumber, model: newVehicleModel, maximumPayloadKg }),
    });
    setNewVehicleNumber(''); setNewVehicleModel(''); setNewVehiclePayload('');
    setMessage('Automobilis įtrauktas į parką.');
    await load();
  });

  const assignVehicle = () => run(async () => {
    if (!selectedVehicleId) throw new Error('Pasirinkite automobilį.');
    await employeeApi(`/api/admin/vehicles/${encodeURIComponent(selectedVehicleId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignedDriverId: selectedVehicleDriverId || null }),
    });
    setMessage(selectedVehicleDriverId ? 'Automobilis priskirtas vairuotojui.' : 'Automobilio priskyrimas panaikintas.');
    await load();
  });

  const selectVehicle = (vehicle: ServerFleetVehicle) => {
    setSelectedVehicleId(vehicle.id);
    setSelectedVehicleDriverId(vehicle.assignedDriverId ?? '');
    setEditVehicleNumber(vehicle.registrationNumber);
    setEditVehicleModel(vehicle.model);
    setEditVehiclePayload(String(vehicle.maximumPayloadKg));
  };

  const saveVehicle = () => run(async () => {
    if (!selectedVehicleId) throw new Error('Pasirinkite automobilį.');
    const maximumPayloadKg = Number(editVehiclePayload.replace(',', '.'));
    if (!editVehicleNumber.trim() || !editVehicleModel.trim() || !Number.isFinite(maximumPayloadKg)) {
      throw new Error('Įveskite automobilio numerį, modelį ir maksimalų krovinio svorį.');
    }
    const response = await employeeApi<{ vehicle: ServerFleetVehicle }>(`/api/admin/vehicles/${encodeURIComponent(selectedVehicleId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        registrationNumber: editVehicleNumber,
        model: editVehicleModel,
        maximumPayloadKg,
      }),
    });
    setSelectedVehicleId(response.vehicle.id);
    setEditVehicleNumber(response.vehicle.registrationNumber);
    setMessage('Automobilio duomenys atnaujinti.');
    await load();
  });

  const reviewFuel = (report: FuelReport, approve: boolean) => run(async () => {
    await employeeApi(`/api/admin/fuel-reports/${encodeURIComponent(report.id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
    setMessage(approve ? 'Kuro likučio pakeitimas patvirtintas.' : 'Kuro likučio pakeitimas atmestas; vairuotojas turės patvirtinti iš naujo.');
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

  const toggleSection = (section: string) => setExpandedSection((current) => current === section ? null : section);
  const editableUsers = profile.role === 'admin' ? users : users.filter((employee) => employee.role === 'driver');
  const employeeGroups = groupEmployeesByRole(editableUsers);
  const selectedEmployee = editableUsers.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedAssignmentDriver = users.find((employee) => employee.id === selectedDriverId) ?? null;
  const selectedAssignmentVehicle = vehicles.find((vehicle) => vehicle.id === selectedAssignmentVehicleId) ?? null;
  const selectedAssignmentRoute = routes.find((route) => route.id === selectedRouteId) ?? null;

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <FoundationScreen
        contentMaxWidth={focus ? 900 : desktop ? 1440 : tablet ? 980 : undefined}
        showFoundationNotice={false}
        title={focus === 'employees' ? 'Vairuotojai ir darbuotojai' : focus === 'fleet' ? 'Automobiliai' : 'Administratoriaus panelė'}
        description={focus === 'employees' ? 'Redaguokite darbuotojo duomenis, PIN ir vairuotojo leidimus.' : focus === 'fleet' ? 'Redaguokite automobilio numerį, modelį, keliamąją galią ir priskyrimą.' : 'Darbuotojai, automobiliai ir maršrutų priskyrimai.'}>
        {!focus ? <View style={styles.card} testID="admin-account-summary">
          <Text style={styles.title}>{profile.displayName}</Text>
          <Text style={styles.username}>@{username} · {roleLabel(profile.role)}</Text>
          <Text style={styles.meta}>{online ? 'Serveris pasiekiamas ✓' : 'Veikiama neprisijungus · valdymo pakeitimai negalimi'}</Text>
        </View> : null}

        {!focus ? <View style={styles.metrics}>
          <Metric label="Maršrutai" value={counts?.routes} styles={styles} />
          <Metric label="Aktyvūs" value={counts?.activeRoutes} styles={styles} />
          <Metric label="Užbaigti" value={counts?.completedRoutes} styles={styles} />
          <Metric label="Taškai" value={counts?.stops} styles={styles} />
        </View> : null}

        {canOpenWorkspace ? <View style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          <View style={[styles.column, (focus === 'fleet' || !canManageEmployees) && styles.hidden]}>
          <View style={styles.card} testID="employee-create-form">
            <CollapsibleHeader title="Naujas darbuotojas" expanded={expandedSection === 'employee-create'} onPress={() => toggleSection('employee-create')} styles={styles} />
            {expandedSection === 'employee-create' ? <>
            {input(newName, setNewName, 'Vardas ir pavardė')}
            {input(newUsername, setNewUsername, 'Prisijungimo vardas')}
            <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={newEmail} onChangeText={setNewEmail} placeholder="El. paštas (nebūtina)" placeholderTextColor={colors.textMuted} style={styles.input} />
            <TextInput autoComplete="tel" keyboardType="phone-pad" value={newPhone} onChangeText={setNewPhone} placeholder="Telefonas (nebūtina)" placeholderTextColor={colors.textMuted} style={styles.input} />
            {input(newPin, (value) => setNewPin(value.replace(/\D/g, '').slice(0, 8)), '4–8 skaitmenų pradinis PIN', true)}
            {profile.role === 'admin' ? <View style={styles.choiceRow}>{(['driver', 'dispatcher', 'quality'] as EmployeeRole[]).map((role) =>
              <Pressable key={role} onPress={() => setNewRole(role)} style={[styles.choice, newRole === role && styles.choiceActive]}>
                <Text style={[styles.choiceText, newRole === role && styles.choiceTextActive]}>{roleLabel(role)}</Text>
              </Pressable>)}</View> : null}
            <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void createEmployee()}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Sukurti darbuotoją</Text>}
            </Pressable>
            </> : null}
          </View>

          <View style={styles.card} testID="employee-list">
            <CollapsibleHeader title={`${profile.role === 'admin' ? 'Vairuotojai ir darbuotojai' : 'Vairuotojai'} (${editableUsers.length})`} expanded={expandedSection === 'employees'} onPress={() => toggleSection('employees')} styles={styles} />
            {expandedSection === 'employees' ? <>
            {employeeGroups.map((group) => <View key={group.role} style={styles.employeeGroup} testID={`employee-group-${group.role}`}>
              <View style={styles.employeeGroupHeader}><Text style={styles.employeeGroupTitle}>{group.title}</Text><Text style={styles.employeeGroupCount}>{group.employees.length}</Text></View>
              {group.employees.map((employee) => <View key={employee.id} style={styles.listRow}>
                <View style={styles.listContent}><Text style={styles.listTitle}>{employee.displayName}</Text><Text style={styles.meta}>@{employee.username}{employee.disabled ? ' · Išjungta' : ''}</Text>{employee.email || employee.phone ? <Text style={styles.meta}>{[employee.email, employee.phone].filter(Boolean).join(' · ')}</Text> : null}</View>
                <View style={styles.rowActions}>
                  <Pressable accessibilityLabel={`Redaguoti ${employee.displayName}`} accessibilityRole="button" onPress={() => selectEmployee(employee)} style={styles.smallButton}><Text style={styles.smallButtonText}>Redaguoti</Text></Pressable>
                  {employee.id !== profile.id ? <Pressable accessibilityLabel={`${employee.disabled ? 'Įjungti' : 'Išjungti'} ${employee.displayName}`} accessibilityRole="button" onPress={() => void toggleEmployee(employee)} style={styles.smallButton}><Text style={styles.smallButtonText}>{employee.disabled ? 'Įjungti' : 'Išjungti'}</Text></Pressable> : null}
                </View>
              </View>)}
            </View>)}
            </> : null}
          </View>

          </View>
          <View style={[styles.column, (focus === 'employees' || (focus === 'fleet' && !canManageVehicles)) && styles.hidden]}>
          <View style={[styles.card, Boolean(focus) && styles.hidden]} testID="route-assignment-form">
            <CollapsibleHeader title="Priskirti maršrutą vairuotojui" expanded={expandedSection === 'route-assignment'} onPress={() => toggleSection('route-assignment')} styles={styles} />
            {expandedSection === 'route-assignment' ? <>
            <Text style={styles.sectionLabel}>1. Vairuotojas</Text>
            <Pressable onPress={() => setAssignmentPicker((current) => current === 'driver' ? null : 'driver')} style={styles.pickerSummary}>
              <View style={styles.listContent}><Text style={styles.listTitle}>{selectedAssignmentDriver?.displayName ?? 'Pasirinkti vairuotoją'}</Text>{selectedAssignmentDriver ? <Text style={styles.meta}>@{selectedAssignmentDriver.username}</Text> : null}</View><Text style={styles.pickerChevron}>{assignmentPicker === 'driver' ? '−' : '+'}</Text>
            </Pressable>
            {assignmentPicker === 'driver' ? <View style={styles.choiceColumn}>{users.filter((item) => item.role === 'driver' && !item.disabled).map((driver) =>
              <Pressable key={driver.id} onPress={() => { setSelectedDriverId(driver.id); const assigned = vehicles.find((vehicle) => vehicle.assignedDriverId === driver.id); if (assigned) setSelectedAssignmentVehicleId(assigned.id); setAssignmentPicker(null); }} style={[styles.selection, selectedDriverId === driver.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{driver.displayName}</Text><Text style={styles.meta}>@{driver.username}</Text>
              </Pressable>)}</View> : null}
            <Text style={styles.sectionLabel}>2. Automobilis</Text>
            <Pressable onPress={() => setAssignmentPicker((current) => current === 'vehicle' ? null : 'vehicle')} style={styles.pickerSummary}>
              <View style={styles.listContent}><Text style={styles.listTitle}>{selectedAssignmentVehicle ? `${selectedAssignmentVehicle.registrationNumber} · ${selectedAssignmentVehicle.model}` : 'Pasirinkti automobilį'}</Text>{selectedAssignmentVehicle ? <Text style={styles.meta}>iki {selectedAssignmentVehicle.maximumPayloadKg} kg</Text> : null}</View><Text style={styles.pickerChevron}>{assignmentPicker === 'vehicle' ? '−' : '+'}</Text>
            </Pressable>
            {assignmentPicker === 'vehicle' ? <View style={styles.choiceColumn}>{vehicles.map((vehicle) =>
              <Pressable key={vehicle.id} onPress={() => { setSelectedAssignmentVehicleId(vehicle.id); setAssignmentPicker(null); }} style={[styles.selection, selectedAssignmentVehicleId === vehicle.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text><Text style={styles.meta}>iki {vehicle.maximumPayloadKg} kg</Text>
              </Pressable>)}</View> : null}
            <Text style={styles.sectionLabel}>3. Maršrutas šiame įrenginyje</Text>
            <Pressable onPress={() => setAssignmentPicker((current) => current === 'route' ? null : 'route')} style={styles.pickerSummary}>
              <View style={styles.listContent}><Text style={styles.listTitle}>{selectedAssignmentRoute ? `${selectedAssignmentRoute.date} · ${selectedAssignmentRoute.total_stops} tašk.` : 'Pasirinkti maršrutą'}</Text></View><Text style={styles.pickerChevron}>{assignmentPicker === 'route' ? '−' : '+'}</Text>
            </Pressable>
            {assignmentPicker === 'route' ? <View style={styles.choiceColumn}>{routes.filter((route) => route.status === 'planned').map((route) =>
              <Pressable key={route.id} onPress={() => { setSelectedRouteId(route.id); setAssignmentPicker(null); }} style={[styles.selection, selectedRouteId === route.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{route.date} · {route.total_stops} tašk.</Text><Text style={styles.meta}>{route.status}</Text>
              </Pressable>)}</View> : null}
            <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void assignRoute()}>
              <Text style={styles.primaryText}>Priskirti maršrutą</Text>
            </Pressable>
            {assignments.filter((assignment) => !['completed', 'cancelled'].includes(assignment.status)).map((assignment) => (
              <View key={assignment.id} style={styles.routeManagementRow}>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{assignment.driverName}</Text>
                  <Text style={styles.meta}>{String(assignment.routeSnapshot.route.date ?? '')} · {assignment.status}</Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable disabled={busy || !online} onPress={() => void cancelServerAssignment(assignment)} style={styles.smallButton}><Text style={styles.smallButtonText}>Atšaukti</Text></Pressable>
                  <Pressable disabled={busy || !online} onPress={() => void deleteServerAssignment(assignment)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Ištrinti</Text></Pressable>
                </View>
              </View>
            ))}
            </> : null}
          </View>

          <View style={[styles.card, Boolean(focus) && styles.hidden]} testID="route-management">
            <CollapsibleHeader title={`Aktyvių maršrutų valdymas (${routes.length})`} expanded={expandedSection === 'route-management'} onPress={() => toggleSection('route-management')} styles={styles} />
            {expandedSection === 'route-management' ? <>
            <Text style={styles.meta}>Atšaukite arba visam laikui ištrinkite kabantį maršrutą prieš kurdami naują.</Text>
            {routes.length === 0 ? <Text style={styles.meta}>Aktyvių maršrutų nėra.</Text> : routes.map((route) => (
              <View key={route.id} style={styles.routeManagementRow}>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{route.date} · {route.total_stops} tašk.</Text>
                  <Text style={styles.meta}>{route.status}</Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable disabled={busy || !online} onPress={() => cancelRoute(route)} style={styles.smallButton}><Text style={styles.smallButtonText}>Atšaukti</Text></Pressable>
                  <Pressable disabled={busy || !online} onPress={() => deleteRoute(route)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Ištrinti</Text></Pressable>
                </View>
              </View>
            ))}
            </> : null}
          </View>

          <View style={[styles.card, (focus === 'employees' || !canManageVehicles) && styles.hidden]} testID="fleet-vehicle-management">
            <CollapsibleHeader title={`Automobilių parkas (${vehicles.length})`} expanded={expandedSection === 'fleet'} onPress={() => toggleSection('fleet')} styles={styles} />
            {expandedSection === 'fleet' ? <>
            <Text style={styles.meta}>Maksimalus svoris rodo leistiną krovinio svorį. Miestas automobiliams nesaugomas.</Text>
            <View style={styles.vehicleList}>
              {vehicles.map((vehicle) => {
                const driver = users.find((item) => item.id === vehicle.assignedDriverId);
                return <View key={vehicle.id} style={styles.employeeBlock}>
                <View style={[styles.selection, selectedVehicleId === vehicle.id && styles.selectionActive]}>
                  <View style={styles.listRowCompact}>
                    <View style={styles.listContent}>
                      <Text style={styles.listTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text>
                      <Text style={styles.meta}>{vehicle.maximumPayloadKg} kg · {driver ? driver.displayName : 'Nepriskirtas'}</Text>
                    </View>
                    <Pressable accessibilityLabel={`Redaguoti automobilį ${vehicle.registrationNumber}`} accessibilityRole="button" onPress={() => selectVehicle(vehicle)} style={styles.smallButton}><Text style={styles.smallButtonText}>Redaguoti</Text></Pressable>
                  </View>
                </View>
                {selectedVehicleId === vehicle.id ? <View style={styles.editor} testID="vehicle-edit-form">
              <View style={styles.editorHeading}>
                <View style={styles.listContent}><Text style={styles.title}>Redaguoti automobilį</Text><Text style={styles.meta}>Numeris, modelis ir maksimali krovinio masė.</Text></View>
                <Pressable accessibilityLabel="Uždaryti automobilio redagavimą" accessibilityRole="button" onPress={() => setSelectedVehicleId('')} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable>
              </View>
              {input(editVehicleNumber, (value) => setEditVehicleNumber(value.toUpperCase().replace(/\s/g, '').slice(0, 12)), 'Valstybinis numeris')}
              {input(editVehicleModel, setEditVehicleModel, 'Modelis')}
              <TextInput accessibilityLabel="Maksimalus krovinio svoris" value={editVehiclePayload} onChangeText={(value) => setEditVehiclePayload(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                keyboardType="decimal-pad" placeholder="Maksimalus krovinio svoris, kg" placeholderTextColor={colors.textMuted} style={styles.input} />
              {canManageFinancials ? <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'admin' } } as unknown as Href)} style={styles.smallButton}><Text style={styles.smallButtonText}>Keisti kuro normą, draudimą ir kelių mokestį →</Text></Pressable> : null}
              <Pressable accessibilityLabel="Išsaugoti automobilio pakeitimus" accessibilityRole="button" disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void saveVehicle()}><Text style={styles.primaryText}>Išsaugoti automobilį</Text></Pressable>
              <Text style={styles.sectionLabel}>Priskirti vairuotojui</Text>
              <View style={styles.choiceColumn}>
                <Pressable onPress={() => setSelectedVehicleDriverId('')} style={[styles.selection, selectedVehicleDriverId === '' && styles.selectionActive]}>
                  <Text style={styles.listTitle}>Nepriskirtas</Text>
                </Pressable>
                {users.filter((item) => item.role === 'driver' && !item.disabled).map((driver) =>
                  <Pressable key={driver.id} onPress={() => setSelectedVehicleDriverId(driver.id)} style={[styles.selection, selectedVehicleDriverId === driver.id && styles.selectionActive]}>
                    <Text style={styles.listTitle}>{driver.displayName}</Text><Text style={styles.meta}>@{driver.username}</Text>
                  </Pressable>)}
              </View>
              <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void assignVehicle()}>
                <Text style={styles.primaryText}>Patvirtinti priskyrimą</Text>
              </Pressable>
                </View> : null}
                </View>;
              })}
            </View>

            <Text style={styles.sectionLabel}>Pridėti automobilį</Text>
            {input(newVehicleNumber, (value) => setNewVehicleNumber(value.toUpperCase().replace(/\s/g, '').slice(0, 12)), 'Valstybinis numeris')}
            {input(newVehicleModel, setNewVehicleModel, 'Modelis')}
            <TextInput value={newVehiclePayload} onChangeText={(value) => setNewVehiclePayload(value.replace(/[^\d.,]/g, '').slice(0, 8))}
              keyboardType="decimal-pad" placeholder="Maksimalus krovinio svoris, kg" placeholderTextColor={colors.textMuted} style={styles.input} />
            <Pressable disabled={busy || !online} style={[styles.secondaryButton, (busy || !online) && styles.disabled]} onPress={() => void createVehicle()}>
              <Text style={styles.secondaryText}>Pridėti automobilį</Text>
            </Pressable>

            </> : null}
          </View>

          <View style={[styles.card, Boolean(focus) && styles.hidden]} testID="fuel-report-management">
            <CollapsibleHeader title={`Kuro likučio pakeitimai (${fuelReports.filter((report) => report.status === 'pending').length})`} expanded={expandedSection === 'fuel-reports'} onPress={() => toggleSection('fuel-reports')} styles={styles} />
            {expandedSection === 'fuel-reports' ? <>
              <Text style={styles.meta}>Pirmasis automobilio kuro likutis priimamas automatiškai. Vėlesnį neatitikimą patvirtina administratorius.</Text>
              {fuelReports.filter((report) => report.status === 'pending').length === 0 ? <Text style={styles.meta}>Laukiančių pakeitimų nėra.</Text> : null}
              {fuelReports.filter((report) => report.status === 'pending').map((report) => <View key={report.id} style={styles.routeManagementRow}>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{report.driverName} · {report.registrationNumber}</Text>
                  <Text style={styles.meta}>{report.previousLiters === null ? 'Pirmas likutis' : `${report.previousLiters} l`} → {report.reportedLiters} l</Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable disabled={busy || !online} onPress={() => void reviewFuel(report, true)} style={styles.smallButton}><Text style={styles.smallButtonText}>Patvirtinti</Text></Pressable>
                  <Pressable disabled={busy || !online} onPress={() => void reviewFuel(report, false)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Atmesti</Text></Pressable>
                </View>
              </View>)}
            </> : null}
          </View>
          </View>
        </View> : <View style={styles.card}><Text style={styles.title}>Teisė nesuteikta</Text><Text style={styles.meta}>Šios valdymo dalies teisę dispečeriui gali suteikti administratorius.</Text></View>}

        {!focus ? <View style={styles.card}>
          <CollapsibleHeader title="Keisti savo PIN" expanded={expandedSection === 'pin'} onPress={() => toggleSection('pin')} styles={styles} />
          {expandedSection === 'pin' ? <>
          {input(currentPin, (value) => setCurrentPin(value.replace(/\D/g, '').slice(0, 8)), 'Dabartinis PIN', true)}
          {input(nextPin, (value) => setNextPin(value.replace(/\D/g, '').slice(0, 8)), 'Naujas 4–8 skaitmenų PIN', true)}
          {input(confirmPin, (value) => setConfirmPin(value.replace(/\D/g, '').slice(0, 8)), 'Pakartokite naują PIN', true)}
          <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void changePin()}><Text style={styles.primaryText}>Pakeisti PIN</Text></Pressable>
          </> : null}
        </View> : null}

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {focus ? <Pressable style={styles.secondaryButton} onPress={() => router.replace('/settings' as Href)}><Text style={styles.secondaryText}>Grįžti į nustatymus</Text></Pressable> : <>
          <Pressable style={styles.primaryButton} onPress={() => router.push('/dispatcher' as Href)}><Text style={styles.primaryText}>Atidaryti dispečerio skydelį</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/settings' as Href)}><Text style={styles.secondaryText}>Nustatymai ir atsarginė kopija</Text></Pressable>
          <Pressable style={styles.lockButton} onPress={() => { void logout(); }}><Text style={styles.lockText}>Atsijungti</Text></Pressable>
        </>}
      </FoundationScreen>
      <Modal animationType="fade" transparent visible={Boolean(selectedEmployee)} onRequestClose={() => setSelectedEmployeeId('')}>
        <View style={styles.modalBackdrop}>
          <View style={styles.employeeModal} testID="employee-edit-form">
            <View style={styles.editorHeading}>
              <View style={styles.listContent}><Text style={styles.title}>Redaguoti darbuotoją</Text><Text style={styles.meta}>{selectedEmployee?.displayName} · {selectedEmployee ? roleLabel(selectedEmployee.role) : ''}</Text></View>
              <Pressable accessibilityLabel="Uždaryti darbuotojo redagavimą" accessibilityRole="button" onPress={() => setSelectedEmployeeId('')} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.employeeModalContent} showsVerticalScrollIndicator>
              <Text style={styles.meta}>Keičiant prisijungimo vardą būtina įvesti PIN. Kituose įrenginiuose reikės prisijungti iš naujo.</Text>
              {input(editEmployeeUsername, setEditEmployeeUsername, 'Prisijungimo vardas')}
              {input(editEmployeeName, setEditEmployeeName, 'Vardas ir pavardė')}
              <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={editEmployeeEmail} onChangeText={setEditEmployeeEmail} placeholder="El. paštas" placeholderTextColor={colors.textMuted} style={styles.input} />
              <TextInput autoComplete="tel" keyboardType="phone-pad" value={editEmployeePhone} onChangeText={setEditEmployeePhone} placeholder="Telefonas" placeholderTextColor={colors.textMuted} style={styles.input} />
              {profile.role === 'admin' ? <View style={styles.choiceRow}>{(['driver', 'dispatcher', 'quality'] as EmployeeRole[]).map((role) =>
                <Pressable accessibilityLabel={`Rolė ${roleLabel(role)}`} accessibilityRole="radio" accessibilityState={{ checked: editEmployeeRole === role }} key={role} onPress={() => setEditEmployeeRole(role)} style={[styles.choice, editEmployeeRole === role && styles.choiceActive]}>
                  <Text style={[styles.choiceText, editEmployeeRole === role && styles.choiceTextActive]}>{roleLabel(role)}</Text>
                </Pressable>)}</View> : null}
              {input(editEmployeePin, (value) => setEditEmployeePin(value.replace(/\D/g, '').slice(0, 8)), 'Naujas PIN (nebūtina)', true)}
              {profile.role === 'admin' && selectedEmployee && editEmployeeRole === 'driver' ? <View style={styles.permissions}>
                <Text style={styles.sectionLabel}>Vairuotojo leidimai</Text>
                {DRIVER_PERMISSION_KEYS.map((key) => {
                  const enabled = normalizeDriverPermissions(selectedEmployee.permissions)[key];
                  const copy = DRIVER_PERMISSION_LABELS[key];
                  return <Pressable key={key} onPress={() => void togglePermission(selectedEmployee, key)} style={styles.permissionRow} testID={`permission-${selectedEmployee.id}-${key}`}>
                    <View style={styles.permissionCopy}><Text style={styles.permissionTitle}>{copy.title}</Text><Text style={styles.permissionDescription}>{copy.description}</Text></View>
                    <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}><View style={[styles.switchThumb, enabled && styles.switchThumbOn]} /></View>
                  </Pressable>;
                })}
              </View> : null}
              {profile.role === 'admin' && selectedEmployee && editEmployeeRole === 'dispatcher' ? <View style={styles.permissions}>
                <Text style={styles.sectionLabel}>Dispečerio valdymo teisės</Text>
                {MANAGEMENT_PERMISSION_KEYS.map((key) => {
                  const enabled = normalizeEmployeePermissions(selectedEmployee.permissions)[key];
                  const copy = MANAGEMENT_PERMISSION_LABELS[key];
                  return <Pressable key={key} onPress={() => void togglePermission(selectedEmployee, key)} style={styles.permissionRow} testID={`permission-${selectedEmployee.id}-${key}`}>
                    <View style={styles.permissionCopy}><Text style={styles.permissionTitle}>{copy.title}</Text><Text style={styles.permissionDescription}>{copy.description}</Text></View>
                    <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}><View style={[styles.switchThumb, enabled && styles.switchThumbOn]} /></View>
                  </Pressable>;
                })}
              </View> : null}
              {canManageFinancials && editEmployeeRole === 'driver' ? <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'admin' } } as unknown as Href)} style={styles.smallButton}><Text style={styles.smallButtonText}>Keisti atlygio skaičiavimą →</Text></Pressable> : null}
            </ScrollView>
            <View style={styles.employeeModalActions}>
              <Pressable onPress={() => setSelectedEmployeeId('')} style={[styles.secondaryButton, styles.modalActionButton]}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
              <Pressable accessibilityLabel="Išsaugoti darbuotojo pakeitimus" accessibilityRole="button" disabled={busy || !online} onPress={() => void saveEmployee()} style={[styles.primaryButton, styles.modalActionButton, (busy || !online) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Išsaugoti darbuotoją</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function groupEmployeesByRole(employees: EmployeeProfile[]): Array<{ role: EmployeeRole; title: string; employees: EmployeeProfile[] }> {
  const groups: Array<{ role: EmployeeRole; title: string }> = [
    { role: 'driver', title: 'Vairuotojai' },
    { role: 'dispatcher', title: 'Dispečeriai' },
    { role: 'quality', title: 'Kokybės kontrolė' },
    { role: 'admin', title: 'Administracija' },
  ];
  return groups
    .map((group) => ({ ...group, employees: employees.filter((employee) => employee.role === group.role) }))
    .filter((group) => group.employees.length > 0);
}

function Metric({ label, value, styles }: { label: string; value: number | undefined; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value ?? '–'}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function CollapsibleHeader({ title, expanded, onPress, styles }: {
  title: string;
  expanded: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={styles.sectionHeader}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.sectionChevron}>{expanded ? '−' : '+'}</Text>
  </Pressable>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  workspace: { gap: spacing.lg },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  employeeModal: { width: '100%', maxWidth: 680, maxHeight: '88%', padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md },
  employeeModalContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  employeeModalActions: { flexDirection: 'row', gap: spacing.sm },
  modalActionButton: { flex: 1, paddingHorizontal: spacing.md },
  workspaceDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0, gap: spacing.lg },
  hidden: { display: 'none' },
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  title: { ...type.sectionTitle, color: colors.text },
  sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sectionChevron: { ...type.pageTitle, color: colors.info, fontSize: 26, lineHeight: 30 },
  username: { ...type.sectionTitle, color: colors.info },
  meta: { ...type.secondary, color: colors.textMuted },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 150, flexBasis: 150, flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, alignItems: 'center' },
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
  headerText: { ...type.button, color: colors.brandNavy },
  choiceRow: { flexDirection: 'row', gap: spacing.sm },
  choiceColumn: { gap: spacing.xs },
  choice: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  choiceText: { ...type.secondaryStrong, color: colors.text },
  choiceTextActive: { color: colors.textInverse },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  listRowCompact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vehicleList: { gap: spacing.xs },
  employeeGroup: { gap: spacing.xs, paddingTop: spacing.sm },
  employeeGroupHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  employeeGroupTitle: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  employeeGroupCount: { minWidth: 28, textAlign: 'center', paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.infoSoft, ...type.meta, color: colors.info },
  employeeBlock: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  listContent: { flex: 1, minWidth: 0 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs },
  routeManagementRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  listTitle: { ...type.cardTitle, color: colors.text },
  smallButton: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  smallButtonText: { ...type.secondaryStrong, color: colors.text },
  dangerButton: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, justifyContent: 'center' },
  dangerButtonText: { ...type.secondaryStrong, color: colors.danger },
  selection: { padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  selectionActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  pickerSummary: { minHeight: 54, padding: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerChevron: { ...type.sectionTitle, color: colors.info, fontSize: 24 },
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
  editor: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, gap: spacing.sm },
  editorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  closeButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  closeButtonText: { ...type.sectionTitle, color: colors.textSecondary, fontSize: 24 },
});
