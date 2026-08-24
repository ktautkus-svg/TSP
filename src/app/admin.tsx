import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { assignRouteToDriver, completeAssignedRoute } from '@/application/auth/route-assignment-sync';
import { markRouteDeletedForCloud } from '@/application/sync/route-cloud-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import { AdminCompleteRoute } from '@/application/routes/route-workday';
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
import {
  PALLET_CAPACITIES,
  bodyKindFromPalletCapacity,
  fleetCargoSpec,
  fleetTankCapacity,
  resolveVehicleCargo,
  type PalletCapacity,
} from '@/domain/fleet-cargo-specs';
import { Alert } from '@/ui/alert';
import { describeVehicleLoad } from '@/ui/vehicle-load';
import {
  employeeApi,
  loginEmployee,
  type EmployeeProfile,
  type EmployeeRole,
  type FuelReport,
  type ServerDepartureOverride,
  type ServerFleetVehicle,
  type ServerRouteAssignment,
  type ServerVehicleFault,
} from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type Counts = { routes: number; activeRoutes: number; completedRoutes: number; stops: number };
type RouteChoice = { id: string; date: string; status: string; total_stops: number; total_weight_kg: number };

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
  const [vehicleFaults, setVehicleFaults] = useState<ServerVehicleFault[]>([]);
  const [departureOverrides, setDepartureOverrides] = useState<ServerDepartureOverride[]>([]);
  const [correctionVehicleId, setCorrectionVehicleId] = useState('');
  const [correctionLiters, setCorrectionLiters] = useState('');
  const [correctionDate, setCorrectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [correctionNote, setCorrectionNote] = useState('');
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
  // Empty pay fields mean "no agreement recorded", and the driver falls back to
  // the default rates rather than to zero.
  const [editPayType, setEditPayType] = useState<'fixed' | 'variable'>('variable');
  const [editPayDaily, setEditPayDaily] = useState('');
  const [editPayPerKm, setEditPayPerKm] = useState('');
  const [editPayPerKg, setEditPayPerKg] = useState('');
  const [editPayPerStop, setEditPayPerStop] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedAssignmentVehicleId, setSelectedAssignmentVehicleId] = useState('');
  const [assignmentPicker, setAssignmentPicker] = useState<'driver' | 'vehicle' | 'route' | null>(null);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [newVehiclePayload, setNewVehiclePayload] = useState('');
  const [newVehicleNorm, setNewVehicleNorm] = useState('');
  const [newVehicleTank, setNewVehicleTank] = useState('');
  const [newVehiclePallets, setNewVehiclePallets] = useState<PalletCapacity>(5);
  const [newVehicleSideDoor, setNewVehicleSideDoor] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedVehicleDriverId, setSelectedVehicleDriverId] = useState('');
  const [editVehicleNumber, setEditVehicleNumber] = useState('');
  const [editVehicleModel, setEditVehicleModel] = useState('');
  const [editVehiclePayload, setEditVehiclePayload] = useState('');
  const [editVehicleNorm, setEditVehicleNorm] = useState('');
  const [editVehicleTank, setEditVehicleTank] = useState('');
  const [editVehiclePallets, setEditVehiclePallets] = useState<PalletCapacity>(5);
  // Cargo floor. Both length and width are needed before the pallet drawing
  // can be shown at all; the wheel arch fields matter only for a van.
  const [editCargoLength, setEditCargoLength] = useState('');
  const [editCargoWidth, setEditCargoWidth] = useState('');
  const [editCargoBodyType, setEditCargoBodyType] = useState<'van' | 'box'>('van');
  const [editArchStart, setEditArchStart] = useState('');
  const [editArchEnd, setEditArchEnd] = useState('');
  const [editArchIntrusion, setEditArchIntrusion] = useState('');
  const [showVehicleCargoDetails, setShowVehicleCargoDetails] = useState(false);
  const [showVehicleDriverAssignment, setShowVehicleDriverAssignment] = useState(false);
  const [editVehicleSideDoor, setEditVehicleSideDoor] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const focus = requestedSection === 'employees' || requestedSection === 'fleet' || requestedSection === 'fuel-reports' ? requestedSection : null;
  const currentPermissions = normalizeEmployeePermissions(profile.permissions);
  const canManageEmployees = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageEmployees);
  const canManageVehicles = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageVehicles);
  const canManageFinancials = profile.role === 'admin' || (profile.role === 'dispatcher' && currentPermissions.canManageFinancials);
  const canOpenWorkspace = focus === 'employees' ? canManageEmployees : focus === 'fleet' ? canManageVehicles : focus === 'fuel-reports' ? canManageFinancials : profile.role === 'admin';

  const load = useCallback(async () => {
    const [routeCount, active, completed, stops, localRoutes] = await Promise.all([
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM routes'),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM routes WHERE status NOT IN ('completed','cancelled')"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM routes WHERE status = 'completed'"),
      db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM delivery_stops'),
      db.getAllAsync<RouteChoice>("SELECT id, date, status, total_stops, total_weight_kg FROM routes WHERE status NOT IN ('completed','cancelled') ORDER BY created_at DESC"),
    ]);
    setCounts({
      routes: routeCount?.count ?? 0,
      activeRoutes: active?.count ?? 0,
      completedRoutes: completed?.count ?? 0,
      stops: stops?.count ?? 0,
    });
    setRoutes(localRoutes);
    if (['admin', 'dispatcher'].includes(profile.role) && online) {
      const [userResponse, assignmentResponse, vehicleResponse, fuelResponse, faultResponse, overrideResponse] = await Promise.all([
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
        employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
        profile.role === 'admin'
          ? employeeApi<{ reports: FuelReport[] }>('/api/admin/fuel-reports')
          : Promise.resolve({ reports: [] as FuelReport[] }),
        employeeApi<{ faults: ServerVehicleFault[] }>('/api/admin/vehicle-faults').catch(() => ({ faults: [] as ServerVehicleFault[] })),
        employeeApi<{ overrides: ServerDepartureOverride[] }>('/api/admin/departure-overrides').catch(() => ({ overrides: [] as ServerDepartureOverride[] })),
      ]);
      setUsers(userResponse.users);
      setAssignments(assignmentResponse.assignments);
      setVehicles(vehicleResponse.vehicles);
      setFuelReports(fuelResponse.reports);
      setVehicleFaults(faultResponse.faults);
      setDepartureOverrides(overrideResponse.overrides);
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

  const deleteEmployee = (employee: EmployeeProfile) => {
    Alert.alert(
      'Pašalinti darbuotoją?',
      `${employee.displayName} nebegalės prisijungti. Užbaigtų maršrutų istorija liks išsaugota.`,
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Pašalinti', style: 'destructive', onPress: () => { void run(async () => {
          await employeeApi(`/api/admin/users/${encodeURIComponent(employee.id)}`, { method: 'DELETE' });
          if (selectedEmployeeId === employee.id) setSelectedEmployeeId('');
          setMessage('Darbuotojas pašalintas. Istoriniai maršrutų duomenys išsaugoti.');
          await load();
        }); } },
      ],
    );
  };

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

  const completeServerAssignment = (assignment: ServerRouteAssignment) => run(async () => {
    const local = routes.find((route) => route.id === assignment.routeId);
    await completeAssignedRoute(db, assignment, local?.id ?? null);
    await requestSync('mutation');
    setMessage('Maršrutas užbaigtas ir nebekabės kaip aktyvus priskyrimas.');
    await load();
  });

  const completeLocalRoute = (route: RouteChoice) => {
    Alert.alert('Užbaigti maršrutą?', 'Maršrutas bus pažymėtas kaip baigtas, kad nebekabėtų tarp aktyvių darbų. Nepristatyti taškai liks nepažymėti.', [
      { text: 'Ne', style: 'cancel' },
      { text: 'Užbaigti', onPress: () => { void run(async () => {
        const linked = assignments.filter((assignment) => assignment.routeId === route.id && !['completed', 'cancelled'].includes(assignment.status));
        if (linked[0]) await completeAssignedRoute(db, linked[0], route.id);
        else await new AdminCompleteRoute(db).execute(route.id);
        await requestSync('mutation');
        setSelectedRouteId((current) => current === route.id ? '' : current);
        setMessage('Maršrutas užbaigtas.');
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
    const pay = employee.compensation;
    setEditPayType(pay?.type ?? 'variable');
    setEditPayDaily(pay ? decimalInput(pay.fixedDailyNetEur) : '');
    setEditPayPerKm(pay ? decimalInput(pay.perKmEur) : '');
    setEditPayPerKg(pay ? decimalInput(pay.perKgEur) : '');
    setEditPayPerStop(pay ? decimalInput(pay.perStopEur) : '');
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
    // All four blank sends null, which clears the arrangement and returns this
    // driver to the default rates instead of paying him nothing.
    const payFields = [editPayDaily, editPayPerKm, editPayPerKg, editPayPerStop];
    patch.compensation = payFields.every((field) => !field.trim())
      ? null
      : {
        type: editPayType,
        fixedDailyNetEur: parseDecimalInput(editPayDaily),
        perKmEur: parseDecimalInput(editPayPerKm),
        perKgEur: parseDecimalInput(editPayPerKg),
        perStopEur: parseDecimalInput(editPayPerStop),
      };
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
      body: JSON.stringify({
        registrationNumber: newVehicleNumber,
        model: newVehicleModel,
        maximumPayloadKg,
        fuelNormLPer100Km: parseFuelNorm(newVehicleNorm),
        fuelTankCapacityLiters: parseFuelTankCapacity(newVehicleTank),
        palletCapacity: newVehiclePallets,
        cargoBodyKind: bodyKindFromPalletCapacity(newVehiclePallets),
        hasSideDoor: newVehicleSideDoor,
      }),
    });
    setNewVehicleNumber(''); setNewVehicleModel(''); setNewVehiclePayload(''); setNewVehicleNorm('');
    setNewVehicleTank('');
    setNewVehiclePallets(5); setNewVehicleSideDoor(false);
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
    setShowVehicleCargoDetails(false);
    setShowVehicleDriverAssignment(false);
    setSelectedVehicleDriverId(vehicle.assignedDriverId ?? '');
    setEditVehicleNumber(vehicle.registrationNumber);
    setEditVehicleModel(vehicle.model);
    setEditVehiclePayload(String(vehicle.maximumPayloadKg));
    setEditVehicleNorm(vehicle.fuelNormLPer100Km === null || vehicle.fuelNormLPer100Km === undefined
      ? ''
      : String(vehicle.fuelNormLPer100Km).replace('.', ','));
    setEditVehicleTank(formatStoredLiters(vehicle.fuelTankCapacityLiters) || formatStoredLiters(fleetTankCapacity(vehicle.registrationNumber)));
    const cargo = resolveVehicleCargo(vehicle);
    setEditVehiclePallets(cargo.palletCapacity);
    setEditVehicleSideDoor(cargo.hasSideDoor);
    setEditCargoLength(mmInput(vehicle.cargoLengthMm));
    setEditCargoWidth(mmInput(vehicle.cargoWidthMm));
    setEditCargoBodyType(vehicle.cargoBodyType === 'box' ? 'box' : 'van');
    setEditArchStart(mmInput(vehicle.wheelArchStartMm));
    setEditArchEnd(mmInput(vehicle.wheelArchEndMm));
    setEditArchIntrusion(mmInput(vehicle.wheelArchIntrusionMm));
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
        fuelNormLPer100Km: parseFuelNorm(editVehicleNorm),
        fuelTankCapacityLiters: parseFuelTankCapacity(editVehicleTank),
        palletCapacity: editVehiclePallets,
        cargoBodyKind: bodyKindFromPalletCapacity(editVehiclePallets),
        cargoLengthMm: parseMm(editCargoLength),
        cargoWidthMm: parseMm(editCargoWidth),
        cargoBodyType: editCargoBodyType,
        wheelArchStartMm: parseMm(editArchStart),
        wheelArchEndMm: parseMm(editArchEnd),
        wheelArchIntrusionMm: parseMm(editArchIntrusion),
        hasSideDoor: editVehicleSideDoor,
      }),
    });
    setSelectedVehicleId(response.vehicle.id);
    setEditVehicleNumber(response.vehicle.registrationNumber);
    setMessage('Automobilio duomenys atnaujinti.');
    await load();
  });

  const deleteVehicle = (vehicle: ServerFleetVehicle) => {
    Alert.alert(
      'Pašalinti automobilį?',
      `${vehicle.registrationNumber} · ${vehicle.model} bus pašalintas iš parko. Užbaigtuose kelionės lapuose jo duomenys liks.`,
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Pašalinti', style: 'destructive', onPress: () => { void run(async () => {
          await employeeApi(`/api/admin/vehicles/${encodeURIComponent(vehicle.id)}`, { method: 'DELETE' });
          if (selectedVehicleId === vehicle.id) setSelectedVehicleId('');
          setMessage('Automobilis pašalintas iš parko. Istoriniai kelionės duomenys išsaugoti.');
          await load();
        }); } },
      ],
    );
  };

  const submitFuelCorrection = () => run(async () => {
    const liters = Number(correctionLiters.replace(',', '.'));
    if (!correctionVehicleId) throw new Error('Pasirinkite automobilį.');
    if (!Number.isFinite(liters) || liters < 0) throw new Error('Įveskite likutį litrais.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correctionDate)) throw new Error('Įveskite datą formatu YYYY-MM-DD.');
    await employeeApi('/api/admin/fuel-corrections', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: correctionVehicleId,
        liters,
        effectiveAt: correctionDate,
        note: correctionNote.trim() || null,
      }),
    });
    setCorrectionLiters('');
    setCorrectionNote('');
    setMessage('Kuro likučio korekcija patvirtinta.');
    await load();
  });

  const reviewFuel = (report: FuelReport, approve: boolean) => run(async () => {
    await employeeApi(`/api/admin/fuel-reports/${encodeURIComponent(report.id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
    setMessage(approve ? 'Kuro likučio pakeitimas patvirtintas.' : 'Kuro likučio pakeitimas atmestas; vairuotojas turės patvirtinti iš naujo.');
    await load();
  });

  const reviewDepartureOverride = (override: ServerDepartureOverride) => run(async () => {
    await employeeApi(`/api/admin/departure-overrides/${encodeURIComponent(override.id)}/review`, { method: 'POST' });
    setMessage('Patvirtinta: vairuotojas gali važiuoti su šiais pasibaigusiais terminais.');
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
  const assignmentLoad = selectedAssignmentRoute && selectedAssignmentVehicle
    ? describeVehicleLoad(selectedAssignmentRoute.total_weight_kg, selectedAssignmentVehicle.maximumPayloadKg)
    : null;

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <FoundationScreen
        contentMaxWidth={focus ? 900 : desktop ? 1440 : tablet ? 980 : undefined}
        showFoundationNotice={false}
        title={focus === 'employees' ? 'Vairuotojai ir darbuotojai' : focus === 'fleet' ? 'Automobiliai' : focus === 'fuel-reports' ? 'Kuro likučio pakeitimai' : 'Administratoriaus panelė'}
        description={focus === 'employees' ? 'Redaguokite darbuotojo duomenis, PIN ir vairuotojo leidimus.' : focus === 'fleet' ? 'Redaguokite automobilio numerį, kėbulą, šonines duris ir priskyrimą.' : focus === 'fuel-reports' ? 'Patvirtinkite arba atmeskite vairuotojų praneštus kuro likučio neatitikimus.' : 'Darbuotojai, automobiliai ir maršrutų priskyrimai.'}>
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
          <View style={[styles.column, (focus === 'fleet' || focus === 'fuel-reports' || !canManageEmployees) && styles.hidden]}>
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
                  {employee.id !== profile.id ? <Pressable accessibilityLabel={`Pašalinti ${employee.displayName}`} accessibilityRole="button" onPress={() => deleteEmployee(employee)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Pašalinti</Text></Pressable> : null}
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
              <View style={styles.listContent}><Text style={styles.listTitle}>{selectedAssignmentVehicle ? `${selectedAssignmentVehicle.registrationNumber} · ${selectedAssignmentVehicle.model}` : 'Pasirinkti automobilį'}</Text>{selectedAssignmentVehicle ? <Text style={[styles.meta, assignmentLoad?.overCapacity && styles.loadWarning]}>{assignmentLoad ? assignmentLoad.summaryLabel : `iki ${selectedAssignmentVehicle.maximumPayloadKg} kg`}</Text> : null}</View><Text style={styles.pickerChevron}>{assignmentPicker === 'vehicle' ? '−' : '+'}</Text>
            </Pressable>
            {assignmentPicker === 'vehicle' ? <View style={styles.choiceColumn}>{vehicles.map((vehicle) => {
              const load = selectedAssignmentRoute
                ? describeVehicleLoad(selectedAssignmentRoute.total_weight_kg, vehicle.maximumPayloadKg)
                : null;
              return (
              <Pressable key={vehicle.id} onPress={() => { setSelectedAssignmentVehicleId(vehicle.id); setAssignmentPicker(null); }} style={[styles.selection, selectedAssignmentVehicleId === vehicle.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text><Text style={[styles.meta, load?.overCapacity && styles.loadWarning]}>{load ? `iki ${vehicle.maximumPayloadKg} kg · apkrova ${load.percentLabel}` : `iki ${vehicle.maximumPayloadKg} kg`}</Text>
              </Pressable>
              );
            })}</View> : null}
            <Text style={styles.sectionLabel}>3. Maršrutas šiame įrenginyje</Text>
            <Pressable onPress={() => setAssignmentPicker((current) => current === 'route' ? null : 'route')} style={styles.pickerSummary}>
              <View style={styles.listContent}><Text style={styles.listTitle}>{selectedAssignmentRoute ? `${selectedAssignmentRoute.date} · ${selectedAssignmentRoute.total_stops} tašk.` : 'Pasirinkti maršrutą'}</Text>{selectedAssignmentRoute ? <Text style={styles.meta}>{Math.round(selectedAssignmentRoute.total_weight_kg)} kg{assignmentLoad ? ` · ${assignmentLoad.percentLabel}` : ''}</Text> : null}</View><Text style={styles.pickerChevron}>{assignmentPicker === 'route' ? '−' : '+'}</Text>
            </Pressable>
            {assignmentPicker === 'route' ? <View style={styles.choiceColumn}>{routes.filter((route) => route.status === 'planned').map((route) =>
              <Pressable key={route.id} onPress={() => { setSelectedRouteId(route.id); setAssignmentPicker(null); }} style={[styles.selection, selectedRouteId === route.id && styles.selectionActive]}>
                <Text style={styles.listTitle}>{route.date} · {route.total_stops} tašk.</Text><Text style={styles.meta}>{Math.round(route.total_weight_kg)} kg · {route.status}</Text>
              </Pressable>)}</View> : null}
            <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void assignRoute()}>
              <Text style={styles.primaryText}>Priskirti maršrutą</Text>
            </Pressable>
            {assignments.filter((assignment) => !['completed', 'cancelled'].includes(assignment.status)).map((assignment) => (
              <View key={assignment.id} style={styles.routeManagementRow}>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{assignment.driverName}</Text>
                  <Text style={styles.meta}>{String(assignment.routeSnapshot.route.date ?? '')} · {assignment.status}{assignment.vehicle ? assignmentLoadSuffix(Number(assignment.routeSnapshot.route.total_weight_kg) || 0, assignment.vehicle.maximumPayloadKg) : ''}</Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable disabled={busy || !online} onPress={() => void completeServerAssignment(assignment)} style={styles.completeButton} testID={`admin-complete-assignment-${assignment.id}`}><Text style={styles.completeButtonText}>Užbaigti</Text></Pressable>
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
            <Text style={styles.meta}>Užbaikite, atšaukite arba visam laikui ištrinkite kabantį maršrutą prieš kurdami naują.</Text>
            {routes.length === 0 ? <Text style={styles.meta}>Aktyvių maršrutų nėra.</Text> : routes.map((route) => (
              <View key={route.id} style={styles.routeManagementRow}>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{route.date} · {route.total_stops} tašk.</Text>
                  <Text style={styles.meta}>{route.status}</Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable disabled={busy} onPress={() => completeLocalRoute(route)} style={styles.completeButton} testID={`admin-complete-route-${route.id}`}><Text style={styles.completeButtonText}>Užbaigti</Text></Pressable>
                  <Pressable disabled={busy || !online} onPress={() => cancelRoute(route)} style={styles.smallButton}><Text style={styles.smallButtonText}>Atšaukti</Text></Pressable>
                  <Pressable disabled={busy || !online} onPress={() => deleteRoute(route)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Ištrinti</Text></Pressable>
                </View>
              </View>
            ))}
            </> : null}
          </View>

          <View style={[styles.card, (focus === 'employees' || focus === 'fuel-reports' || !canManageVehicles) && styles.hidden]} testID="fleet-vehicle-management">
            <CollapsibleHeader title={`Automobilių parkas (${vehicles.length})`} expanded={expandedSection === 'fleet'} onPress={() => toggleSection('fleet')} styles={styles} />
            {expandedSection === 'fleet' ? <>
            <Text style={styles.meta}>Bako talpa, PLL talpa ir šoninės durys yra automobilio techniniai laukai. Kuro likutis čia nerašomas. Miestas automobiliams nesaugomas.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/loading-schema-preview', params: { returnTo: 'admin' } } as unknown as Href)} style={styles.smallButton} testID="open-loading-schema-preview">
              <Text style={styles.smallButtonText}>Krovimo schemos peržiūra (bandomieji taškai)</Text>
            </Pressable>
            <View style={styles.vehicleList}>
              {vehicles.map((vehicle) => {
                const driver = users.find((item) => item.id === vehicle.assignedDriverId);
                const cargo = resolveVehicleCargo(vehicle);
                return <View key={vehicle.id} style={styles.employeeBlock}>
                <View style={[styles.selection, selectedVehicleId === vehicle.id && styles.selectionActive]}>
                  <View style={styles.listRowCompact}>
                    <View style={styles.listContent}>
                      <Text style={styles.listTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text>
                      <Text style={styles.meta}>{vehicle.maximumPayloadKg} kg · bakas {formatTankCapacityLabel(vehicle.fuelTankCapacityLiters ?? fleetTankCapacity(vehicle.registrationNumber))} · {cargo.palletCapacity} PLL · {cargo.hasSideDoor ? 'šoninės durys' : 'be šoninių durų'} · {driver ? driver.displayName : 'Nepriskirtas'}</Text>
                    </View>
                    <View style={styles.rowActions}>
                      <Pressable accessibilityLabel={`Redaguoti automobilį ${vehicle.registrationNumber}`} accessibilityRole="button" onPress={() => selectVehicle(vehicle)} style={styles.smallButton}><Text style={styles.smallButtonText}>Redaguoti</Text></Pressable>
                      <Pressable accessibilityLabel={`Pašalinti automobilį ${vehicle.registrationNumber}`} accessibilityRole="button" onPress={() => deleteVehicle(vehicle)} style={styles.dangerButton}><Text style={styles.dangerButtonText}>Pašalinti</Text></Pressable>
                    </View>
                  </View>
                </View>
                {selectedVehicleId === vehicle.id ? <View style={styles.editor} testID="vehicle-edit-form">
              <View style={styles.editorHeading}>
                <View style={styles.listContent}><Text style={styles.title}>Redaguoti automobilį</Text><Text style={styles.meta}>Numeris, bako talpa, PLL talpa, šoninės durys ir kuro norma.</Text></View>
                <Pressable accessibilityLabel="Uždaryti automobilio redagavimą" accessibilityRole="button" onPress={() => setSelectedVehicleId('')} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable>
              </View>
              {input(editVehicleNumber, (value) => {
                const plate = value.toUpperCase().replace(/\s/g, '').slice(0, 12);
                setEditVehicleNumber(plate);
                applyKnownPlateDefaults(plate, {
                  setPallets: setEditVehiclePallets,
                  setSideDoor: setEditVehicleSideDoor,
                  setTank: setEditVehicleTank,
                });
              }, 'Valstybinis numeris')}
              {input(editVehicleModel, setEditVehicleModel, 'Modelis')}
              <TextInput accessibilityLabel="Maksimalus krovinio svoris" value={editVehiclePayload} onChangeText={(value) => setEditVehiclePayload(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                keyboardType="decimal-pad" placeholder="Maksimalus krovinio svoris, kg" placeholderTextColor={colors.textMuted} style={styles.input} />
              <TextInput accessibilityLabel="Bako talpa" testID="edit-vehicle-tank-capacity" value={editVehicleTank} onChangeText={(value) => setEditVehicleTank(value.replace(/[^\d.,]/g, '').slice(0, 6))}
                keyboardType="decimal-pad" placeholder="Bako talpa, l (pvz. 90)" placeholderTextColor={colors.textMuted} style={styles.input} />
              <TextInput accessibilityLabel="Kuro norma" testID="vehicle-fuel-norm" value={editVehicleNorm} onChangeText={(value) => setEditVehicleNorm(value.replace(/[^\d.,]/g, '').slice(0, 5))}
                keyboardType="decimal-pad" placeholder="Kuro norma, l/100 km (pvz. 13,9)" placeholderTextColor={colors.textMuted} style={styles.input} />
              <VehicleCargoFields
                palletCapacity={editVehiclePallets}
                hasSideDoor={editVehicleSideDoor}
                onPalletCapacityChange={setEditVehiclePallets}
                onSideDoorChange={setEditVehicleSideDoor}
                styles={styles}
                testPrefix="edit-vehicle"
              />
              <Text style={styles.meta}>Bako talpa yra fizinis bako tūris, ne kuro likutis. Pagal kuro normą kelionės lape skaičiuojamas sunaudotas kuras ir likutis. Palikus normą tuščią, imamas apytikslis įvertis pagal keliamąją galią.</Text>
              {canManageFinancials ? <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'admin' } } as unknown as Href)} style={styles.smallButton}><Text style={styles.smallButtonText}>Keisti draudimą ir kelių mokestį →</Text></Pressable> : null}
              <Pressable accessibilityLabel="Išsaugoti automobilio pakeitimus" accessibilityRole="button" disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]} onPress={() => void saveVehicle()}><Text style={styles.primaryText}>Išsaugoti automobilį</Text></Pressable>

              <CollapsibleHeader title="Krovinių skyrius" expanded={showVehicleCargoDetails} onPress={() => setShowVehicleCargoDetails((current) => !current)} styles={styles} />
              {showVehicleCargoDetails ? <>
              <View style={styles.choiceRow}>
                {([['van', 'Furgonas'], ['box', 'Būda']] as const).map(([value, label]) => (
                  <Pressable accessibilityRole="radio" accessibilityState={{ checked: editCargoBodyType === value }} key={value}
                    onPress={() => setEditCargoBodyType(value)} style={[styles.choice, editCargoBodyType === value && styles.choiceActive]}>
                    <Text style={styles.choiceText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput accessibilityLabel="Krovinių skyriaus ilgis" testID="vehicle-cargo-length" value={editCargoLength}
                onChangeText={(value) => setEditCargoLength(value.replace(/[^\d]/g, '').slice(0, 5))}
                keyboardType="decimal-pad" placeholder="Naudingas ilgis, mm (pvz. 4100)" placeholderTextColor={colors.textMuted} style={styles.input} />
              <TextInput accessibilityLabel="Krovinių skyriaus plotis" testID="vehicle-cargo-width" value={editCargoWidth}
                onChangeText={(value) => setEditCargoWidth(value.replace(/[^\d]/g, '').slice(0, 5))}
                keyboardType="decimal-pad" placeholder="Naudingas plotis, mm (pvz. 2100)" placeholderTextColor={colors.textMuted} style={styles.input} />
              {editCargoBodyType === 'van' ? <>
                <TextInput accessibilityLabel="Ratų arkos pradžia" value={editArchStart}
                  onChangeText={(value) => setEditArchStart(value.replace(/[^\d]/g, '').slice(0, 5))}
                  keyboardType="decimal-pad" placeholder="Ratų arkos pradžia nuo kabinos, mm" placeholderTextColor={colors.textMuted} style={styles.input} />
                <TextInput accessibilityLabel="Ratų arkos pabaiga" value={editArchEnd}
                  onChangeText={(value) => setEditArchEnd(value.replace(/[^\d]/g, '').slice(0, 5))}
                  keyboardType="decimal-pad" placeholder="Ratų arkos pabaiga nuo kabinos, mm" placeholderTextColor={colors.textMuted} style={styles.input} />
                <TextInput accessibilityLabel="Ratų arkos plotis" value={editArchIntrusion}
                  onChangeText={(value) => setEditArchIntrusion(value.replace(/[^\d]/g, '').slice(0, 4))}
                  keyboardType="decimal-pad" placeholder="Kiek arka atima pločio iš vienos pusės, mm" placeholderTextColor={colors.textMuted} style={styles.input} />
              </> : <Text style={styles.meta}>Būdos grindys plokščios per visą ilgį — ratų arkų nurodyti nereikia.</Text>}
              <Text style={styles.meta}>Suvedus ilgį ir plotį, krovimo ekrane rodoma tiksli padėklų schema. Palikus tuščius, lieka senoji zonų schema.</Text>
              <Text style={styles.meta}>Pakeitimus krovinių skyriuje išsaugo tas pats „Išsaugoti automobilį“ mygtukas aukščiau.</Text>
              </> : null}

              <CollapsibleHeader title="Priskirti vairuotojui" expanded={showVehicleDriverAssignment} onPress={() => setShowVehicleDriverAssignment((current) => !current)} styles={styles} />
              {showVehicleDriverAssignment ? <>
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
              </> : null}
                </View> : null}
                </View>;
              })}
            </View>
            </> : null}
          </View>

          <View style={[styles.card, (focus === 'employees' || focus === 'fuel-reports' || !canManageVehicles) && styles.hidden]} testID="vehicle-create-form">
            <CollapsibleHeader title="Pridėti automobilį" expanded={expandedSection === 'vehicle-create'} onPress={() => toggleSection('vehicle-create')} styles={styles} />
            {expandedSection === 'vehicle-create' ? <>
            {input(newVehicleNumber, (value) => {
              const plate = value.toUpperCase().replace(/\s/g, '').slice(0, 12);
              setNewVehicleNumber(plate);
              applyKnownPlateDefaults(plate, {
                setPallets: setNewVehiclePallets,
                setSideDoor: setNewVehicleSideDoor,
                setTank: setNewVehicleTank,
              });
            }, 'Valstybinis numeris')}
            {input(newVehicleModel, setNewVehicleModel, 'Modelis')}
            <TextInput value={newVehiclePayload} onChangeText={(value) => setNewVehiclePayload(value.replace(/[^\d.,]/g, '').slice(0, 8))}
              keyboardType="decimal-pad" placeholder="Maksimalus krovinio svoris, kg" placeholderTextColor={colors.textMuted} style={styles.input} />
            <TextInput accessibilityLabel="Bako talpa" testID="new-vehicle-tank-capacity" value={newVehicleTank} onChangeText={(value) => setNewVehicleTank(value.replace(/[^\d.,]/g, '').slice(0, 6))}
              keyboardType="decimal-pad" placeholder="Bako talpa, l (pvz. 110)" placeholderTextColor={colors.textMuted} style={styles.input} />
            <TextInput value={newVehicleNorm} onChangeText={(value) => setNewVehicleNorm(value.replace(/[^\d.,]/g, '').slice(0, 5))}
              keyboardType="decimal-pad" placeholder="Kuro norma, l/100 km (pvz. 12)" placeholderTextColor={colors.textMuted} style={styles.input} />
            <VehicleCargoFields
              palletCapacity={newVehiclePallets}
              hasSideDoor={newVehicleSideDoor}
              onPalletCapacityChange={setNewVehiclePallets}
              onSideDoorChange={setNewVehicleSideDoor}
              styles={styles}
              testPrefix="new-vehicle"
            />
            <Pressable disabled={busy || !online} style={[styles.secondaryButton, (busy || !online) && styles.disabled]} onPress={() => void createVehicle()}>
              <Text style={styles.secondaryText}>Pridėti automobilį</Text>
            </Pressable>
            </> : null}
          </View>

          <View style={[styles.card, Boolean(focus) && styles.hidden]} testID="vehicle-fault-inbox">
            <CollapsibleHeader title={`Neskubūs gedimai (${vehicleFaults.length})`} expanded={expandedSection === 'vehicle-faults'} onPress={() => toggleSection('vehicle-faults')} styles={styles} />
            {expandedSection === 'vehicle-faults' ? <>
              <Text style={styles.meta}>Vairuotojo komentarai nestabdo važiavimo. Jie čia atsiranda automatiškai, kai įrenginys turi ryšį.</Text>
              {vehicleFaults.length === 0 ? <Text style={styles.meta}>Gautų gedimų nėra.</Text> : vehicleFaults.map((fault) => (
                <View key={fault.id} style={styles.routeManagementRow}>
                  <View style={styles.listContent}>
                    <Text style={styles.listTitle}>{fault.reportedByName}{fault.registrationNumber ? ` · ${fault.registrationNumber}` : ''}</Text>
                    <Text style={styles.meta}>{fault.comment}</Text>
                    <Text style={styles.meta}>{new Date(fault.reportedAt).toLocaleString('lt-LT')}</Text>
                  </View>
                </View>
              ))}
            </> : null}
          </View>

          <View style={[styles.card, Boolean(focus) && styles.hidden]} testID="departure-override-inbox">
            <CollapsibleHeader
              title={`Išvykimo patvirtinimai (${departureOverrides.filter((item) => item.status === 'pending').length})`}
              expanded={expandedSection === 'departure-overrides'}
              onPress={() => toggleSection('departure-overrides')}
              styles={styles}
            />
            {expandedSection === 'departure-overrides' ? <>
              <Text style={styles.meta}>Tušti terminai darbo nestabdo. Čia tvirtinama tik tada, kai įrašyta data jau pasibaigė, o važiuoti vis tiek reikia.</Text>
              {departureOverrides.filter((item) => item.status === 'pending').length === 0 ? <Text style={styles.meta}>Laukiančių patvirtinimų nėra.</Text> : null}
              {departureOverrides.filter((item) => item.status === 'pending').map((override) => (
                <View key={override.id} style={styles.routeManagementRow}>
                  <View style={styles.listContent}>
                    <Text style={styles.listTitle}>{override.requestedByName}{override.registrationNumber ? ` · ${override.registrationNumber}` : ''}</Text>
                    <Text style={styles.meta}>{override.summary}</Text>
                    <Text style={styles.meta}>{new Date(override.requestedAt).toLocaleString('lt-LT')}</Text>
                  </View>
                  {canManageVehicles ? (
                    <View style={styles.rowActions}>
                      <Pressable disabled={busy || !online} onPress={() => void reviewDepartureOverride(override)} style={styles.smallButton} testID={`approve-departure-override-${override.id}`}>
                        <Text style={styles.smallButtonText}>Patvirtinti, kad galima važiuoti</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </> : null}
          </View>

          <View style={[styles.card, (focus === 'employees' || focus === 'fleet') && styles.hidden]} testID="fuel-report-management">
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

              {profile.role === 'admin' ? <View style={styles.listContent} testID="fuel-correction-form">
                <Text style={styles.sectionLabel}>Įrašyti likučio korekciją</Text>
                <Text style={styles.meta}>
                  Naudokite, kai reikia nurodyti likutį laikotarpio pradžioje (pvz. pilnas bakas mėnesio 1 d.)
                  arba ištaisyti klaidingą rodmenį. Korekcija patvirtinama iš karto ir tampa kelionės lapo
                  atskaitos tašku nuo nurodytos datos.
                </Text>
                <View style={styles.choiceColumn}>
                  {vehicles.map((vehicle) =>
                    <Pressable key={vehicle.id} onPress={() => setCorrectionVehicleId(vehicle.id)}
                      style={[styles.selection, correctionVehicleId === vehicle.id && styles.selectionActive]}>
                      <Text style={styles.listTitle}>{vehicle.registrationNumber}</Text>
                      <Text style={styles.meta}>{vehicle.model} · dabar {vehicle.fuelRemainingLiters ?? '—'} l</Text>
                    </Pressable>)}
                </View>
                <TextInput accessibilityLabel="Likutis litrais" value={correctionLiters}
                  onChangeText={(value) => setCorrectionLiters(value.replace(/[^\d.,]/g, '').slice(0, 6))}
                  keyboardType="decimal-pad" placeholder="Likutis, l (pvz. 110)" placeholderTextColor={colors.textMuted} style={styles.input} />
                <TextInput accessibilityLabel="Korekcijos data" value={correctionDate}
                  onChangeText={(value) => setCorrectionDate(value.replace(/[^\d-]/g, '').slice(0, 10))}
                  placeholder="Data, YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={styles.input} />
                <TextInput accessibilityLabel="Korekcijos priežastis" value={correctionNote} onChangeText={setCorrectionNote}
                  placeholder="Priežastis (nebūtina)" placeholderTextColor={colors.textMuted} style={styles.input} />
                <Pressable disabled={busy || !online} style={[styles.primaryButton, (busy || !online) && styles.disabled]}
                  onPress={() => void submitFuelCorrection()}>
                  <Text style={styles.primaryText}>Patvirtinti korekciją</Text>
                </Pressable>
              </View> : null}

              {fuelReports.filter((report) => report.kind === 'admin_correction').slice(0, 5).map((report) =>
                <View key={report.id} style={styles.routeManagementRow}>
                  <View style={styles.listContent}>
                    <Text style={styles.listTitle}>{report.registrationNumber} · {report.reportedLiters} l</Text>
                    <Text style={styles.meta}>
                      Korekcija nuo {report.effectiveAt ?? '—'}
                      {report.note ? ` · ${report.note}` : ''}
                    </Text>
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
              {canManageFinancials && editEmployeeRole === 'driver' ? <View style={styles.listContent} testID="driver-pay-rates">
                <Text style={styles.sectionLabel}>Atlygis (netto)</Text>
                <View style={styles.choiceRow}>
                  {([['variable', 'Kintantis'], ['fixed', 'Fiksuotas']] as const).map(([value, label]) =>
                    <Pressable accessibilityRole="radio" accessibilityState={{ checked: editPayType === value }} key={value}
                      onPress={() => setEditPayType(value)} style={[styles.choice, editPayType === value && styles.choiceActive]}>
                      <Text style={styles.choiceText}>{label}</Text>
                    </Pressable>)}
                </View>
                <TextInput accessibilityLabel="Dienos įkainis" value={editPayDaily} onChangeText={(value) => setEditPayDaily(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                  keyboardType="decimal-pad" placeholder={editPayType === 'fixed' ? 'Dienos atlygis, € (pvz. 60)' : 'Bazė už dieną, € (pvz. 23)'} placeholderTextColor={colors.textMuted} style={styles.input} />
                {editPayType === 'variable' ? <>
                  <TextInput accessibilityLabel="Įkainis už kilometrą" value={editPayPerKm} onChangeText={(value) => setEditPayPerKm(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                    keyboardType="decimal-pad" placeholder="Už km, € (pvz. 0,05)" placeholderTextColor={colors.textMuted} style={styles.input} />
                  <TextInput accessibilityLabel="Įkainis už kilogramą" value={editPayPerKg} onChangeText={(value) => setEditPayPerKg(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                    keyboardType="decimal-pad" placeholder="Už kg, € (pvz. 0,006)" placeholderTextColor={colors.textMuted} style={styles.input} />
                  <TextInput accessibilityLabel="Įkainis už tašką" value={editPayPerStop} onChangeText={(value) => setEditPayPerStop(value.replace(/[^\d.,]/g, '').slice(0, 8))}
                    keyboardType="decimal-pad" placeholder="Už pristatymo tašką, € (pvz. 0,65)" placeholderTextColor={colors.textMuted} style={styles.input} />
                </> : <Text style={styles.meta}>Fiksuotas atlygis mokamas už dieną, įkainiai už km, kg ir taškus neskaičiuojami.</Text>}
                <Text style={styles.meta}>Palikus laukus tuščius, taikomi numatytieji: 23 € + 0,05 €/km + 0,006 €/kg + 0,65 €/tašk.</Text>
              </View> : null}
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
                {MANAGEMENT_PERMISSION_KEYS.filter((key) => key !== 'canEnterTripReadings').map((key) => {
                  const enabled = normalizeEmployeePermissions(selectedEmployee.permissions)[key];
                  const copy = MANAGEMENT_PERMISSION_LABELS[key];
                  return <Pressable key={key} onPress={() => void togglePermission(selectedEmployee, key)} style={styles.permissionRow} testID={`permission-${selectedEmployee.id}-${key}`}>
                    <View style={styles.permissionCopy}><Text style={styles.permissionTitle}>{copy.title}</Text><Text style={styles.permissionDescription}>{copy.description}</Text></View>
                    <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}><View style={[styles.switchThumb, enabled && styles.switchThumbOn]} /></View>
                  </Pressable>;
                })}
              </View> : null}
              {profile.role === 'admin' && selectedEmployee && editEmployeeRole === 'quality' ? <View style={styles.permissions}>
                <Text style={styles.sectionLabel}>Kelionės lapų teisės</Text>
                {(['canEnterTripReadings'] as const).map((key) => {
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

function decimalInput(value: number): string {
  return String(value).replace('.', ',');
}

function parseDecimalInput(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function assignmentLoadSuffix(weightKg: number, payloadKg: number): string {
  const load = describeVehicleLoad(weightKg, payloadKg);
  return load ? ` · ${load.summaryLabel}` : '';
}

/** Empty clears the tank size, except known plates still fill from the catalog on the server. */
function parseFuelTankCapacity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatStoredLiters(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace('.', ',');
}

function formatTankCapacityLabel(value: number | null): string {
  return value === null ? '—' : `${String(value).replace('.', ',')} l`;
}

function applyKnownPlateDefaults(plate: string, setters: {
  setPallets: (value: PalletCapacity) => void;
  setSideDoor: (value: boolean) => void;
  setTank: (value: string) => void;
}): void {
  const spec = fleetCargoSpec(plate);
  if (spec) {
    setters.setPallets(spec.palletCapacity);
    setters.setSideDoor(spec.hasSideDoor);
  }
  const tank = fleetTankCapacity(plate);
  if (tank !== null) setters.setTank(formatStoredLiters(tank));
}

/** Empty means "not measured", which switches the screen back to the bay diagram. */
function parseMm(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function mmInput(value: number | null | undefined): string {
  return typeof value === 'number' && value > 0 ? String(value) : '';
}

/** Empty clears the norm, so the vehicle goes back to the payload-based estimate. */
function parseFuelNorm(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function groupEmployeesByRole(employees: EmployeeProfile[]): { role: EmployeeRole; title: string; employees: EmployeeProfile[] }[] {
  const groups: { role: EmployeeRole; title: string }[] = [
    { role: 'driver', title: 'Vairuotojai' },
    { role: 'dispatcher', title: 'Dispečeriai' },
    { role: 'quality', title: 'Kokybės kontrolė' },
    { role: 'admin', title: 'Administracija' },
  ];
  return groups
    .map((group) => ({ ...group, employees: employees.filter((employee) => employee.role === group.role) }))
    .filter((group) => group.employees.length > 0);
}

function VehicleCargoFields({
  palletCapacity,
  hasSideDoor,
  onPalletCapacityChange,
  onSideDoorChange,
  styles,
  testPrefix,
}: {
  palletCapacity: PalletCapacity;
  hasSideDoor: boolean;
  onPalletCapacityChange: (value: PalletCapacity) => void;
  onSideDoorChange: (value: boolean) => void;
  styles: ReturnType<typeof createStyles>;
  testPrefix: string;
}) {
  return (
    <>
      <Text style={styles.sectionLabel}>Krovinio talpa</Text>
      <View style={styles.choiceRow}>
        {PALLET_CAPACITIES.map((capacity) => (
          <Pressable
            key={capacity}
            accessibilityRole="button"
            onPress={() => onPalletCapacityChange(capacity)}
            style={[styles.choice, palletCapacity === capacity && styles.choiceActive]}
            testID={`${testPrefix}-pallets-${capacity}`}>
            <Text style={[styles.choiceText, palletCapacity === capacity && styles.choiceTextActive]}>{capacity} PLL</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sectionLabel}>Šoninės durys</Text>
      <View style={styles.choiceRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSideDoorChange(true)}
          style={[styles.choice, hasSideDoor && styles.choiceActive]}
          testID={`${testPrefix}-side-door-yes`}>
          <Text style={[styles.choiceText, hasSideDoor && styles.choiceTextActive]}>Yra</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSideDoorChange(false)}
          style={[styles.choice, !hasSideDoor && styles.choiceActive]}
          testID={`${testPrefix}-side-door-no`}>
          <Text style={[styles.choiceText, !hasSideDoor && styles.choiceTextActive]}>Nėra</Text>
        </Pressable>
      </View>
    </>
  );
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
  loadWarning: { color: colors.warning },
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
  completeButton: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.success, justifyContent: 'center' },
  completeButtonText: { ...type.secondaryStrong, color: colors.textInverse },
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
