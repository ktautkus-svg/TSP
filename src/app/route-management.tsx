import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { effectiveAssignmentStatus, isActiveAssignment } from '@/application/auth/route-assignment-status';
import { assignRouteToDriver, completeAssignedRoute } from '@/application/auth/route-assignment-sync';
import { roleHomePath } from '@/application/navigation/role-home';
import { CancelDraftRoute, ReopenRouteForPlanning } from '@/application/routes/route-commands';
import {
    DEFAULT_ROUTE_PRICE_SETTINGS,
    estimatePreliminaryRoutePrice,
    normalizeRoutePriceSettings,
    type PreliminaryRoutePrice,
    type RoutePriceSettings,
} from '@/application/routes/route-price';
import { AdminCompleteRoute } from '@/application/routes/route-workday';
import { markRouteDeletedForCloud } from '@/application/sync/route-cloud-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, TrashIcon } from '@/components/app-icons';
import { DateInput } from '@/components/date-input';
import { uniqueRegionCodes } from '@/domain/route-code';
import { employeeApi, type EmployeeProfile, type ServerFleetVehicle, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';
import { describeVehicleLoad } from '@/ui/vehicle-load';

type LocalRoute = {
  id: string;
  date: string;
  status: string;
  total_stops: number;
  total_weight_kg: number;
  estimated_distance_km: number | null;
  estimated_duration_minutes: number | null;
  route_codes: string | null;
};

export default function RouteManagementScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { routeId: requestedRouteId } = useLocalSearchParams<{ routeId?: string }>();
  const { profile, online } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const desktop = width >= 980;
  const [routes, setRoutes] = useState<LocalRoute[]>([]);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<'route' | 'driver' | 'vehicle' | null>(null);
  const [priceSettings, setPriceSettings] = useState<RoutePriceSettings>(() => normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assignmentCompleted, setAssignmentCompleted] = useState<{
    routeLabel: string;
    driverName: string;
    vehicleNumber: string;
  } | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<ServerRouteAssignment | null>(null);
  const [editingAssignmentDate, setEditingAssignmentDate] = useState('');
  const [completingRoute, setCompletingRoute] = useState<LocalRoute | null>(null);
  const [completionOdometer, setCompletionOdometer] = useState('');
  const [activeSegment, setActiveSegment] = useState<'routes' | 'active'>('routes');
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const loadLocalRoutes = async () => {
      const localRoutes = await db.getAllAsync<LocalRoute>(
        `SELECT id, date, status, total_stops, total_weight_kg, estimated_distance_km,
                estimated_duration_minutes,
                (SELECT GROUP_CONCAT(DISTINCT TRIM(sl.route_code))
                 FROM shipment_lines sl
                 WHERE sl.route_id = routes.id AND sl.route_code IS NOT NULL AND TRIM(sl.route_code) <> '') AS route_codes
         FROM routes
         WHERE status <> 'cancelled'
           AND (owner_employee_id IS NULL OR owner_employee_id = ?)
         ORDER BY created_at DESC`,
        profile.id,
      );
      setRoutes(localRoutes);
      setSelectedRouteId((current) => current && localRoutes.some((route) => route.id === current && route.status === 'planned')
        ? current
        : null);
    };

    // The route that was just planned is already in SQLite. Show it before a
    // potentially slow cloud refresh so the assignment screen never flashes as
    // empty or loses the route when opened from the loading page.
    await loadLocalRoutes();
    // Dispatchers create and own routes on this device (the "+ Planuoti
    // maršrutą" flow below), and the home screen redirects them here before its
    // own sync runs. The app-wide coordinator covers them on startup, foreground
    // and route mutations; this refresh goes through the same coordinator rather
    // than calling the sync engine directly, so a manual refresh cannot run a
    // second pass concurrently with a lifecycle one, and its outcome shows up in
    // the shared status indicator.
    await requestSync('dispatcher-refresh');
    await loadLocalRoutes();
    if (!online) return;
    const [userResponse, assignmentResponse, vehicleResponse, priceSettingsResponse] = await Promise.allSettled([
      employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
      employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
      employeeApi<{ settings: RoutePriceSettings }>('/api/admin/route-price-settings'),
    ]);
    const unavailable: string[] = [];
    const availableDrivers = userResponse.status === 'fulfilled'
      ? userResponse.value.users.filter((user) => user.role === 'driver' && !user.disabled)
      : null;
    if (availableDrivers) setDrivers(availableDrivers);
    else unavailable.push('vairuotojų');

    if (assignmentResponse.status === 'fulfilled') setAssignments(assignmentResponse.value.assignments);
    else unavailable.push('priskyrimų');

    const availableVehicles = vehicleResponse.status === 'fulfilled' ? vehicleResponse.value.vehicles : null;
    if (availableVehicles) setVehicles(availableVehicles);
    else unavailable.push('automobilių');

    if (priceSettingsResponse.status === 'fulfilled') setPriceSettings(normalizeRoutePriceSettings(priceSettingsResponse.value.settings));
    else unavailable.push('kainos parametrų');

    if (availableDrivers) {
      setSelectedDriverId((current) => current && availableDrivers.some((driver) => driver.id === current) ? current : null);
    }
    if (availableVehicles) {
      setSelectedVehicleId((current) => current && availableVehicles.some((vehicle) => vehicle.id === current) ? current : null);
    }
    if (unavailable.length > 0) {
      setMessage(`Maršrutas išsaugotas, bet nepavyko atnaujinti ${unavailable.join(', ')} sąrašo. Paspauskite „Atnaujinti“ dar kartą.`);
    }
  }, [db, online, profile.id, requestSync]);

  useEffect(() => {
    if (!['admin', 'dispatcher'].includes(profile.role)) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Skydelio duomenų gauti nepavyko.'));
  }, [load, profile.role, router]);

  const activeAssignments = useMemo(() => assignments.filter(isActiveAssignment), [assignments]);
  const freeDrivers = useMemo(
    () => drivers.filter((driver) => !activeAssignments.some((assignment) => assignment.driverId === driver.id)),
    [activeAssignments, drivers],
  );
  const assignableRoutes = useMemo(
    () => routes.filter((route) => route.status === 'planned'
      && !activeAssignments.some((assignment) => assignment.routeId === route.id)),
    [activeAssignments, routes],
  );
  const selectedRoute = assignableRoutes.find((route) => route.id === selectedRouteId) ?? null;
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) ?? null;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  const selectedLoad = selectedRoute && selectedVehicle
    ? describeVehicleLoad(selectedRoute.total_weight_kg, selectedVehicle.maximumPayloadKg)
    : null;
  const selectDriver = (driver: EmployeeProfile) => {
    setSelectedDriverId(driver.id);
    setSelectedVehicleId(null);
  };

  const selectRoute = (routeId: string | null) => {
    setSelectedRouteId(routeId);
    // Quick-assign: when there is exactly one obvious driver and vehicle,
    // preselect them so the dispatcher only has to confirm, not pick twice.
    setSelectedDriverId(routeId && freeDrivers.length === 1 ? freeDrivers[0].id : null);
    setSelectedVehicleId(routeId && vehicles.length === 1 ? vehicles[0].id : null);
    setOpenPicker(null);
    setAssignmentCompleted(null);
  };
  const assign = async () => {
    if (busy || !selectedRoute || !selectedDriver || !selectedVehicle) return;
    if (selectedRoute.status !== 'planned') {
      setMessage('Pirmiausia užbaikite maršruto planavimą ir pasirinkite variantą.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const confirmation = {
        routeLabel: `${formatDate(selectedRoute.date)} · ${selectedRoute.total_stops} taškų`,
        driverName: selectedDriver.displayName,
        vehicleNumber: selectedVehicle.registrationNumber,
      };
      await assignRouteToDriver(db, selectedRoute.id, selectedDriver.id, selectedVehicle.id);
      await load();
      setSelectedRouteId(null);
      setSelectedDriverId(null);
      setSelectedVehicleId(null);
      setOpenPicker(null);
      setAssignmentCompleted(confirmation);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Maršruto priskirti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const deleteRoute = (route: LocalRoute) => {
    const linkedAssignments = assignments.filter((assignment) => assignment.routeId === route.id);
    const isWorking = ['loading', 'loaded', 'in_progress'].includes(route.status);
    if (isWorking) {
      Alert.alert(
        'Vykdomo maršruto ištrinti negalima',
        'Pirmiausia užbaikite arba atšaukite vykdomą darbą. Taip apsaugomi vairuotojo pristatymo duomenys.',
      );
      return;
    }
    if (linkedAssignments.length > 0 && !online) {
      Alert.alert(
        'Reikia interneto ryšio',
        'Šis maršrutas jau priskirtas vairuotojui. Prisijunkite prie interneto, kad kartu būtų pašalintas ir priskyrimas.',
      );
      return;
    }
    Alert.alert(
      'Ištrinti šį maršrutą?',
      `${formatDate(route.date)} · ${route.total_stops} taškų · ${Math.round(route.total_weight_kg)} kg. Maršrutas ir jo planavimo rezultatai bus pašalinti. Veiksmo atšaukti negalima.`,
      [
        { text: 'Palikti', style: 'cancel' },
        {
          text: 'Ištrinti',
          style: 'destructive',
          onPress: () => { void (async () => {
            setBusy(true);
            setMessage(null);
            try {
              for (const assignment of linkedAssignments) {
                await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}`, { method: 'DELETE' });
              }
              await new CancelDraftRoute(db).execute(route.id);
              await markRouteDeletedForCloud(db, route.id);
              await requestSync('mutation');
              setSelectedRouteId((current) => current === route.id ? null : current);
              setMessage(online
                ? 'Maršrutas ištrintas.'
                : 'Maršrutas pašalintas iš šio įrenginio. Prisijungus ištrynimas bus sinchronizuotas.');
              await load();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Maršruto ištrinti nepavyko.');
            } finally {
              setBusy(false);
            }
          })(); },
        },
      ],
    );
  };

  const completeAssignment = (assignment: ServerRouteAssignment) => {
    const localRoute = routes.find((route) => route.id === assignment.routeId);
    Alert.alert(
      'Užbaigti šį maršrutą?',
      `${assignmentRouteLabel(assignment)} · ${assignment.driverName}. Maršrutas nebekabės tarp aktyvių priskyrimų. Nepristatyti taškai liks nepažymėti.`,
      [
        { text: 'Palikti', style: 'cancel' },
        {
          text: 'Užbaigti',
          onPress: () => { void (async () => {
            setBusy(true);
            setMessage(null);
            try {
              await completeAssignedRoute(db, assignment, localRoute?.id ?? null);
              await requestSync('mutation');
              setMessage('Maršrutas užbaigtas. Jis nebebus rodomas kaip aktyvus priskyrimas.');
              await load();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Maršruto užbaigti nepavyko.');
            } finally {
              setBusy(false);
            }
          })(); },
        },
      ],
    );
  };

  const completeLocalRoute = (route: LocalRoute) => {
    setCompletingRoute(route);
    setCompletionOdometer('');
  };

  const saveManualCompletion = async () => {
    if (!completingRoute || busy) return;
    const endOdometer = Number(completionOdometer.trim().replace(',', '.'));
    if (!Number.isFinite(endOdometer) || endOdometer < 0) {
      setMessage('Įveskite teisingą galutinį odometro rodmenį.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await new AdminCompleteRoute(db).execute(completingRoute.id, { endOdometer, markAllDelivered: true });
      await requestSync('mutation');
      setSelectedRouteId((current) => current === completingRoute.id ? null : current);
      setCompletingRoute(null);
      setCompletionOdometer('');
      setMessage('Maršrutas užbaigtas: visi taškai pažymėti pristatytais, odometras išsaugotas.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Maršruto užbaigti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const editSequence = (route: LocalRoute) => {
    if (route.status === 'draft') {
      router.push({ pathname: '/route/[id]/review', params: { id: route.id } } as Href);
      return;
    }
    if (route.status === 'in_progress') {
      router.push({ pathname: '/route/[id]/overview', params: { id: route.id, edit: 'order' } } as Href);
      return;
    }
    if (route.status !== 'planned' || busy) return;
    void (async () => {
      setBusy(true);
      setMessage(null);
      try {
        await new ReopenRouteForPlanning(db).execute(route.id);
        await requestSync('mutation');
        router.push({ pathname: '/route/[id]/alternatives', params: { id: route.id } } as Href);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Eiliškumo redagavimo atidaryti nepavyko.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const removeAssignment = (assignment: ServerRouteAssignment) => {
    const localRoute = routes.find((route) => route.id === assignment.routeId);
    Alert.alert(
      'Pašalinti aktyvų priskyrimą?',
      `${assignmentRouteLabel(assignment)} · ${assignment.driverName}${assignment.vehicle ? ` · ${assignment.vehicle.registrationNumber}` : ''}. Priskyrimas bus pašalintas iš vairuotojo įrenginių${localRoute ? ', o susietas maršrutas – iš šio įrenginio' : ''}.`,
      [
        { text: 'Palikti', style: 'cancel' },
        {
          text: 'Pašalinti',
          style: 'destructive',
          onPress: () => { void (async () => {
            setBusy(true);
            setMessage(null);
            try {
              await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}`, { method: 'DELETE' });
              if (localRoute) {
                await new CancelDraftRoute(db).execute(localRoute.id);
                await markRouteDeletedForCloud(db, localRoute.id);
              }
              await requestSync('mutation');
              setMessage('Aktyvus priskyrimas pašalintas. Vairuotojo įrenginys pakeitimą gaus sinchronizacijos metu.');
              await load();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Priskyrimo pašalinti nepavyko.');
            } finally {
              setBusy(false);
            }
          })(); },
        },
      ],
    );
  };

  const openAssignmentEditor = (assignment: ServerRouteAssignment) => {
    setEditingAssignment(assignment);
    setEditingAssignmentDate(String(assignment.routeSnapshot.route.date ?? assignment.assignedAt.slice(0, 10)));
  };

  const saveAssignmentDate = async () => {
    if (!editingAssignment || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await employeeApi(`/api/admin/assignments/${encodeURIComponent(editingAssignment.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: editingAssignmentDate }),
      });
      const now = new Date().toISOString();
      await db.runAsync(
        `UPDATE routes
         SET date = ?,
             planned_departure_at = CASE
               WHEN planned_departure_at LIKE '____-__-__T%' THEN ? || substr(planned_departure_at, 11)
               ELSE planned_departure_at
             END,
             updated_at = ?
         WHERE id = ?`,
        editingAssignmentDate,
        editingAssignmentDate,
        now,
        editingAssignment.routeId,
      );
      setEditingAssignment(null);
      setMessage('Maršruto data pakeista. Vairuotojo įrenginys ją gaus sinchronizacijos metu.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Maršruto datos pakeisti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const selectedPrice = selectedRoute && selectedDriver && selectedVehicle
    ? estimatePreliminaryRoutePrice({
      date: selectedRoute.date,
      distanceKm: selectedRoute.estimated_distance_km,
      weightKg: selectedRoute.total_weight_kg,
      stops: selectedRoute.total_stops,
      driverName: selectedDriver.displayName,
      vehicle: selectedVehicle,
    }, priceSettings)
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Redaguoti maršrutus' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page} showsVerticalScrollIndicator>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.eyebrow}>DARBO VALDYMAS</Text>
            <Text style={styles.pageTitle}>Redaguoti maršrutus</Text>
            <Text style={styles.subtitle}>Pirmiausia pasirinkite maršrutą, tada jį peržiūrėkite, koreguokite arba priskirkite.</Text>
          </View>
          <View style={styles.topActions}>
            <Pressable style={styles.secondaryButton} onPress={() => void load()}><Text style={styles.secondaryText}>Atnaujinti</Text></Pressable>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/import' as Href)}><Text style={styles.primaryText}>+ Planuoti maršrutą</Text></Pressable>
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric emphasized label="Aktyvūs priskyrimai" value={activeAssignments.length} styles={styles} />
          <Metric label="Laisvi vairuotojai" value={freeDrivers.length} styles={styles} />
          <Metric label="Paruošti nepriskirti" value={assignableRoutes.length} styles={styles} />
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!online ? <Text style={styles.warning}>Prisijunkite prie interneto — priskyrimas vairuotojui saugomas serveryje.</Text> : null}

        {assignmentCompleted ? <View accessibilityRole="alert" style={styles.assignmentSuccess} testID="route-assignment-success">
          <Text style={styles.assignmentSuccessMark}>✓</Text>
          <View style={styles.assignmentSuccessCopy}>
            <Text style={styles.assignmentSuccessTitle}>Maršrutas priskirtas</Text>
            <Text style={styles.assignmentSuccessText}>{assignmentCompleted.routeLabel} → {assignmentCompleted.driverName} · {assignmentCompleted.vehicleNumber}</Text>
            <Text style={styles.assignmentSuccessHint}>Maršrutų sąraše iškart matysite vairuotoją, automobilį ir perdavimo būseną.</Text>
          </View>
          <Pressable onPress={() => {
            setAssignmentCompleted(null);
            setSelectedRouteId(null);
            setSelectedDriverId(null);
            setSelectedVehicleId(null);
          }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Priskirti kitą</Text></Pressable>
        </View> : null}

        {!assignmentCompleted && !selectedRoute ? <View style={styles.segmentedControl} testID="route-management-segments">
          <Pressable
            onPress={() => setActiveSegment('routes')}
            style={[styles.segmentButton, activeSegment === 'routes' && styles.segmentButtonActive]}
            testID="segment-routes">
            <Text style={[styles.segmentText, activeSegment === 'routes' && styles.segmentTextActive]}>Maršrutai</Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveSegment('active')}
            style={[styles.segmentButton, activeSegment === 'active' && styles.segmentButtonActive]}
            testID="segment-active">
            <Text style={[styles.segmentText, activeSegment === 'active' && styles.segmentTextActive]}>Aktyvūs priskyrimai{activeAssignments.length > 0 ? ` (${activeAssignments.length})` : ''}</Text>
          </Pressable>
        </View> : null}

        {!assignmentCompleted && !selectedRoute && activeSegment === 'routes' ? <View style={styles.routeSelectionPanel} testID="route-first-selection">
          <View style={styles.formHeading}>
            <View style={styles.formHeadingText}>
              <Text style={styles.panelTitle}>Pasirinkite maršrutą</Text>
              <Text style={styles.panelHint}>Pirmiausia pasirinkite darbą. Vairuotoją ir automobilį priskirsite kitame žingsnyje.</Text>
            </View>
            <Text style={styles.stepBadge}>{routes.length} maršrutai</Text>
          </View>

          {routes.length === 0 ? <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Maršrutų nėra</Text>
            <Text style={styles.panelHint}>Sukurkite pirmą maršrutą.</Text>
          </View> : <View style={[styles.routeChoiceGrid, desktop && styles.routeChoiceGridDesktop]}>
            {routes.map((route) => {
              const assignment = activeAssignments.find((item) => item.routeId === route.id);
              const canAssign = route.status === 'planned' && !assignment;
              return <View key={route.id} style={styles.routeChoiceCard}>
                <View style={styles.routeCardTop}>
                  <View style={styles.routeTitleBlock}>
                    <Text style={styles.routeCode}>{routeCodesLabel(route.route_codes)}</Text>
                    <Text style={styles.routeDate}>{formatDate(route.date)}</Text>
                  </View>
                  {requestedRouteId === route.id ? <Text style={styles.newRouteBadge}>Naujai paruoštas</Text> : <StatusBadge status={assignment ? effectiveAssignmentStatus(assignment) : route.status} styles={styles} />}
                </View>
                <Text style={styles.routeNumbers}>{route.total_stops} taškų · {Math.round(route.total_weight_kg)} kg · {formatKm(route.estimated_distance_km)}</Text>
                {assignment ? <Text style={styles.assignmentMeta}>{assignment.driverName}{assignment.vehicle ? ` · ${assignment.vehicle.registrationNumber}` : ' · automobilis nepriskirtas'}{assignmentLoadLabel(assignment, route.total_weight_kg)}</Text> : null}
                {(() => {
                  const canReorder = ['draft', 'planned', 'in_progress'].includes(route.status);
                  const canComplete = ['loading', 'loaded', 'in_progress'].includes(route.status);
                  const canDelete = ['draft', 'planned'].includes(route.status);
                  const primary = canAssign
                    ? { key: 'assign', label: 'Priskirti', onPress: () => selectRoute(route.id) }
                    : canComplete
                      ? { key: 'complete', label: 'Užbaigti', onPress: () => completeLocalRoute(route) }
                      : { key: 'view', label: 'Peržiūrėti', onPress: () => router.push({ pathname: '/route/[id]/overview', params: { id: route.id, mode: 'management' } } as Href) };
                  const overflow: { key: string; label: string; danger?: boolean; onPress: () => void }[] = [];
                  if (primary.key !== 'view') overflow.push({ key: 'view', label: 'Peržiūrėti', onPress: () => router.push({ pathname: '/route/[id]/overview', params: { id: route.id, mode: 'management' } } as Href) });
                  if (canReorder) overflow.push({ key: 'reorder', label: 'Keisti eiliškumą', onPress: () => editSequence(route) });
                  if (primary.key !== 'complete' && canComplete) overflow.push({ key: 'complete', label: 'Užbaigti', onPress: () => completeLocalRoute(route) });
                  if (canDelete) overflow.push({ key: 'delete', label: 'Ištrinti', danger: true, onPress: () => deleteRoute(route) });
                  const menuOpen = openCardMenuId === route.id;
                  return <View style={styles.cardActionsWrap}>
                    <View style={styles.routeCardActions}>
                      <Pressable
                        disabled={busy}
                        onPress={primary.onPress}
                        style={[canAssign ? styles.routePrimaryAction : styles.routeSecondaryAction, busy && styles.disabled]}>
                        <Text style={canAssign ? styles.routePrimaryActionText : styles.routeSecondaryActionText}>{primary.label}</Text>
                        {canAssign ? <ChevronRightIcon size={18} color={colors.textInverse} /> : null}
                      </Pressable>
                      {overflow.length > 0 ? <Pressable
                        accessibilityLabel="Daugiau veiksmų"
                        onPress={() => setOpenCardMenuId((current) => current === route.id ? null : route.id)}
                        style={styles.cardMenuButton}
                        testID={`route-card-menu-${route.id}`}>
                        <Text style={styles.cardMenuButtonText}>⋯</Text>
                      </Pressable> : null}
                    </View>
                    {menuOpen ? <View style={styles.cardMenuList} testID={`route-card-menu-list-${route.id}`}>
                      {overflow.map((action) => (
                        <Pressable
                          disabled={busy}
                          key={action.key}
                          onPress={() => { setOpenCardMenuId(null); action.onPress(); }}
                          style={[styles.cardMenuItem, busy && styles.disabled]}>
                          {action.key === 'delete' ? <TrashIcon size={16} color={colors.danger} /> : null}
                          <Text style={action.danger ? styles.cardMenuItemDangerText : styles.cardMenuItemText}>{action.label}</Text>
                        </Pressable>
                      ))}
                    </View> : null}
                  </View>;
                })()}
              </View>;
            })}
          </View>}
        </View> : null}

        {!assignmentCompleted && !selectedRoute && activeSegment === 'active' ? <View style={styles.activeAssignmentsPanel} testID="active-assignment-management">
          <View style={styles.formHeading}>
            <View style={styles.formHeadingText}>
              <Text style={styles.panelTitle}>Aktyvūs priskyrimai</Text>
              <Text style={styles.panelHint}>Čia rodomi ir kituose įrenginiuose sukurti darbai. Juos galima pašalinti net jei vietinio maršruto šiame įrenginyje nebėra.</Text>
            </View>
            <Text style={styles.stepBadge}>{activeAssignments.length}</Text>
          </View>
          {activeAssignments.length === 0 ? <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Aktyvių priskyrimų nėra</Text>
            <Text style={styles.panelHint}>Priskirkite maršrutą vairuotojui skiltyje „Maršrutai“.</Text>
          </View> : <View style={styles.activeAssignmentList}>
            {activeAssignments.map((assignment) => {
              const localRoute = routes.find((route) => route.id === assignment.routeId);
              const status = effectiveAssignmentStatus(assignment);
              return <View key={assignment.id} style={styles.activeAssignmentCard}>
                <View style={[styles.assignmentStatusBar, statusBarStyle(status, colors)]} />
                <View style={styles.assignmentContent}>
                  <View style={styles.assignmentTitleRow}>
                    <Text style={styles.activeAssignmentTitle}>{assignmentRouteLabel(assignment)}</Text>
                    <StatusBadge status={status} styles={styles} />
                  </View>
                  <Text style={styles.assignmentMeta}>{assignment.driverName}{assignment.vehicle ? ` · ${assignment.vehicle.registrationNumber} · ${assignment.vehicle.model}` : ' · automobilis nepriskirtas'}{assignmentLoadLabel(assignment, Number(assignment.routeSnapshot.route.total_weight_kg) || localRoute?.total_weight_kg || 0)}</Text>
                  <Text style={styles.routeEndpoint}>{localRoute ? 'Maršrutas yra šiame įrenginyje' : 'Vietinio maršruto šiame įrenginyje nėra'}</Text>
                </View>
                {(() => {
                  const overflow: { key: string; label: string; danger?: boolean; onPress: () => void }[] = [];
                  if (localRoute) overflow.push({ key: 'view', label: 'Peržiūrėti', onPress: () => router.push({ pathname: '/route/[id]/overview', params: { id: localRoute.id, mode: 'management' } } as Href) });
                  overflow.push({ key: 'edit', label: 'Redaguoti', onPress: () => openAssignmentEditor(assignment) });
                  overflow.push({ key: 'remove', label: 'Pašalinti priskyrimą', danger: true, onPress: () => removeAssignment(assignment) });
                  const menuOpen = openCardMenuId === assignment.id;
                  return <View style={styles.cardActionsWrap}>
                    <View style={styles.activeAssignmentActions}>
                      <Pressable
                        disabled={busy || !online}
                        onPress={() => localRoute ? completeLocalRoute(localRoute) : completeAssignment(assignment)}
                        style={[styles.routeCompleteAction, (busy || !online) && styles.disabled]}
                        testID={`complete-assignment-${assignment.id}`}>
                        <CheckIcon size={17} color={colors.textInverse} />
                        <Text style={styles.routeCompleteActionText}>Užbaigti</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Daugiau veiksmų"
                        disabled={!online}
                        onPress={() => setOpenCardMenuId((current) => current === assignment.id ? null : assignment.id)}
                        style={[styles.cardMenuButton, !online && styles.disabled]}
                        testID={`assignment-card-menu-${assignment.id}`}>
                        <Text style={styles.cardMenuButtonText}>⋯</Text>
                      </Pressable>
                    </View>
                    {menuOpen ? <View style={styles.cardMenuList} testID={`assignment-card-menu-list-${assignment.id}`}>
                      {overflow.map((action) => (
                        <Pressable
                          disabled={busy || !online}
                          key={action.key}
                          onPress={() => { setOpenCardMenuId(null); action.onPress(); }}
                          style={[styles.cardMenuItem, (busy || !online) && styles.disabled]}>
                          {action.key === 'remove' ? <TrashIcon size={16} color={colors.danger} /> : null}
                          <Text style={action.danger ? styles.cardMenuItemDangerText : styles.cardMenuItemText}>{action.label}</Text>
                        </Pressable>
                      ))}
                    </View> : null}
                  </View>;
                })()}
              </View>;
            })}
          </View>}
        </View> : null}

        {!assignmentCompleted && selectedRoute ? <View style={styles.assignmentForm} testID="route-assignment-form">
          <View style={styles.formHeading}>
            <View style={styles.formHeadingText}>
              <Text style={styles.panelTitle}>Priskirti pasirinktą maršrutą</Text>
              <Text style={styles.panelHint}>{routeCodesLabel(selectedRoute.route_codes)} · {formatDate(selectedRoute.date)} · {selectedRoute.total_stops} taškų · {Math.round(selectedRoute.total_weight_kg)} kg · {formatKm(selectedRoute.estimated_distance_km)}</Text>
            </View>
            <Pressable style={styles.changeRouteButton} onPress={() => selectRoute(null)}><Text style={styles.changeRouteText}>Keisti maršrutą</Text></Pressable>
          </View>

          <View style={[styles.selectorGrid, desktop && styles.selectorGridDesktop]}>

            <SelectionDropdown
              label="1. Vairuotojas"
              placeholder={drivers.length > 0 ? 'Pasirinkite vairuotoją' : 'Vairuotojų nėra'}
              primary={selectedDriver?.displayName}
              secondary={selectedDriver ? `@${selectedDriver.username}` : undefined}
              open={openPicker === 'driver'}
              onToggle={() => setOpenPicker((current) => current === 'driver' ? null : 'driver')}
              wide={desktop}
              styles={styles}>
              {drivers.length === 0 ? <Text style={styles.dropdownEmpty}>Pridėkite vairuotoją nustatymuose.</Text> : drivers.map((driver) => {
                const driverAssignments = activeAssignments.filter((item) => item.driverId === driver.id);
                return <Pressable
                  accessibilityRole="button"
                  key={driver.id}
                  onPress={() => { selectDriver(driver); setOpenPicker(null); }}
                  style={[styles.dropdownOption, selectedDriverId === driver.id && styles.dropdownOptionSelected]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials(driver.displayName)}</Text></View>
                  <View style={styles.dropdownOptionContent}>
                    <Text style={styles.dropdownOptionTitle}>{driver.displayName}</Text>
                    <Text style={styles.dropdownOptionMeta}>@{driver.username} · {driverAssignments.length > 0 ? `${driverAssignments.length} suplanuota` : 'laisvas'}</Text>
                  </View>
                  {selectedDriverId === driver.id ? <Text style={styles.selectedMark}>✓</Text> : null}
                </Pressable>;
              })}
            </SelectionDropdown>

            <SelectionDropdown
              label="2. Automobilis"
              placeholder={vehicles.length > 0 ? 'Pasirinkite automobilį' : 'Automobilių nėra'}
              primary={selectedVehicle ? `${selectedVehicle.registrationNumber} · ${selectedVehicle.model}` : undefined}
              secondary={selectedVehicle
                ? (selectedLoad
                  ? `Keliamoji galia ${Math.round(selectedVehicle.maximumPayloadKg)} kg · ${selectedLoad.summaryLabel}`
                  : `Keliamoji galia iki ${Math.round(selectedVehicle.maximumPayloadKg)} kg`)
                : undefined}
              open={openPicker === 'vehicle'}
              onToggle={() => setOpenPicker((current) => current === 'vehicle' ? null : 'vehicle')}
              wide={desktop}
              styles={styles}>
              {vehicles.length === 0 ? <Text style={styles.dropdownEmpty}>Pridėkite automobilį nustatymuose.</Text> : vehicles.map((vehicle) => {
                const load = describeVehicleLoad(selectedRoute.total_weight_kg, vehicle.maximumPayloadKg);
                return <Pressable
                  accessibilityRole="button"
                  key={vehicle.id}
                  onPress={() => { setSelectedVehicleId(vehicle.id); setOpenPicker(null); }}
                  style={[styles.dropdownOption, selectedVehicleId === vehicle.id && styles.dropdownOptionSelected]}>
                  <View style={styles.dropdownOptionContent}>
                    <Text style={styles.dropdownOptionTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text>
                    <Text style={[styles.dropdownOptionMeta, load?.overCapacity && styles.loadWarning]}>
                      Iki {Math.round(vehicle.maximumPayloadKg)} kg{load ? ` · apkrova ${load.percentLabel}` : ''}{vehicle.assignedDriverId === selectedDriverId ? ' · priskirtas pasirinktam vairuotojui' : ''}
                    </Text>
                  </View>
                  {selectedVehicleId === vehicle.id ? <Text style={styles.selectedMark}>✓</Text> : null}
                </Pressable>;
              })}
            </SelectionDropdown>
          </View>

          {selectedDriver && selectedVehicle ? <View style={styles.confirmationArea}>
            <View style={styles.confirmationSummary}>
              <Summary label="Bus priskirta" value={`${formatDate(selectedRoute.date)} · ${selectedRoute.total_stops} taškų → ${selectedDriver.displayName} · ${selectedVehicle.registrationNumber}`} styles={styles} />
              {selectedLoad ? <Summary label="Apkrova" value={`${selectedLoad.percentLabel} · ${selectedLoad.ratioLabel}`} styles={styles} testID="vehicle-load-percent" warning={selectedLoad.overCapacity} /> : null}
              {selectedPrice
                ? <PreliminaryPriceCard price={selectedPrice} styles={styles} />
                : <View style={styles.pricePending}><Text style={styles.pricePendingTitle}>Preliminari kaina dar neskaičiuojama</Text><Text style={styles.panelHint}>Maršrutui dar neapskaičiuotas atstumas.</Text></View>}
            </View>
            <Pressable disabled={busy || !online} onPress={() => void assign()} style={[styles.assignButton, (busy || !online) && styles.disabled]}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.assignText}>Priskirti maršrutą</Text>}
            </Pressable>
          </View> : <Text style={styles.selectionPrompt}>Pasirinkite vairuotoją ir automobilį. Niekas neparenkama automatiškai.</Text>}

          <View style={styles.managementLinks}>
            <Pressable style={styles.permissionsLink} onPress={() => router.push({ pathname: '/admin', params: { section: 'employees', returnTo: 'route-management' } } as Href)}><Text style={styles.permissionsText}>Redaguoti vairuotojus →</Text></Pressable>
            <Pressable style={styles.permissionsLink} onPress={() => router.push({ pathname: '/admin', params: { section: 'fleet', returnTo: 'route-management' } } as Href)}><Text style={styles.permissionsText}>Redaguoti automobilius →</Text></Pressable>
          </View>
        </View> : null}

      </ScrollView>
      <Modal animationType="fade" transparent visible={Boolean(editingAssignment)} onRequestClose={() => setEditingAssignment(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="assignment-date-editor">
            <View style={styles.modalHeader}>
              <View style={styles.formHeadingText}>
                <Text style={styles.panelTitle}>Redaguoti maršrutą</Text>
                <Text style={styles.panelHint}>{editingAssignment ? assignmentRouteLabel(editingAssignment) : ''}</Text>
              </View>
              <Pressable accessibilityLabel="Uždaryti" onPress={() => setEditingAssignment(null)} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
            </View>
            <View style={styles.modalField}>
              <Text style={styles.selectorLabel}>Maršruto data</Text>
              <DateInput value={editingAssignmentDate} onChangeText={setEditingAssignmentDate} style={styles.modalInput} testID="assignment-date-input" />
            </View>
            <Text style={styles.panelHint}>Datą galima keisti, kol vairuotojas maršruto dar nepradėjo.</Text>
            <View style={styles.modalActions}>
              <Pressable disabled={busy} onPress={() => setEditingAssignment(null)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
              <Pressable disabled={busy || !editingAssignmentDate} onPress={() => { void saveAssignmentDate(); }} style={[styles.primaryButton, (busy || !editingAssignmentDate) && styles.disabled]} testID="save-assignment-date">{busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Išsaugoti datą</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal animationType="fade" transparent visible={Boolean(completingRoute)} onRequestClose={() => setCompletingRoute(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="manual-route-completion">
            <View style={styles.modalHeader}>
              <View style={styles.formHeadingText}>
                <Text style={styles.panelTitle}>Rankiniu būdu užbaigti maršrutą</Text>
                <Text style={styles.panelHint}>{completingRoute ? `${routeCodesLabel(completingRoute.route_codes)} · ${formatDate(completingRoute.date)} · ${completingRoute.total_stops} taškų` : ''}</Text>
              </View>
              <Pressable accessibilityLabel="Uždaryti" onPress={() => setCompletingRoute(null)} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
            </View>
            <View style={styles.completionNotice}>
              <Text style={styles.completionNoticeTitle}>Bus pažymėta</Text>
              <Text style={styles.panelHint}>Visi dar neapdoroti taškai – pristatyti. Maršrutas – baigtas.</Text>
            </View>
            <View style={styles.modalField}>
              <Text style={styles.selectorLabel}>Galutinis odometras</Text>
              <TextInput value={completionOdometer} onChangeText={(value) => setCompletionOdometer(value.replace(/[^\d.,]/g, '').slice(0, 10))} keyboardType="decimal-pad" placeholder="Pvz. 675628" style={styles.modalInput} testID="manual-completion-odometer" />
            </View>
            <View style={styles.modalActions}>
              <Pressable disabled={busy} onPress={() => setCompletingRoute(null)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
              <Pressable disabled={busy || !completionOdometer.trim()} onPress={() => { void saveManualCompletion(); }} style={[styles.primaryButton, (busy || !completionOdometer.trim()) && styles.disabled]} testID="confirm-manual-completion">{busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Patvirtinti užbaigimą</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SelectionDropdown({
  label,
  placeholder,
  primary,
  secondary,
  open,
  onToggle,
  wide,
  children,
  styles,
}: {
  label: string;
  placeholder: string;
  primary?: string;
  secondary?: string;
  open: boolean;
  onToggle: () => void;
  wide: boolean;
  children: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={[styles.selector, wide && styles.selectorDesktop]}>
    <Text style={styles.selectorLabel}>{label}</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={[styles.selectorButton, open && styles.selectorButtonOpen]}>
      <View style={styles.selectorValue}>
        <Text numberOfLines={1} style={[styles.selectorPrimary, !primary && styles.selectorPlaceholder]}>{primary ?? placeholder}</Text>
        {secondary ? <Text numberOfLines={2} style={styles.selectorSecondary}>{secondary}</Text> : null}
      </View>
      <ChevronDownIcon size={20} />
    </Pressable>
    {open ? <ScrollView nestedScrollEnabled style={styles.dropdownList} contentContainerStyle={styles.dropdownListContent}>
      {children}
    </ScrollView> : null}
  </View>;
}

function assignmentLoadLabel(assignment: ServerRouteAssignment, weightKg: number): string {
  const load = assignment.vehicle
    ? describeVehicleLoad(weightKg, assignment.vehicle.maximumPayloadKg)
    : null;
  return load ? ` · ${load.summaryLabel}` : '';
}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { month: 'short', day: 'numeric', weekday: 'short' }).format(date); }
function routeCodesLabel(value: string | null): string {
  const codes = (value ?? '').split(',').map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]\d{2}$/.test(code));
  return [...new Set(codes)].join(' · ') || 'Regiono kodas nenurodytas';
}
function assignmentRouteLabel(assignment: ServerRouteAssignment): string {
  const regionCodes = uniqueRegionCodes(assignment.routeSnapshot.shipmentLines);
  const date = String(assignment.routeSnapshot.route.date ?? assignment.assignedAt.slice(0, 10));
  const stops = Number(assignment.routeSnapshot.route.total_stops ?? assignment.routeSnapshot.stops.length);
  return `${regionCodes.join(' · ') || 'Regiono kodas nenurodytas'} · ${formatDate(date)} · ${stops} taškų`;
}
function formatKm(value: number | null): string { return value === null ? 'atstumas dar neskaičiuotas' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value)} km`; }
function statusLabel(status: string): string { return ({ draft: 'Ruošiamas', planned: 'Paruoštas', assigned: 'Laukia vairuotojo', downloaded: 'Gautas įrenginyje', in_progress: 'Vykdomas', loading: 'Kraunamas', loaded: 'Pakrautas', completed: 'Baigtas' } as Record<string, string>)[status] ?? status; }
function statusTone(status: string): 'info' | 'warning' | 'success' | 'neutral' {
  if (status === 'completed') return 'success';
  if (['in_progress', 'loading', 'loaded'].includes(status)) return 'warning';
  if (['assigned', 'downloaded', 'planned'].includes(status)) return 'info';
  return 'neutral';
}
function statusBarStyle(status: string, colors: ColorPalette) {
  const tone = statusTone(status);
  return {
    backgroundColor: tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : tone === 'info' ? colors.info : colors.borderStrong,
  };
}
function Metric({ label, value, emphasized, styles }: { label: string; value: number; emphasized?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={[styles.metric, emphasized && styles.metricEmphasized]}><Text style={[styles.metricValue, emphasized && styles.metricValueEmphasized]}>{value}</Text><Text style={[styles.metricLabel, emphasized && styles.metricLabelEmphasized]}>{label}</Text></View>;
}
function StatusBadge({ status, styles }: { status: string; styles: ReturnType<typeof createStyles> }) {
  const tone = statusTone(status);
  return <Text style={[styles.statusBadge, tone === 'warning' && styles.statusBadgeWarning, tone === 'info' && styles.statusBadgeInfo, tone === 'neutral' && styles.statusBadgeNeutral]}>{statusLabel(status)}</Text>;
}
function Summary({ label, value, styles, testID, warning }: { label: string; value: string; styles: ReturnType<typeof createStyles>; testID?: string; warning?: boolean }) {
  return <View style={styles.summary} testID={testID}><Text style={styles.summaryLabel}>{label}</Text><Text style={[styles.summaryValue, warning && styles.loadWarning]}>{value}</Text></View>;
}
function PreliminaryPriceCard({ price, styles }: { price: PreliminaryRoutePrice; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.priceCard} testID="preliminary-route-price">
    <View style={styles.priceHeader}><View style={styles.priceContent}><Text style={styles.priceLabel}>PRELIMINARI MARŠRUTO KAINA</Text><Text style={styles.priceTotal}>{formatMoney(price.totalEur)}</Text></View><Text style={styles.priceSource}>{price.source === 'excel-vehicle' ? 'Excel automobilio tarifai' : 'Įvertinta pagal automobilio dydį'}</Text></View>
    <Text style={styles.priceBreakdown}>Kuras {formatMoney(price.fuelCostEur)} · automobilis {formatMoney(price.roadCostEur + price.insuranceCostEur)} · vairuotojas {formatMoney(price.driverCostEur)} · rezervas {formatMoney(price.overheadEur)}</Text>
    <Text style={styles.priceAssumptions}>{price.assumptions.join(' · ')}</Text>
  </View>;
}

function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  modalCard: { width: '100%', maxWidth: 560, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  modalCloseText: { fontSize: 26, lineHeight: 28, color: colors.textMuted },
  modalField: { gap: spacing.xs },
  completionNotice: { padding: spacing.md, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: colors.success, backgroundColor: colors.accentSoft, gap: 2 },
  completionNoticeTitle: { ...type.bodyStrong, color: colors.success },
  modalInput: { minHeight: 50, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, ...type.bodyStrong },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  scroll: { flex: 1, minWidth: 0 },
  page: { width: '100%', maxWidth: 1040, alignSelf: 'center', padding: spacing.xl, gap: spacing.lg },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg },
  eyebrow: { ...type.label, color: colors.textMuted },
  pageTitle: { ...type.pageTitle, color: colors.text, fontSize: 32, lineHeight: 38 },
  subtitle: { ...type.body, color: colors.textSecondary, marginTop: spacing.xs },
  topActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: 'center', backgroundColor: colors.actionPrimary },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  secondaryText: { ...type.button, color: colors.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { minWidth: 150, flexGrow: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  metricEmphasized: { backgroundColor: colors.infoSoft, borderColor: colors.info },
  metricValue: { ...type.sectionTitle, color: colors.text },
  metricValueEmphasized: { color: colors.info },
  metricLabel: { ...type.secondary, color: colors.textMuted },
  metricLabelEmphasized: { color: colors.info, fontFamily: type.secondaryStrong.fontFamily },
  message: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, color: colors.info },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  assignmentSuccess: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.accentSoft, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  assignmentSuccessMark: { width: 46, height: 46, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.success, color: colors.textInverse, fontSize: 28, lineHeight: 46, textAlign: 'center' },
  assignmentSuccessCopy: { flex: 1, minWidth: 260, gap: 3 },
  assignmentSuccessTitle: { ...type.sectionTitle, color: colors.success },
  assignmentSuccessText: { ...type.bodyStrong, color: colors.text },
  assignmentSuccessHint: { ...type.secondary, color: colors.textSecondary },
  workspace: { gap: 16 },
  workspaceDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  assignmentForm: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.lg },
  routeSelectionPanel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, gap: spacing.lg },
  activeAssignmentsPanel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, gap: spacing.md },
  activeAssignmentList: { gap: spacing.sm },
  activeAssignmentRow: { minHeight: 86, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  activeAssignmentCard: { overflow: 'hidden', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  assignmentStatusBar: { width: 4, alignSelf: 'stretch', minHeight: 48, borderRadius: radius.sm },
  assignmentTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  activeAssignmentTitle: { ...type.cardTitle, color: colors.text, flexShrink: 1 },
  activeAssignmentActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  routeChoiceGrid: { gap: spacing.md },
  routeChoiceGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
  routeChoiceCard: { minHeight: 174, flexGrow: 1, flexBasis: 360, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.sm },
  routeTitleBlock: { flex: 1, minWidth: 0, gap: 2 },
  routeCode: { ...type.sectionTitle, color: colors.text },
  newRouteBadge: { ...type.meta, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.infoSoft, color: colors.info },
  routeCardActions: { marginTop: 'auto', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  routeSecondaryAction: { minHeight: 44, flexGrow: 1, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  routeSecondaryActionText: { ...type.button, color: colors.text },
  routeEditAction: { minHeight: 44, flexGrow: 1, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.info, alignItems: 'center', justifyContent: 'center' },
  routeEditActionText: { ...type.button, color: colors.info },
  routeCompleteAction: { minHeight: 44, flexGrow: 1, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  routeCompleteActionText: { ...type.button, color: colors.textInverse },
  routePrimaryAction: { minHeight: 44, flexGrow: 1, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.actionPrimary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  routePrimaryActionText: { ...type.button, color: colors.textInverse },
  routeDeleteAction: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  routeDeleteActionText: { ...type.button, color: colors.danger },
  segmentedControl: { flexDirection: 'row', gap: spacing.xs, padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignSelf: 'flex-start' },
  segmentButton: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentButtonActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  segmentText: { ...type.button, color: colors.textMuted },
  segmentTextActive: { color: colors.text },
  cardActionsWrap: { marginTop: 'auto', gap: spacing.xs },
  cardMenuButton: { minWidth: 44, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cardMenuButtonText: { ...type.sectionTitle, color: colors.textSecondary, lineHeight: 20 },
  cardMenuList: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden' },
  cardMenuItem: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  cardMenuItemText: { ...type.button, color: colors.text },
  cardMenuItemDangerText: { ...type.button, color: colors.danger },
  changeRouteButton: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  changeRouteText: { ...type.button, color: colors.textSecondary },
  formHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  formHeadingText: { flex: 1, minWidth: 0, gap: 2 },
  stepBadge: { ...type.meta, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, overflow: 'hidden' },
  selectorGrid: { gap: spacing.md },
  selectorGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  selector: { flexGrow: 0, minWidth: 0, gap: spacing.xs },
  selectorDesktop: { flexGrow: 1, flexBasis: 0 },
  selectorLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  selectorButton: { minHeight: 66, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectorButtonOpen: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  selectorValue: { flex: 1, minWidth: 0, gap: 2 },
  selectorPrimary: { ...type.bodyStrong, color: colors.text },
  selectorPlaceholder: { color: colors.textMuted },
  selectorSecondary: { ...type.meta, color: colors.textMuted },
  dropdownList: { maxHeight: 276, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.surface },
  dropdownListContent: { padding: spacing.xs, gap: 4 },
  dropdownEmpty: { ...type.secondary, color: colors.textMuted, padding: spacing.md },
  dropdownOption: { minHeight: 58, padding: spacing.sm, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dropdownOptionSelected: { backgroundColor: colors.infoSoft },
  dropdownOptionContent: { flex: 1, minWidth: 0, gap: 2 },
  dropdownOptionTitle: { ...type.bodyStrong, color: colors.text },
  dropdownOptionMeta: { ...type.meta, color: colors.textMuted },
  loadWarning: { color: colors.warning },
  selectedMark: { ...type.bodyStrong, color: colors.info },
  confirmationArea: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  confirmationSummary: { flexGrow: 1, flexBasis: 480, minWidth: 0, gap: spacing.sm },
  selectionPrompt: { ...type.secondary, color: colors.textMuted, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  managementRouteRow: { minHeight: 70, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  managementRouteContent: { flex: 1, minWidth: 0, gap: spacing.xs },
  panel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  routePanel: { flexGrow: 1.05, flexBasis: 330, minWidth: 280 },
  driverPanel: { flexGrow: 1.15, flexBasis: 330, minWidth: 280 },
  vehiclePanel: { flexGrow: 0.9, flexBasis: 280, minWidth: 260 },
  actionPanel: { flexGrow: 1, flexBasis: 280, minWidth: 260 },
  panelHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  routeHeadingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  panelTitle: { ...type.sectionTitle, color: colors.text, fontSize: 19, lineHeight: 24 },
  panelHint: { ...type.secondary, color: colors.textMuted },
  countBadge: { minWidth: 30, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', textAlign: 'center', backgroundColor: colors.infoSoft, color: colors.info, fontFamily: type.secondaryStrong.fontFamily },
  empty: { paddingVertical: 24, gap: 5 },
  emptyTitle: { ...type.cardTitle, color: colors.text },
  routeCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  selectedCard: { borderColor: colors.info, borderWidth: 2, backgroundColor: colors.infoSoft },
  routeSelectArea: { padding: spacing.md, gap: spacing.sm },
  routeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  routeDate: { ...type.cardTitle, color: colors.text, fontSize: 16 },
  statusBadge: { ...type.meta, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.accentSoft, color: colors.success },
  statusBadgeInfo: { backgroundColor: colors.infoSoft, color: colors.info },
  statusBadgeWarning: { backgroundColor: colors.warningSoft, color: colors.warning },
  statusBadgeNeutral: { backgroundColor: colors.surfaceMuted, color: colors.textSecondary },
  routeNumbers: { ...type.bodyStrong, color: colors.textSecondary },
  assignmentMeta: { ...type.bodyStrong, color: colors.info },
  routeEndpoint: { ...type.secondary, color: colors.textMuted },
  manageButton: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  manageButtonActive: { backgroundColor: colors.text, borderColor: colors.text },
  manageButtonText: { ...type.secondaryStrong, color: colors.textSecondary },
  manageButtonTextActive: { color: colors.textInverse },
  manageHint: { ...type.secondary, color: colors.textSecondary, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.warningSoft },
  routeManagementActions: { minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface },
  routeManagementNote: { ...type.meta, flex: 1, color: colors.textMuted },
  deleteRouteButton: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface },
  deleteRouteText: { ...type.secondaryStrong, color: colors.danger },
  driverGrid: { gap: 9 },
  driverCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 10 },
  vehicleCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 4 },
  unavailable: { opacity: 0.5, backgroundColor: colors.disabledSurface },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft },
  avatarText: { ...type.bodyStrong, color: colors.info },
  driverText: { flex: 1, minWidth: 0 },
  driverName: { ...type.cardTitle, color: colors.text },
  availability: { ...type.meta, color: colors.success },
  busyText: { color: colors.warning },
  summary: { gap: 3, paddingVertical: 6 },
  summaryLabel: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  summaryValue: { ...type.bodyStrong, color: colors.text },
  priceCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, gap: spacing.sm },
  priceHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  priceContent: { flex: 1, minWidth: 0 },
  priceLabel: { ...type.label, color: colors.info },
  priceTotal: { ...type.readout, color: colors.text, fontSize: 27, lineHeight: 32, marginTop: 2 },
  priceSource: { ...type.meta, maxWidth: 115, textAlign: 'right', color: colors.textMuted },
  priceBreakdown: { ...type.secondaryStrong, color: colors.textSecondary },
  priceAssumptions: { ...type.meta, color: colors.textMuted },
  pricePending: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, gap: spacing.xs },
  pricePendingTitle: { ...type.bodyStrong, color: colors.text },
  assignButton: { minHeight: 54, minWidth: 220, flexGrow: 1, flexBasis: 220, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  assignText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  disabled: { opacity: 0.45 },
  permissionsLink: { minHeight: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  permissionsText: { ...type.button, color: colors.info },
  managementLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  assignmentsPanel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  assignmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  assignmentContent: { flex: 1, minWidth: 0, gap: 2 },
  assignmentPrice: { ...type.secondaryStrong, color: colors.info, marginTop: spacing.xs },
  assignmentStatusHelp: { padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.infoSoft, gap: 3 },
  assignmentStatusHelpText: { ...type.secondary, color: colors.textSecondary },
  assignmentStatusHelpStrong: { ...type.secondaryStrong, color: colors.text },
});
