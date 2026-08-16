import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { assignRouteToDriver } from '@/application/auth/route-assignment-sync';
import { effectiveAssignmentStatus, isActiveAssignment } from '@/application/auth/route-assignment-status';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import {
  DEFAULT_ROUTE_PRICE_SETTINGS,
  estimatePreliminaryRoutePrice,
  normalizeRoutePriceSettings,
  type PreliminaryRoutePrice,
  type RoutePriceSettings,
} from '@/application/routes/route-price';
import { markRouteDeletedForCloud } from '@/application/sync/route-cloud-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from '@/components/app-icons';
import { RoutePriceSettingsPanel } from '@/components/route-price-settings-panel';
import { employeeApi, type EmployeeProfile, type ServerFleetVehicle, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type LocalRoute = {
  id: string;
  date: string;
  status: string;
  total_stops: number;
  total_weight_kg: number;
  estimated_distance_km: number | null;
  estimated_duration_minutes: number | null;
  start_location_json: string | null;
  end_location_json: string | null;
};

export default function DispatcherScreen() {
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
  const [manageRoutes, setManageRoutes] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const [showPriceSettings, setShowPriceSettings] = useState(false);
  const [priceSettings, setPriceSettings] = useState<RoutePriceSettings>(() => normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assignmentCompleted, setAssignmentCompleted] = useState<{
    routeLabel: string;
    driverName: string;
    vehicleNumber: string;
  } | null>(null);

  const load = useCallback(async () => {
    const loadLocalRoutes = async () => {
      const localRoutes = await db.getAllAsync<LocalRoute>(
        `SELECT id, date, status, total_stops, total_weight_kg, estimated_distance_km,
                estimated_duration_minutes, start_location_json, end_location_json
         FROM routes
         WHERE status IN ('draft', 'planned')
           AND (owner_employee_id IS NULL OR owner_employee_id = ?)
         ORDER BY created_at DESC`,
        profile.id,
      );
      setRoutes(localRoutes);
      setSelectedRouteId((current) => requestedRouteId && localRoutes.some((route) => route.id === requestedRouteId && route.status === 'planned')
        ? requestedRouteId
        : current && localRoutes.some((route) => route.id === current && route.status === 'planned')
          ? current
          : localRoutes.find((route) => route.status === 'planned')?.id ?? null);
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

    if (availableDrivers && availableVehicles) {
      setSelectedDriverId((current) => {
        const driverId = current && availableDrivers.some((driver) => driver.id === current) ? current : availableDrivers[0]?.id ?? null;
        setSelectedVehicleId((vehicleId) => vehicleId && availableVehicles.some((vehicle) => vehicle.id === vehicleId)
          ? vehicleId
          : availableVehicles.find((vehicle) => vehicle.assignedDriverId === driverId)?.id ?? availableVehicles[0]?.id ?? null);
        return driverId;
      });
    }
    if (unavailable.length > 0) {
      setMessage(`Maršrutas išsaugotas, bet nepavyko atnaujinti ${unavailable.join(', ')} sąrašo. Paspauskite „Atnaujinti“ dar kartą.`);
    }
  }, [db, online, profile.id, requestSync, requestedRouteId]);

  useEffect(() => {
    if (!['admin', 'dispatcher'].includes(profile.role)) {
      router.replace('/' as Href);
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
  const selectDriver = (driver: EmployeeProfile) => {
    setSelectedDriverId(driver.id);
    const assignedVehicle = vehicles.find((vehicle) => vehicle.assignedDriverId === driver.id);
    if (assignedVehicle) setSelectedVehicleId(assignedVehicle.id);
  };

  useEffect(() => {
    setSelectedRouteId((current) => current && assignableRoutes.some((route) => route.id === current)
      ? current
      : assignableRoutes[0]?.id ?? null);
  }, [assignableRoutes]);
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
      setShowAssignments(true);
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
      <Stack.Screen options={{ title: 'Dispečerio skydelis' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page} showsVerticalScrollIndicator>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.eyebrow}>DARBO VALDYMAS</Text>
            <Text style={styles.pageTitle}>Maršrutų planavimas</Text>
            <Text style={styles.subtitle}>Paruoškite maršrutą ir perduokite jį konkrečiam vairuotojui.</Text>
          </View>
          <View style={styles.topActions}>
            <Pressable style={styles.secondaryButton} onPress={() => setShowPriceSettings((current) => !current)}><Text style={styles.secondaryText}>Kainos parametrai</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void load()}><Text style={styles.secondaryText}>Atnaujinti</Text></Pressable>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/import' as Href)}><Text style={styles.primaryText}>+ Planuoti maršrutą</Text></Pressable>
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric label="Aktyvūs priskyrimai" value={activeAssignments.length} styles={styles} />
          <Metric label="Laisvi vairuotojai" value={freeDrivers.length} styles={styles} />
          <Metric label="Paruošti nepriskirti" value={assignableRoutes.length} styles={styles} />
        </View>

        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!online ? <Text style={styles.warning}>Prisijunkite prie interneto — priskyrimas vairuotojui saugomas serveryje.</Text> : null}

        {showPriceSettings ? <RoutePriceSettingsPanel
          canEdit={profile.role === 'admin'}
          onClose={() => setShowPriceSettings(false)}
          onSaved={setPriceSettings}
          settings={priceSettings}
        /> : null}

        {assignmentCompleted ? <View accessibilityRole="alert" style={styles.assignmentSuccess} testID="route-assignment-success">
          <Text style={styles.assignmentSuccessMark}>✓</Text>
          <View style={styles.assignmentSuccessCopy}>
            <Text style={styles.assignmentSuccessTitle}>Maršrutas priskirtas</Text>
            <Text style={styles.assignmentSuccessText}>{assignmentCompleted.routeLabel} → {assignmentCompleted.driverName} · {assignmentCompleted.vehicleNumber}</Text>
            <Text style={styles.assignmentSuccessHint}>Įrašas jau rodomas „Aktyviuose priskyrimuose“. Būsena pasikeis, kai vairuotojo įrenginys maršrutą gaus.</Text>
          </View>
          <Pressable onPress={() => {
            setAssignmentCompleted(null);
            setSelectedRouteId(assignableRoutes[0]?.id ?? null);
            setSelectedDriverId(drivers[0]?.id ?? null);
            setSelectedVehicleId(vehicles.find((vehicle) => vehicle.assignedDriverId === drivers[0]?.id)?.id ?? vehicles[0]?.id ?? null);
          }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Priskirti kitą</Text></Pressable>
        </View> : <View style={styles.assignmentForm} testID="compact-assignment-form">
          <View style={styles.formHeading}>
            <View style={styles.formHeadingText}>
              <Text style={styles.panelTitle}>Priskirti maršrutą</Text>
              <Text style={styles.panelHint}>Pasirinkite tris reikšmes ir patvirtinkite.</Text>
            </View>
            <Text style={styles.stepBadge}>3 pasirinkimai</Text>
          </View>

          <View style={[styles.selectorGrid, desktop && styles.selectorGridDesktop]}>
            <SelectionDropdown
              label="1. Maršrutas"
              placeholder={routes.length > 0 ? 'Nėra paruošto nepriskirto maršruto' : 'Maršrutų nėra'}
              primary={selectedRoute ? `${formatDate(selectedRoute.date)} · ${selectedRoute.total_stops} taškų` : undefined}
              secondary={selectedRoute ? `Sandėlis: ${endpointLabel(selectedRoute.start_location_json)}` : undefined}
              open={openPicker === 'route'}
              onToggle={() => setOpenPicker((current) => current === 'route' ? null : 'route')}
              wide={desktop}
              styles={styles}>
              {assignableRoutes.length === 0 ? <Text style={styles.dropdownEmpty}>Pirmiausia užbaikite maršruto planavimą ir pasirinkite variantą.</Text> : assignableRoutes.map((route) => (
                <Pressable
                  accessibilityRole="button"
                  key={route.id}
                  onPress={() => { setSelectedRouteId(route.id); setOpenPicker(null); }}
                  style={[styles.dropdownOption, selectedRouteId === route.id && styles.dropdownOptionSelected]}>
                  <View style={styles.dropdownOptionContent}>
                    <Text style={styles.dropdownOptionTitle}>{formatDate(route.date)} · {route.total_stops} taškų</Text>
                    <Text numberOfLines={2} style={styles.dropdownOptionMeta}>{Math.round(route.total_weight_kg)} kg · {formatKm(route.estimated_distance_km)}{`\n`}{endpointLabel(route.start_location_json)} → {endpointLabel(route.end_location_json)}</Text>
                  </View>
                  {selectedRouteId === route.id ? <Text style={styles.selectedMark}>✓</Text> : null}
                </Pressable>
              ))}
            </SelectionDropdown>

            <SelectionDropdown
              label="2. Vairuotojas"
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
              label="3. Automobilis"
              placeholder={vehicles.length > 0 ? 'Pasirinkite automobilį' : 'Automobilių nėra'}
              primary={selectedVehicle ? `${selectedVehicle.registrationNumber} · ${selectedVehicle.model}` : undefined}
              secondary={selectedVehicle ? `Keliamoji galia iki ${Math.round(selectedVehicle.maximumPayloadKg)} kg` : undefined}
              open={openPicker === 'vehicle'}
              onToggle={() => setOpenPicker((current) => current === 'vehicle' ? null : 'vehicle')}
              wide={desktop}
              styles={styles}>
              {vehicles.length === 0 ? <Text style={styles.dropdownEmpty}>Pridėkite automobilį nustatymuose.</Text> : vehicles.map((vehicle) => (
                <Pressable
                  accessibilityRole="button"
                  key={vehicle.id}
                  onPress={() => { setSelectedVehicleId(vehicle.id); setOpenPicker(null); }}
                  style={[styles.dropdownOption, selectedVehicleId === vehicle.id && styles.dropdownOptionSelected]}>
                  <View style={styles.dropdownOptionContent}>
                    <Text style={styles.dropdownOptionTitle}>{vehicle.registrationNumber} · {vehicle.model}</Text>
                    <Text style={styles.dropdownOptionMeta}>Iki {Math.round(vehicle.maximumPayloadKg)} kg{vehicle.assignedDriverId === selectedDriverId ? ' · priskirtas pasirinktam vairuotojui' : ''}</Text>
                  </View>
                  {selectedVehicleId === vehicle.id ? <Text style={styles.selectedMark}>✓</Text> : null}
                </Pressable>
              ))}
            </SelectionDropdown>
          </View>

          {selectedRoute && selectedDriver && selectedVehicle ? <View style={styles.confirmationArea}>
            <View style={styles.confirmationSummary}>
              <Summary label="Bus priskirta" value={`${formatDate(selectedRoute.date)} · ${selectedRoute.total_stops} taškų → ${selectedDriver.displayName} · ${selectedVehicle.registrationNumber}`} styles={styles} />
              <Summary label="Sandėlis / pradžia" value={endpointLabel(selectedRoute.start_location_json)} styles={styles} />
              {selectedPrice
                ? <PreliminaryPriceCard price={selectedPrice} styles={styles} />
                : <View style={styles.pricePending}><Text style={styles.pricePendingTitle}>Preliminari kaina dar neskaičiuojama</Text><Text style={styles.panelHint}>Maršrutui dar neapskaičiuotas atstumas.</Text></View>}
            </View>
            <Pressable disabled={busy || !online} onPress={() => void assign()} style={[styles.assignButton, (busy || !online) && styles.disabled]}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.assignText}>Priskirti maršrutą</Text>}
            </Pressable>
          </View> : <Text style={styles.selectionPrompt}>Pasirinkite maršrutą, vairuotoją ir automobilį.</Text>}

          <View style={styles.managementLinks}>
            <Pressable style={styles.permissionsLink} onPress={() => router.push({ pathname: '/admin', params: { section: 'employees' } } as Href)}><Text style={styles.permissionsText}>Redaguoti vairuotojus →</Text></Pressable>
            <Pressable style={styles.permissionsLink} onPress={() => router.push({ pathname: '/admin', params: { section: 'fleet' } } as Href)}><Text style={styles.permissionsText}>Redaguoti automobilius →</Text></Pressable>
          </View>
        </View>}

        <CollapsibleSection
          count={routes.length}
          open={manageRoutes}
          onToggle={() => setManageRoutes((current) => !current)}
          subtitle="Ištrinkite nereikalingus ar pasikartojančius maršrutus"
          title="Tvarkyti maršrutus"
          styles={styles}>
          <Text style={styles.manageHint}>Vykdomi maršrutai yra apsaugoti. Ištrinant priskirtą maršrutą bus pašalintas ir jo priskyrimas.</Text>
          {routes.length === 0 ? <Text style={styles.panelHint}>Maršrutų nėra.</Text> : routes.map((route) => {
            const alreadyAssigned = activeAssignments.some((assignment) => assignment.routeId === route.id);
            const isWorking = ['loading', 'loaded', 'in_progress'].includes(route.status);
            return <View key={route.id} style={styles.managementRouteRow}>
              <View style={styles.managementRouteContent}>
                <View style={styles.routeCardTop}><Text style={styles.routeDate}>{formatDate(route.date)} · {route.total_stops} taškų</Text><StatusBadge status={alreadyAssigned ? 'assigned' : route.status} styles={styles} /></View>
                <Text numberOfLines={2} style={styles.routeEndpoint}>{Math.round(route.total_weight_kg)} kg · {formatKm(route.estimated_distance_km)} · {endpointLabel(route.start_location_json)} → {endpointLabel(route.end_location_json)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ištrinti ${formatDate(route.date)} maršrutą`}
                disabled={busy || isWorking}
                onPress={() => deleteRoute(route)}
                style={[styles.deleteRouteButton, (busy || isWorking) && styles.disabled]}>
                <TrashIcon size={18} color={colors.danger} />
                <Text style={styles.deleteRouteText}>Ištrinti</Text>
              </Pressable>
            </View>;
          })}
        </CollapsibleSection>

        <CollapsibleSection
          count={activeAssignments.length}
          open={showAssignments}
          onToggle={() => setShowAssignments((current) => !current)}
          subtitle="Peržiūrėkite šiuo metu vairuotojams perduotus darbus"
          title="Aktyvūs priskyrimai"
          styles={styles}>
          <View style={styles.assignmentStatusHelp}>
            <Text style={styles.assignmentStatusHelpText}><Text style={styles.assignmentStatusHelpStrong}>Laukia vairuotojo</Text> – maršrutas priskirtas, bet vairuotojo įrenginys jo dar negavo.</Text>
            <Text style={styles.assignmentStatusHelpText}><Text style={styles.assignmentStatusHelpStrong}>Gautas įrenginyje</Text> – vairuotojas prisijungė ir maršrutas jau išsaugotas jo programėlėje.</Text>
          </View>
          {activeAssignments.length === 0 ? <Text style={styles.panelHint}>Šiuo metu vairuotojams nieko nepriskirta.</Text> : activeAssignments.map((assignment) => {
            const price = assignmentPrice(assignment, priceSettings);
            return <View key={assignment.id} style={styles.assignmentRow}>
              <View style={styles.assignmentContent}>
                <Text style={styles.driverName}>{assignment.driverName}</Text>
                <Text style={styles.panelHint}>{formatDate(String(assignment.routeSnapshot.route.date ?? ''))} · {Number(assignment.routeSnapshot.route.total_stops ?? 0)} taškų{assignment.vehicle ? ` · ${assignment.vehicle.registrationNumber}` : ''}</Text>
                {price ? <Text style={styles.assignmentPrice}>Preliminari kaina · {formatMoney(price.totalEur)}</Text> : null}
              </View>
              <StatusBadge status={effectiveAssignmentStatus(assignment)} styles={styles} />
            </View>;
          })}
        </CollapsibleSection>
      </ScrollView>
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

function CollapsibleSection({
  title,
  subtitle,
  count,
  open,
  onToggle,
  children,
  styles,
}: {
  title: string;
  subtitle: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={styles.collapsibleSection}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={styles.collapsibleHeader}>
      <View style={styles.collapsibleIcon}>{open ? <ChevronDownIcon size={20} /> : <ChevronRightIcon size={20} />}</View>
      <View style={styles.collapsibleTitleArea}>
        <Text style={styles.panelTitle}>{title}</Text>
        <Text style={styles.panelHint}>{subtitle}</Text>
      </View>
      <Text style={styles.countBadge}>{count}</Text>
    </Pressable>
    {open ? <View style={styles.collapsibleContent}>{children}</View> : null}
  </View>;
}

function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { month: 'short', day: 'numeric', weekday: 'short' }).format(date); }
function formatKm(value: number | null): string { return value === null ? 'atstumas dar neskaičiuotas' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value)} km`; }
function endpointLabel(json: string | null): string { try { const value = JSON.parse(json ?? '{}') as { normalizedAddress?: string; originalAddress?: string }; return value.normalizedAddress ?? value.originalAddress ?? 'Nenurodyta'; } catch { return 'Nenurodyta'; } }
function statusLabel(status: string): string { return ({ draft: 'Ruošiamas', planned: 'Paruoštas', assigned: 'Laukia vairuotojo', downloaded: 'Gautas įrenginyje', in_progress: 'Vykdomas', loading: 'Kraunamas', loaded: 'Pakrautas' } as Record<string, string>)[status] ?? status; }
function Metric({ label, value, styles }: { label: string; value: number; styles: ReturnType<typeof createStyles> }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function StatusBadge({ status, styles }: { status: string; styles: ReturnType<typeof createStyles> }) { return <Text style={styles.statusBadge}>{statusLabel(status)}</Text>; }
function Summary({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) { return <View style={styles.summary}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function PreliminaryPriceCard({ price, styles }: { price: PreliminaryRoutePrice; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.priceCard} testID="preliminary-route-price">
    <View style={styles.priceHeader}><View style={styles.priceContent}><Text style={styles.priceLabel}>PRELIMINARI MARŠRUTO KAINA</Text><Text style={styles.priceTotal}>{formatMoney(price.totalEur)}</Text></View><Text style={styles.priceSource}>{price.source === 'excel-vehicle' ? 'Excel automobilio tarifai' : 'Įvertinta pagal automobilio dydį'}</Text></View>
    <Text style={styles.priceBreakdown}>Kuras {formatMoney(price.fuelCostEur)} · automobilis {formatMoney(price.roadCostEur + price.insuranceCostEur)} · vairuotojas {formatMoney(price.driverCostEur)} · rezervas {formatMoney(price.overheadEur)}</Text>
    <Text style={styles.priceAssumptions}>{price.assumptions.join(' · ')}</Text>
  </View>;
}

function assignmentPrice(assignment: ServerRouteAssignment, settings: RoutePriceSettings): PreliminaryRoutePrice | null {
  if (!assignment.vehicle) return null;
  const route = assignment.routeSnapshot.route;
  return estimatePreliminaryRoutePrice({
    date: String(route.date ?? assignment.assignedAt.slice(0, 10)),
    distanceKm: nullableNumber(route.estimated_distance_km),
    weightKg: Number(route.total_weight_kg ?? 0),
    stops: Number(route.total_stops ?? assignment.routeSnapshot.stops.length),
    driverName: assignment.driverName,
    vehicle: assignment.vehicle,
  }, settings);
}

function nullableNumber(value: unknown): number | null { const parsed = Number(value); return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed; }
function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
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
  metric: { minWidth: 150, flexGrow: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  metricValue: { ...type.sectionTitle, color: colors.info },
  metricLabel: { ...type.secondary, color: colors.textMuted },
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
  selectedMark: { ...type.bodyStrong, color: colors.info },
  confirmationArea: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  confirmationSummary: { flexGrow: 1, flexBasis: 480, minWidth: 0, gap: spacing.sm },
  selectionPrompt: { ...type.secondary, color: colors.textMuted, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  collapsibleSection: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  collapsibleHeader: { minHeight: 72, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapsibleIcon: { width: 28, alignItems: 'center' },
  collapsibleTitleArea: { flex: 1, minWidth: 0, gap: 2 },
  collapsibleContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
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
  routeNumbers: { ...type.bodyStrong, color: colors.textSecondary },
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

