import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { canApproveExpiredDeparture } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import {
    approveExpiredDepartureOverride,
    pullDepartureOverride,
    requestExpiredDepartureOverride,
} from '@/application/operations/departure-readiness';
import { reportVehicleFault } from '@/application/operations/vehicle-fault-report';
import { PencilIcon, TrashIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import { VehicleDepartureOverrideRepository } from '@/database/repositories/vehicle-departure-override-repository';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import { evaluateDepartureReadiness, type DepartureOverrideInput } from '@/domain/departure-readiness';
import { parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import type { FuelType, VehicleFault } from '@/domain/vehicle-and-trip';
import { employeeApi, type EmployeeProfile, type FuelStatus, type ServerFleetVehicle, type ServerFleetVehicleSnapshot, type ServerFuelEntry, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const fuelOptions: { value: FuelType; label: string }[] = [
  { value: 'diesel', label: 'Dyzelinas' },
  { value: 'petrol', label: 'Benzinas' },
  { value: 'electric', label: 'Elektra' },
  { value: 'hybrid', label: 'Hibridas' },
  { value: 'lpg', label: 'Dujos' },
  { value: 'other', label: 'Kita' },
];

export default function VehicleScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { section = 'terms' } = useLocalSearchParams<{ section?: 'terms' | 'odometer' | 'fuel' }>();
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const faults = useMemo(() => new VehicleFaultRepository(db), [db]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('Darbinis automobilis');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [inspectionDueOn, setInspectionDueOn] = useState('');
  const [roadTaxDueOn, setRoadTaxDueOn] = useState('');
  const [insuranceDueOn, setInsuranceDueOn] = useState('');
  const [serviceDueOn, setServiceDueOn] = useState('');
  const [serviceOdometer, setServiceOdometer] = useState('');
  const [faultComment, setFaultComment] = useState('');
  const [openFaults, setOpenFaults] = useState<VehicleFault[]>([]);
  const [override, setOverride] = useState<DepartureOverrideInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fleetVehicles, setFleetVehicles] = useState<(ServerFleetVehicle | ServerFleetVehicleSnapshot)[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [vehicleReadings, setVehicleReadings] = useState<ServerTripSheet[]>([]);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [editingReadingStart, setEditingReadingStart] = useState('');
  const [editingReadingEnd, setEditingReadingEnd] = useState('');
  const [editingReadingDriverId, setEditingReadingDriverId] = useState('');
  const [fuelDate, setFuelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fuelLiters, setFuelLiters] = useState('');
  const [fuelReceipt, setFuelReceipt] = useState('');
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const canApprove = canApproveExpiredDeparture(profile);

  const applyVehicle = useCallback(async (vehicleId: string) => {
    const fleetVehicle = fleetVehicles.find((vehicle) => vehicle.id === vehicleId);
    if (!fleetVehicle) return;
    const local = await repository.getVehicleById(vehicleId) ?? await repository.saveVehicle({
      id: vehicleId,
      name: fleetVehicle.model,
      registrationNumber: fleetVehicle.registrationNumber,
      fuelType: 'diesel',
    });
    setSelectedVehicleId(vehicleId);
    setName(fleetVehicle.model);
    setRegistrationNumber(fleetVehicle.registrationNumber);
    setFuelType(local?.fuelType ?? 'diesel');
    setInspectionDueOn(local?.technicalInspectionDueOn ?? '');
    setRoadTaxDueOn(local?.roadTaxDueOn ?? '');
    setInsuranceDueOn(local?.insuranceDueOn ?? '');
    setServiceDueOn(local?.nextServiceDueOn ?? '');
    setServiceOdometer(local?.nextServiceOdometer === null || local?.nextServiceOdometer === undefined ? '' : String(local.nextServiceOdometer));
    setOpenFaults(await faults.listOpen(vehicleId));
    const saved = await new VehicleDepartureOverrideRepository(db).getLatest(vehicleId);
    setOverride(saved ? { status: saved.status, fingerprint: saved.fingerprint } : null);
    if (online) {
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets').catch(() => ({ tripSheets: [] }));
      setVehicleReadings(response.tripSheets.filter((sheet) => sheet.vehicle?.id === vehicleId).sort((a, b) => b.date.localeCompare(a.date)));
    }
  }, [db, faults, fleetVehicles, online, repository]);

  const editReading = (reading: ServerTripSheet) => {
    setEditingReadingId(reading.assignmentId);
    setEditingReadingStart(reading.startOdometer == null ? '' : String(reading.startOdometer));
    setEditingReadingEnd(reading.endOdometer == null ? '' : String(reading.endOdometer));
    setEditingReadingDriverId(reading.driverId || 'none');
  };

  const saveReading = async (reading: ServerTripSheet) => {
    if (busy) return;
    setBusy(true);
    try {
      const start = Number(editingReadingStart.replace(',', '.'));
      const end = Number(editingReadingEnd.replace(',', '.'));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Patikrinkite odometro pradžią ir pabaigą.');
      const driverId = editingReadingDriverId === 'none' ? null : editingReadingDriverId || undefined;
      if (parseVehicleDayAssignmentId(reading.assignmentId)) {
        await employeeApi('/api/trip-sheets/day-readings', { method: 'POST', body: JSON.stringify({ vehicleId: selectedVehicleId, date: reading.date, startOdometer: start, endOdometer: end, driverId }) });
      } else {
        await employeeApi(`/api/trip-sheets/${encodeURIComponent(reading.assignmentId)}`, { method: 'PATCH', body: JSON.stringify({ startOdometer: start, endOdometer: end, driverId: driverId ?? undefined }) });
      }
      setEditingReadingId(null); setMessage('Dienos odometras ir vairuotojas išsaugoti.');
      await applyVehicle(selectedVehicleId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Odometro išsaugoti nepavyko.');
    } finally { setBusy(false); }
  };

  const deleteReading = (reading: ServerTripSheet) => {
    const vehicleDay = parseVehicleDayAssignmentId(reading.assignmentId);
    if (!vehicleDay) {
      setMessage('Tik atskirą dienos odometro įrašą galima ištrinti. Tikras maršrutas saugomas istorijoje.');
      return;
    }
    Alert.alert('Ištrinti dienos įrašą?', `${reading.date} · ${reading.startOdometer ?? '—'} → ${reading.endOdometer ?? '—'} km`, [
      { text: 'Atšaukti', style: 'cancel' },
      { text: 'Ištrinti', style: 'destructive', onPress: () => { void (async () => {
        setBusy(true);
        try {
          await employeeApi(`/api/admin/trip-sheets/unassigned-day/${encodeURIComponent(selectedVehicleId)}/${encodeURIComponent(reading.date)}`, { method: 'DELETE' });
          setMessage('Dienos odometro įrašas ištrintas.');
          await applyVehicle(selectedVehicleId);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Įrašo ištrinti nepavyko.'); }
        finally { setBusy(false); }
      })(); } },
    ]);
  };


  const vehicleFuelEntries = vehicleReadings.flatMap((reading) => reading.fuelEntries ?? []).filter((entry) => entry.vehicleId === selectedVehicleId);
  const saveFuel = async () => {
    if (busy) return;
    const liters = Number(fuelLiters.replace(',', '.'));
    if (!Number.isFinite(liters) || liters <= 0) { setMessage('Įveskite įpiltų litrų kiekį.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fuelDate)) { setMessage('Įveskite datą formatu YYYY-MM-DD.'); return; }
    setBusy(true);
    try {
      const body = { filledAt: new Date(`${fuelDate}T12:00:00`).toISOString(), liters, receiptNumber: fuelReceipt.trim() || null };
      if (editingFuelId) {
        await employeeApi(`/api/fuel-entries/${encodeURIComponent(editingFuelId)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const reading = vehicleReadings.find((item) => item.date === fuelDate) ?? vehicleReadings[0];
        if (!reading) throw new Error('Šiai datai nėra odometro įrašo. Pirmiausia įrašykite dienos odometrą.');
        await employeeApi(`/api/trip-sheets/${encodeURIComponent(reading.assignmentId)}/fuel-entries`, { method: 'POST', body: JSON.stringify({ ...body, odometer: reading.endOdometer ?? reading.startOdometer ?? 0 }) });
      }
      setFuelLiters(''); setFuelReceipt(''); setEditingFuelId(null); setMessage('Kuro įrašas išsaugotas.');
      await applyVehicle(selectedVehicleId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Kuro įrašo išsaugoti nepavyko.'); }
    finally { setBusy(false); }
  };
  const deleteFuel = async (entry: ServerFuelEntry) => {
    setBusy(true);
    try { await employeeApi(`/api/fuel-entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }); setMessage('Kuro įrašas ištrintas.'); await applyVehicle(selectedVehicleId); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Kuro įrašo ištrinti nepavyko.'); }
    finally { setBusy(false); }
  };
  const confirmDeleteFuel = (entry: ServerFuelEntry) => {
    Alert.alert('Ištrinti kuro pylimą?', `${new Date(entry.filledAt).toLocaleDateString('lt-LT')} · ${entry.liters} l`, [
      { text: 'Atšaukti', style: 'cancel' },
      { text: 'Ištrinti', style: 'destructive', onPress: () => { void deleteFuel(entry); } },
    ]);
  };

  const load = useCallback(async () => {
    let available: (ServerFleetVehicle | ServerFleetVehicleSnapshot)[] = [];
    if (online) {
      if (profile.role === 'admin' || profile.role === 'dispatcher' || profile.permissions?.canEnterTripReadings) {
        const response = await employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users').catch(() => ({ users: [] }));
        setDrivers(response.users.filter((user) => user.role === 'driver' && !user.disabled));
      }
      if (profile.role === 'admin' || profile.role === 'dispatcher') {
        available = (await employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles')).vehicles;
      } else if (profile.role === 'driver') {
        const status = await employeeApi<FuelStatus>('/api/fuel-status');
        available = status.vehicle ? [status.vehicle] : [];
      }
    }
    setFleetVehicles(available);
    const preferred = available.find((vehicle) => 'assignedDriverId' in vehicle && vehicle.assignedDriverId === profile.id) ?? available[0];
    if (preferred) {
      const local = await repository.getVehicleById(preferred.id) ?? await repository.saveVehicle({
        id: preferred.id,
        name: preferred.model,
        registrationNumber: preferred.registrationNumber,
        fuelType: 'diesel',
      });
      setSelectedVehicleId(preferred.id);
      setName(preferred.model);
      setRegistrationNumber(preferred.registrationNumber);
      setFuelType(local?.fuelType ?? 'diesel');
      setInspectionDueOn(local?.technicalInspectionDueOn ?? '');
      setRoadTaxDueOn(local?.roadTaxDueOn ?? '');
      setInsuranceDueOn(local?.insuranceDueOn ?? '');
      setServiceDueOn(local?.nextServiceDueOn ?? '');
      setServiceOdometer(local?.nextServiceOdometer === null || local?.nextServiceOdometer === undefined ? '' : String(local.nextServiceOdometer));
      setOpenFaults(await faults.listOpen(preferred.id));
      const saved = await new VehicleDepartureOverrideRepository(db).getLatest(preferred.id);
      setOverride(saved ? { status: saved.status, fingerprint: saved.fingerprint } : null);
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets').catch(() => ({ tripSheets: [] }));
      setVehicleReadings(response.tripSheets.filter((sheet) => sheet.vehicle?.id === preferred.id).sort((a, b) => b.date.localeCompare(a.date)));
      return;
    }
    const vehicle = await repository.getVehicle();
    if (!vehicle) return;
    setSelectedVehicleId(vehicle.id);
    setName(vehicle.name);
    setRegistrationNumber(vehicle.registrationNumber === 'NENURODYTA' ? '' : vehicle.registrationNumber);
    setFuelType(vehicle.fuelType);
    setInspectionDueOn(vehicle.technicalInspectionDueOn ?? '');
    setRoadTaxDueOn(vehicle.roadTaxDueOn ?? '');
    setInsuranceDueOn(vehicle.insuranceDueOn ?? '');
    setServiceDueOn(vehicle.nextServiceDueOn ?? '');
    setServiceOdometer(vehicle.nextServiceOdometer === null ? '' : String(vehicle.nextServiceOdometer));
    setOpenFaults(await faults.listOpen(vehicle.id));
    if (online) {
      await pullDepartureOverride(db).catch(() => undefined);
    }
    const saved = await new VehicleDepartureOverrideRepository(db).getLatest(vehicle.id);
    setOverride(saved ? { status: saved.status, fingerprint: saved.fingerprint } : null);
  }, [db, faults, online, profile.id, profile.permissions?.canEnterTripReadings, profile.role, repository]);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Automobilio duomenų atkurti nepavyko.'));
  }, [load]);

  const preview = evaluateDepartureReadiness({
    vehicle: {
      id: selectedVehicleId || 'preview',
      registrationNumber,
      technicalInspectionDueOn: inspectionDueOn || null,
      roadTaxDueOn: roadTaxDueOn || null,
      nextServiceDueOn: serviceDueOn || null,
    },
    faults: openFaults,
    override,
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const odometer = serviceOdometer.trim() ? Number(serviceOdometer.replace(',', '.')) : null;
      if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) {
        throw new Error('Priežiūros odometras turi būti teigiamas skaičius.');
      }
      if (!selectedVehicleId) throw new Error('Pasirinkite automobilį iš parko.');
      await repository.saveVehicle({
        id: selectedVehicleId,
        name,
        registrationNumber,
        fuelType,
        technicalInspectionDueOn: inspectionDueOn,
        roadTaxDueOn,
        insuranceDueOn,
        nextServiceDueOn: serviceDueOn,
        nextServiceOdometer: odometer,
      });
      setMessage('Transporto priemonė išsaugota. Tušti terminai darbo nestabdo.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const addFault = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const vehicle = selectedVehicleId ? await repository.getVehicleById(selectedVehicleId) : null;
      if (!vehicle) throw new Error('Pasirinkite automobilį iš parko.');
      await reportVehicleFault(db, {
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        comment: faultComment,
        reportedBy: profile.id,
      }, online);
      setFaultComment('');
      setMessage(online
        ? 'Neskubus gedimas išsaugotas ir perduotas administracijai. Važiuoti galima.'
        : 'Neskubus gedimas išsaugotas. Prisijungus jis bus perduotas administracijai.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gedimo išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const requestOverride = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestExpiredDepartureOverride(db, { requestedBy: profile.id, online });
      setMessage(online
        ? 'Prašymas išsiųstas administratoriui. Kol nepatvirtinta, važiuoti negalima.'
        : 'Prašymas išsaugotas šiame įrenginyje. Prisijungus jis bus perduotas administratoriui.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Prašymo išsiųsti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const approveOverride = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await approveExpiredDepartureOverride(db, { approvedBy: profile.id, online });
      setMessage('Patvirtinta: su šiais pasibaigusiais terminais važiuoti galima.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Patvirtinti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Automobilio priežiūra"
      description="Pirmiausia pasirinkite automobilį iš jau suvesto parko. Čia nekuriamas antras automobilio įrašas.">
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Automobilis iš parko</Text>
        {fleetVehicles.length === 0 ? <Text style={styles.warnText}>Priskirto arba suvesto automobilio nėra. Pirmiausia pridėkite jį skiltyje „Automobiliai“.</Text> : null}
        <View style={styles.vehicleChoices}>
          {fleetVehicles.map((vehicle) => <Pressable
            key={vehicle.id}
            onPress={() => { void applyVehicle(vehicle.id); }}
            style={[styles.vehicleChoice, selectedVehicleId === vehicle.id && styles.vehicleChoiceSelected]}
            testID={`select-maintenance-vehicle-${vehicle.id}`}>
            <Text style={[styles.vehicleChoiceTitle, selectedVehicleId === vehicle.id && styles.vehicleChoiceTitleSelected]}>{vehicle.registrationNumber}</Text>
            <Text style={[styles.vehicleChoiceMeta, selectedVehicleId === vehicle.id && styles.vehicleChoiceMetaSelected]}>{vehicle.model}</Text>
          </Pressable>)}
        </View>
        {selectedVehicleId ? <Text style={styles.selectedVehicle}>Pasirinkta: {registrationNumber} · {name}</Text> : null}
        {selectedVehicleId && section === 'odometer' ? <View style={styles.odometerPanel} testID="vehicle-odometer-editor">
          <Text style={styles.sectionTitle}>Dienos odometras</Text>
          <Text style={styles.hint}>Taisykite jau įvestą dieną tiesiog jos eilutėje: pradžią, pabaigą ir kas vairavo.</Text>
          {vehicleReadings.map((reading) => {
            const editing = editingReadingId === reading.assignmentId;
            return <View key={reading.assignmentId} style={styles.readingCard}>
              <View style={styles.readingDisplayRow}><View style={styles.readingHeader}><View style={styles.readingMain}><Text style={styles.readingTitle}>{reading.date}</Text><Text style={styles.hint}>{reading.startOdometer ?? '—'} → {reading.endOdometer ?? '—'} km</Text></View><Text style={styles.hint}>{reading.driverName || 'Nepriskirtas'}</Text></View>
                {!editing ? <View style={styles.readingActions}><Pressable accessibilityLabel={`Redaguoti ${reading.date}`} onPress={() => editReading(reading)} style={styles.iconButton}><PencilIcon size={18} color={colors.warning} /></Pressable><Pressable accessibilityLabel={`Ištrinti ${reading.date}`} onPress={() => deleteReading(reading)} style={styles.iconButton}><TrashIcon size={18} color={colors.danger} /></Pressable></View> : null}
              </View>
              {editing ? <>
                <View style={styles.inlineInputs}>
                  <TextInput value={editingReadingStart} onChangeText={setEditingReadingStart} keyboardType="decimal-pad" style={[styles.input, styles.inlineInput]} placeholder="Pradžia" placeholderTextColor={colors.textMuted} />
                  <TextInput value={editingReadingEnd} onChangeText={setEditingReadingEnd} keyboardType="decimal-pad" style={[styles.input, styles.inlineInput]} placeholder="Pabaiga" placeholderTextColor={colors.textMuted} />
                </View>
                <View style={styles.options}>{drivers.map((driver) => <Pressable key={driver.id} onPress={() => setEditingReadingDriverId(driver.id)} style={[styles.option, editingReadingDriverId === driver.id && styles.optionSelected]}><Text style={[styles.optionText, editingReadingDriverId === driver.id && styles.optionTextSelected]}>{driver.displayName}</Text></Pressable>)}</View>
                <View style={styles.entryActions}><Pressable disabled={busy || !online} onPress={() => { void saveReading(reading); }} style={[styles.buttonSmall, (busy || !online) && styles.disabled]}><Text style={styles.buttonText}>Išsaugoti</Text></Pressable><Pressable onPress={() => setEditingReadingId(null)} style={styles.secondaryButtonSmall}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable></View>
              </> : null}
            </View>;
          })}
        </View> : null}
        {selectedVehicleId && section === 'fuel' ? <View style={styles.odometerPanel} testID="vehicle-fuel-editor">
          <Text style={styles.sectionTitle}>Kuras ir papildymai</Text>
          <TextInput value={fuelDate} onChangeText={setFuelDate} style={styles.input} placeholder="Data, YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
          <View style={styles.inlineInputs}>
            <TextInput value={fuelLiters} onChangeText={setFuelLiters} keyboardType="decimal-pad" style={[styles.input, styles.inlineInput]} placeholder="Įpilta, l" placeholderTextColor={colors.textMuted} />
            <TextInput value={fuelReceipt} onChangeText={setFuelReceipt} style={[styles.input, styles.inlineInput]} placeholder="Čekio Nr. (nebūtina)" placeholderTextColor={colors.textMuted} />
          </View>
          <Pressable disabled={busy || !online} onPress={() => { void saveFuel(); }} style={[styles.button, (busy || !online) && styles.disabled]}><Text style={styles.buttonText}>{editingFuelId ? 'Išsaugoti kuro pakeitimą' : 'Įrašyti papildymą'}</Text></Pressable>
          {vehicleFuelEntries.slice(0, 8).map((entry) => <View key={entry.id} style={styles.fuelReadingRow}><View style={styles.fuelReadingMain}><Text style={styles.readingTitle}>{new Date(entry.filledAt).toLocaleDateString('lt-LT')}</Text><Text style={styles.hint}>{entry.liters} l{entry.receiptNumber ? ` · čekis ${entry.receiptNumber}` : ''}</Text></View><View style={styles.readingActions}><Pressable accessibilityLabel={`Redaguoti kuro pylimą ${entry.id}`} onPress={() => { setEditingFuelId(entry.id); setFuelDate(entry.filledAt.slice(0, 10)); setFuelLiters(String(entry.liters)); setFuelReceipt(entry.receiptNumber ?? ''); }} style={styles.iconButton}><PencilIcon size={18} color={colors.warning} /></Pressable><Pressable accessibilityLabel={`Ištrinti kuro pylimą ${entry.id}`} disabled={busy} onPress={() => confirmDeleteFuel(entry)} style={styles.iconButton}><TrashIcon size={18} color={colors.danger} /></Pressable></View></View>)}
        </View> : null}
        {section === 'terms' ? <Text style={styles.label}>Kuro rūšis</Text> : null}
        {section === 'terms' ? <View style={styles.options}>
          {fuelOptions.map((option) => (
            <Pressable key={option.value} onPress={() => setFuelType(option.value)} style={[styles.option, fuelType === option.value && styles.optionSelected]}>
              <Text style={[styles.optionText, fuelType === option.value && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View> : null}
      </View>
      {section === 'terms' ? <View style={styles.card} testID="vehicle-compliance-card">
        <Text style={styles.sectionTitle}>Priežiūros terminai</Text>
        <Text style={styles.hint}>Datos formatu YYYY-MM-DD. Tuščia data nestoja darbo. Suvedus ir pasibaigus – važiuoti neleis, kol administratorius nepatvirtins.</Text>
        <Text style={styles.label}>Techninė apžiūra iki</Text>
        <TextInput value={inspectionDueOn} onChangeText={setInspectionDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-inspection-due" />
        <Text style={styles.label}>Kelių mokestis iki</Text>
        <TextInput value={roadTaxDueOn} onChangeText={setRoadTaxDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-road-tax-due" />
        <Text style={styles.label}>Draudimas iki</Text>
        <TextInput value={insuranceDueOn} onChangeText={setInsuranceDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-insurance-due" />
        <Text style={styles.label}>Tepalai / servisas iki</Text>
        <TextInput value={serviceDueOn} onChangeText={setServiceDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-service-due" />
        <Text style={styles.label}>Priežiūros odometras (nebūtina)</Text>
        <TextInput value={serviceOdometer} onChangeText={setServiceOdometer} keyboardType="decimal-pad" style={styles.input} placeholder="Pvz. 185000" placeholderTextColor={colors.textMuted} />
        {preview.blockers.map((issue) => (
          <Text key={issue.code} style={styles.blockText}>{issue.message}</Text>
        ))}
        {preview.warnings.filter((issue) => issue.code !== 'OPEN_NON_URGENT_FAULT').map((issue) => (
          <Text key={issue.code} style={styles.warnText}>{issue.message}</Text>
        ))}
        {preview.blockers.length > 0 && preview.overrideStatus === 'pending' ? (
          <Text style={styles.warnText} testID="departure-override-pending">Laukiama administratoriaus patvirtinimo, kad galima važiuoti.</Text>
        ) : null}
        {preview.blockers.length > 0 && canApprove ? (
          <Pressable disabled={busy} onPress={() => { void approveOverride(); }} style={[styles.button, busy && styles.disabled]} testID="approve-expired-departure">
            <Text style={styles.buttonText}>{busy ? 'Saugoma…' : 'Patvirtinti, kad galima važiuoti'}</Text>
          </Pressable>
        ) : null}
        {preview.blockers.length > 0 && !canApprove && preview.overrideStatus !== 'pending' ? (
          <Pressable disabled={busy} onPress={() => { void requestOverride(); }} style={[styles.secondaryButton, busy && styles.disabled]} testID="request-expired-departure">
            <Text style={styles.secondaryText}>{busy ? 'Siunčiama…' : 'Prašyti administratoriaus leidimo važiuoti'}</Text>
          </Pressable>
        ) : null}
      </View> : null}
      <View style={styles.card} testID="vehicle-fault-card">
        <Text style={styles.sectionTitle}>Neskubūs gedimai</Text>
        <Text style={styles.hint}>Komentaras nestabdo važiavimo. Jis automatiškai perduodamas administracijai.</Text>
        <TextInput
          value={faultComment}
          onChangeText={setFaultComment}
          multiline
          style={[styles.input, styles.multiline]}
          placeholder="Pvz. tylus ūžesys iš dešinės pusės"
          placeholderTextColor={colors.textMuted}
          testID="vehicle-fault-comment"
        />
        <Pressable disabled={busy || !faultComment.trim()} onPress={() => { void addFault(); }} style={[styles.secondaryButton, (busy || !faultComment.trim()) && styles.disabled]} testID="save-vehicle-fault">
          <Text style={styles.secondaryText}>{busy ? 'Saugoma…' : 'Įrašyti ir perduoti administracijai'}</Text>
        </Pressable>
        {openFaults.map((fault) => (
          <Text key={fault.id} style={styles.faultText}>
            {fault.notifiedAt ? 'Perduota' : 'Laukia perdavimo'} · {fault.comment}
          </Text>
        ))}
      </View>
      <Pressable disabled={busy || !selectedVehicleId} onPress={() => { void save(); }} style={[styles.button, (busy || !selectedVehicleId) && styles.disabled]} testID="save-vehicle">
        <Text style={styles.buttonText}>{busy ? 'Saugoma…' : 'Išsaugoti automobilį'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  vehicleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  vehicleChoice: { minWidth: 150, minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, padding: spacing.md, justifyContent: 'center' },
  vehicleChoiceSelected: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  vehicleChoiceTitle: { ...type.cardTitle, color: colors.text },
  vehicleChoiceTitleSelected: { color: colors.info },
  vehicleChoiceMeta: { ...type.secondary, color: colors.textMuted },
  vehicleChoiceMetaSelected: { color: colors.textSecondary },
  selectedVehicle: { ...type.bodyStrong, color: colors.info },
  odometerPanel: { marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  bulkPanel: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderStrong, gap: spacing.sm },
  inlineInputs: { flexDirection: 'row', gap: spacing.sm },
  inlineInput: { flex: 1, minWidth: 0 },
  readingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  readingCard: { minHeight: 54, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  readingDisplayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  readingHeader: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minWidth: 0 },
  readingMain: { minWidth: 0 },
  fuelReadingRow: { minHeight: 54, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fuelReadingMain: { flex: 1, minWidth: 0 },
  readingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  readingTitle: { ...type.bodyStrong, color: colors.text },
  entryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  smallButton: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { ...type.label, color: colors.info },
  deleteFuelButton: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  deleteFuelText: { ...type.label, color: colors.danger },
  buttonSmall: { minHeight: 44, flex: 1, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonSmall: { minHeight: 44, flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { ...type.cardTitle, color: colors.text },
  label: { ...type.cardTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textMuted },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  multiline: { minHeight: 88, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  optionText: { ...type.secondaryStrong, color: colors.text },
  optionTextSelected: { color: colors.textInverse },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.55 },
  message: { color: colors.textMuted, lineHeight: 20 },
  blockText: { ...type.bodyStrong, color: colors.danger },
  warnText: { ...type.body, color: colors.warning },
  faultText: { ...type.secondary, color: colors.textSecondary },
});
