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
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import { VehicleDepartureOverrideRepository } from '@/database/repositories/vehicle-departure-override-repository';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import { evaluateDepartureReadiness, type DepartureOverrideInput } from '@/domain/departure-readiness';
import { odometerDistanceKm, parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import { chronologicalVehicleFuelEntries } from '@/domain/vehicle-fuel-entries';
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

// One-time odometer correction after the vehicle's mass cable was replaced on
// 2026-08-03, which made the odometer jump to a different, discontinuous
// reading. These 28 rows redistribute the known daily route distances across
// 2026-08-04..2026-08-31 so no single day shows a fake multi-thousand-km jump,
// while the cumulative total still lands on the real 2026-08-31 reading.
const ODOMETER_CORRECTION_2026_08 = `2026-08-04,671444,672107
2026-08-05,672107,672781
2026-08-06,672781,672781
2026-08-07,672781,673644
2026-08-08,673644,673644
2026-08-09,673644,673658
2026-08-10,673658,674175
2026-08-11,674175,674860
2026-08-12,674860,675222
2026-08-13,675222,675310
2026-08-14,675310,676013
2026-08-15,676013,676013
2026-08-16,676013,676147
2026-08-17,676147,676200
2026-08-18,676200,676420
2026-08-19,676420,676796
2026-08-20,676796,676796
2026-08-21,676796,677251
2026-08-22,677251,677251
2026-08-23,677251,677251
2026-08-24,677251,677251
2026-08-25,677251,677261
2026-08-26,677261,677706
2026-08-27,677706,678306
2026-08-28,678306,678895
2026-08-29,678895,678895
2026-08-30,678895,678895
2026-08-31,678895,678895`;

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
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [editingReadingDate, setEditingReadingDate] = useState('');
  const [editingReadingStart, setEditingReadingStart] = useState('');
  const [editingReadingEnd, setEditingReadingEnd] = useState('');
  const [editingReadingKm, setEditingReadingKm] = useState('');
  const [editingReadingDriverId, setEditingReadingDriverId] = useState('');
  const [addingReading, setAddingReading] = useState(false);
  const [newReadingDate, setNewReadingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newReadingStart, setNewReadingStart] = useState('');
  const [newReadingEnd, setNewReadingEnd] = useState('');
  const [newReadingKm, setNewReadingKm] = useState('');
  const [newReadingDriverId, setNewReadingDriverId] = useState('');
  const [fuelDate, setFuelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fuelLiters, setFuelLiters] = useState('');
  const [fuelReceipt, setFuelReceipt] = useState('');
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [openingBalanceDate, setOpeningBalanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingBalanceLiters, setOpeningBalanceLiters] = useState('');
  const [openingBalanceNote, setOpeningBalanceNote] = useState('');
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
    // Always attempt this — this function runs right after a successful
    // save/edit/delete, which already proved the network works, so gating on
    // the `online` flag (a periodic, not instant, connectivity check — see
    // local-access-gate.tsx) could silently skip refreshing the very entry
    // that was just written, leaving the list looking unchanged even though
    // the save succeeded. On failure, keep whatever was already on screen
    // instead of wiping it to an empty list.
    try {
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
      setVehicleReadings(response.tripSheets.filter((sheet) => sheet.vehicle?.id === vehicleId).sort((a, b) => a.date.localeCompare(b.date)));
    } catch { /* keep the previous list rather than clearing it on a transient failure */ }
  }, [db, faults, fleetVehicles, repository]);

  const editReading = (reading: ServerTripSheet) => {
    setEditingReadingId(reading.assignmentId);
    setEditingReadingDate(reading.date);
    setEditingReadingStart(reading.startOdometer == null ? '' : String(reading.startOdometer));
    setEditingReadingEnd(reading.endOdometer == null ? '' : String(reading.endOdometer));
    setEditingReadingKm(reading.startOdometer == null || reading.endOdometer == null ? '' : String(odometerDistanceKm(reading.startOdometer, reading.endOdometer)));
    setEditingReadingDriverId(reading.driverId || 'none');
  };

  // Lets a day be entered as "how many km were driven" instead of typing the
  // absolute end odometer by hand — the end field fills itself from
  // start + km. Typing the end field directly still works as before.
  const applyKmToEnd = (startText: string, kmText: string, setEnd: (value: string) => void) => {
    const start = Number(startText.replace(',', '.'));
    const km = Number(kmText.replace(',', '.'));
    if (Number.isFinite(start) && Number.isFinite(km) && km >= 0) setEnd(String(Math.round((start + km) * 10) / 10));
  };

  const saveReading = async (reading: ServerTripSheet) => {
    if (busy) return;
    setBusy(true);
    try {
      const start = Number(editingReadingStart.replace(',', '.'));
      const end = Number(editingReadingEnd.replace(',', '.'));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Patikrinkite odometro pradžią ir pabaigą.');
      const driverId = editingReadingDriverId === 'none' ? null : editingReadingDriverId || undefined;
      const vehicleDay = parseVehicleDayAssignmentId(reading.assignmentId);
      if (vehicleDay) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(editingReadingDate)) throw new Error('Įveskite datą formatu YYYY-MM-DD.');
        if (editingReadingDate !== reading.date) {
          // Standalone day readings are keyed by vehicle+date, so moving one
          // to a different date means creating it under the new date and
          // removing the old one — otherwise a wrongly-dated entry (e.g. a
          // date field that didn't take the typed value) could never be
          // corrected, only re-entered alongside the stale original.
          await employeeApi(`/api/admin/trip-sheets/unassigned-day/${encodeURIComponent(selectedVehicleId)}/${encodeURIComponent(reading.date)}`, { method: 'DELETE' });
        }
        await employeeApi('/api/trip-sheets/day-readings', { method: 'POST', body: JSON.stringify({ vehicleId: selectedVehicleId, date: editingReadingDate, startOdometer: start, endOdometer: end, driverId }) });
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
      // An easy-to-miss inline banner here reads as "the delete button does
      // nothing" — this row is a real completed route's trip sheet, not a
      // standalone odometer entry, so it can't be removed from this list at
      // all; say that plainly instead of silently doing nothing.
      Alert.alert('Ištrinti negalima', `${reading.date} priklauso tikram įvykdytam maršrutui — jis saugomas istorijoje ir iš čia netrinamas. Jei norite pakeisti odometro rodmenis, redaguokite eilutę pieštuko mygtuku.`);
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

  const saveNewReading = async () => {
    if (busy) return;
    const start = Number(newReadingStart.replace(',', '.'));
    const end = Number(newReadingEnd.replace(',', '.'));
    if (!selectedVehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(newReadingDate)) { setMessage('Įveskite naujos dienos datą YYYY-MM-DD.'); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) { setMessage('Patikrinkite naujos dienos odometro pradžią ir pabaigą.'); return; }
    setBusy(true);
    try {
      // Echo back exactly what the server actually recorded (registration +
      // date), not just "saved" — a client/server mismatch (wrong vehicle,
      // a date that didn't take) is otherwise invisible until the driver
      // goes looking for the entry and can't find it.
      const { reading } = await employeeApi<{ reading: { vehicleId: string; date: string } }>(
        '/api/trip-sheets/day-readings',
        { method: 'POST', body: JSON.stringify({ vehicleId: selectedVehicleId, date: newReadingDate, startOdometer: start, endOdometer: end, driverId: newReadingDriverId || undefined }) },
      );
      setAddingReading(false); setNewReadingStart(''); setNewReadingEnd(''); setNewReadingKm(''); setNewReadingDriverId('');
      setMessage(`Išsaugota: ${registrationNumber} · ${reading.date}.`);
      await applyVehicle(selectedVehicleId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Naujos dienos išsaugoti nepavyko.'); }
    finally { setBusy(false); }
  };

  /**
   * Corrects many days at once — one line per day, `data,pradžia,pabaiga`
   * (YYYY-MM-DD,start,end) — for cases like an odometer/instrument swap
   * where dozens of historical days need re-entering with numbers computed
   * ahead of time, rather than one manual "Pridėti naują dieną" per day.
   * Each line upserts by vehicle+date (same as a normal single entry), so
   * re-running it (or overlapping with existing rows) simply corrects them.
   */
  const runBulkImport = async () => {
    if (bulkImporting || busy || !selectedVehicleId) return;
    const lines = bulkImportText.split('\n').map((line) => line.trim()).filter(Boolean);
    const rows: { date: string; start: number; end: number }[] = [];
    for (const line of lines) {
      const parts = line.split(',').map((part) => part.trim());
      const [date, startText, endText] = parts;
      const start = Number(startText);
      const end = Number(endText);
      if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        setMessage(`Neteisinga eilutė (data,pradžia,pabaiga): "${line}"`);
        return;
      }
      rows.push({ date, start, end });
    }
    if (rows.length === 0) { setMessage('Nėra ką importuoti.'); return; }
    setBulkImporting(true);
    setBusy(true);
    try {
      for (const row of rows) {
        // A day where the odometer didn't move means nobody drove — leave it
        // unassigned rather than defaulting to the vehicle's usual driver.
        const driverId = row.start === row.end ? null : undefined;
        await employeeApi('/api/trip-sheets/day-readings', {
          method: 'POST',
          body: JSON.stringify({ vehicleId: selectedVehicleId, date: row.date, startOdometer: row.start, endOdometer: row.end, driverId }),
        });
      }
      setMessage(`Importuota: ${registrationNumber} · ${rows.length} dienų (${rows[0]!.date} – ${rows[rows.length - 1]!.date}).`);
      setBulkImportOpen(false); setBulkImportText('');
      await applyVehicle(selectedVehicleId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Masinis importas nepavyko.');
    } finally {
      setBulkImporting(false); setBusy(false);
    }
  };

  // vehicleReadings is sorted ascending by date, so the most recent known
  // odometer reading is the last entry that actually has one.
  const latestOdometer = [...vehicleReadings].reverse().find((reading) => reading.endOdometer != null)?.endOdometer ?? null;
  const vehicleFuelEntries = chronologicalVehicleFuelEntries(vehicleReadings, selectedVehicleId);
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

  const saveOpeningBalance = async () => {
    if (busy) return;
    const liters = Number(openingBalanceLiters.replace(',', '.'));
    if (!selectedVehicleId) { setMessage('Pasirinkite automobilį.'); return; }
    if (!Number.isFinite(liters) || liters < 0) { setMessage('Įveskite pradinį likutį litrais.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingBalanceDate)) { setMessage('Pasirinkite pradinio likučio datą.'); return; }
    setBusy(true);
    try {
      await employeeApi('/api/admin/fuel-corrections', { method: 'POST', body: JSON.stringify({ vehicleId: selectedVehicleId, liters, effectiveAt: openingBalanceDate, note: openingBalanceNote.trim() || null }) });
      setOpeningBalanceLiters(''); setOpeningBalanceNote(''); setMessage('Pradinis kuro likutis išsaugotas.');
      await applyVehicle(selectedVehicleId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pradinio likučio išsaugoti nepavyko.'); }
    finally { setBusy(false); }
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
      setVehicleReadings(response.tripSheets.filter((sheet) => sheet.vehicle?.id === preferred.id).sort((a, b) => a.date.localeCompare(b.date)));
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
          <Pressable
            onPress={() => {
              setAddingReading((current) => {
                const next = !current;
                if (next && !newReadingStart && latestOdometer != null) setNewReadingStart(String(latestOdometer));
                return next;
              });
            }}
            style={styles.addDayButton}
            testID="add-vehicle-odometer-day">
            <Text style={styles.addDayButtonText}>{addingReading ? 'Uždaryti naujos dienos įvedimą' : '+ Pridėti naują dieną'}</Text>
          </Pressable>
          {addingReading ? <View style={styles.newDayForm} testID="new-vehicle-odometer-day">
            <DateInput accessibilityLabel="Naujos dienos data" value={newReadingDate} onChangeText={setNewReadingDate} style={styles.input} placeholderTextColor={colors.textMuted} />
            <TextInput
              value={newReadingKm}
              onChangeText={(text) => { setNewReadingKm(text); applyKmToEnd(newReadingStart, text, setNewReadingEnd); }}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholder="Nuvažiuota per dieną, km"
              placeholderTextColor={colors.textMuted}
              testID="new-vehicle-odometer-km"
            />
            <View style={styles.inlineInputs}>
              <TextInput
                value={newReadingStart}
                onChangeText={(text) => { setNewReadingStart(text); if (newReadingKm) applyKmToEnd(text, newReadingKm, setNewReadingEnd); }}
                keyboardType="decimal-pad"
                style={[styles.input, styles.inlineInput]}
                placeholder="Pradžia"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput value={newReadingEnd} onChangeText={setNewReadingEnd} keyboardType="decimal-pad" style={[styles.input, styles.inlineInput]} placeholder="Pabaiga" placeholderTextColor={colors.textMuted} />
            </View>
            <Text style={styles.hint}>Pradžia užsipildo automatiškai pagal paskutinį žinomą odometrą — įveskite tik nuvažiuotus km, pabaiga susiskaičiuos pati. Prireikus pabaigą galite įvesti ir tiesiogiai.</Text>
            <View style={styles.options}>{drivers.map((driver) => <Pressable key={driver.id} onPress={() => setNewReadingDriverId(driver.id)} style={[styles.option, newReadingDriverId === driver.id && styles.optionSelected]}><Text style={[styles.optionText, newReadingDriverId === driver.id && styles.optionTextSelected]}>{driver.displayName}</Text></Pressable>)}</View>
            <Pressable disabled={busy || !online} onPress={() => { void saveNewReading(); }} style={[styles.button, (busy || !online) && styles.disabled]}><Text style={styles.buttonText}>Išsaugoti naują dieną</Text></Pressable>
          </View> : null}
          <Pressable
            onPress={() => {
              setBulkImportOpen((current) => {
                const next = !current;
                if (next && !bulkImportText) setBulkImportText(ODOMETER_CORRECTION_2026_08);
                return next;
              });
            }}
            style={styles.addDayButton}
            testID="bulk-import-odometer-days">
            <Text style={styles.addDayButtonText}>{bulkImportOpen ? 'Uždaryti masinį importą' : '+ Masinis kelių dienų importas'}</Text>
          </Pressable>
          {bulkImportOpen ? <View style={styles.newDayForm} testID="bulk-import-odometer-form">
            <Text style={styles.hint}>Viena eilutė = viena diena, formatas „data,pradžia,pabaiga&quot; (YYYY-MM-DD,km,km). Jau užpildyta rugpjūčio odometro pataisymo eilutėmis — pakeiskite, jei reikia kito automobilio ar kitų datų.</Text>
            <TextInput
              value={bulkImportText}
              onChangeText={setBulkImportText}
              multiline
              numberOfLines={10}
              style={[styles.input, styles.bulkImportInput]}
              placeholder="2026-08-04,671444,672107"
              placeholderTextColor={colors.textMuted}
              testID="bulk-import-textarea"
            />
            <Pressable disabled={busy || !online || bulkImporting} onPress={() => { void runBulkImport(); }} style={[styles.button, (busy || !online || bulkImporting) && styles.disabled]} testID="bulk-import-submit">
              <Text style={styles.buttonText}>{bulkImporting ? 'Importuojama…' : 'Importuoti visas eilutes'}</Text>
            </Pressable>
          </View> : null}
          {vehicleReadings.map((reading) => {
            const editing = editingReadingId === reading.assignmentId;
            return <View key={reading.assignmentId} style={styles.readingCard}>
              <View style={styles.readingDisplayRow}><View style={styles.readingHeader}><View style={styles.readingMain}><Text style={styles.readingTitle}>{reading.date}</Text><Text style={styles.hint}>{reading.startOdometer ?? '—'} → {reading.endOdometer ?? '—'} km{reading.startOdometer != null && reading.endOdometer != null ? ` · ${odometerDistanceKm(reading.startOdometer, reading.endOdometer)} km per dieną` : ''}</Text></View><Text style={styles.hint}>{reading.driverName || 'Nepriskirtas'}</Text></View>
                {!editing ? <View style={styles.readingActions}><Pressable accessibilityLabel={`Redaguoti ${reading.date}`} onPress={() => editReading(reading)} style={styles.iconButton}><PencilIcon size={18} color={colors.warning} /></Pressable><Pressable accessibilityLabel={`Ištrinti ${reading.date}`} onPress={() => deleteReading(reading)} style={styles.iconButton}><TrashIcon size={18} color={colors.danger} /></Pressable></View> : null}
              </View>
              {editing ? <>
                {parseVehicleDayAssignmentId(reading.assignmentId) ? <DateInput accessibilityLabel={`Data ${reading.date}`} value={editingReadingDate} onChangeText={setEditingReadingDate} style={styles.input} placeholderTextColor={colors.textMuted} /> : null}
                <TextInput
                  value={editingReadingKm}
                  onChangeText={(text) => { setEditingReadingKm(text); applyKmToEnd(editingReadingStart, text, setEditingReadingEnd); }}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholder="Nuvažiuota per dieną, km"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.inlineInputs}>
                  <TextInput
                    value={editingReadingStart}
                    onChangeText={(text) => { setEditingReadingStart(text); if (editingReadingKm) applyKmToEnd(text, editingReadingKm, setEditingReadingEnd); }}
                    keyboardType="decimal-pad"
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Pradžia"
                    placeholderTextColor={colors.textMuted}
                  />
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
          <DateInput accessibilityLabel="Kuro pylimo data" value={fuelDate} onChangeText={setFuelDate} style={styles.input} placeholderTextColor={colors.textMuted} />
          <View style={styles.inlineInputs}>
            <TextInput value={fuelLiters} onChangeText={setFuelLiters} keyboardType="decimal-pad" style={[styles.input, styles.inlineInput]} placeholder="Įpilta, l" placeholderTextColor={colors.textMuted} />
            <TextInput value={fuelReceipt} onChangeText={setFuelReceipt} style={[styles.input, styles.inlineInput]} placeholder="Čekio Nr. (nebūtina)" placeholderTextColor={colors.textMuted} />
          </View>
          <Pressable disabled={busy || !online} onPress={() => { void saveFuel(); }} style={[styles.button, (busy || !online) && styles.disabled]}><Text style={styles.buttonText}>{editingFuelId ? 'Išsaugoti kuro pakeitimą' : 'Įrašyti papildymą'}</Text></Pressable>
          {vehicleFuelEntries.map((entry) => <View key={entry.id} style={styles.fuelReadingRow}><View style={styles.fuelReadingMain}><Text style={styles.readingTitle}>{new Date(entry.filledAt).toLocaleDateString('lt-LT')}</Text><Text style={styles.hint}>{entry.liters} l{entry.receiptNumber ? ` · čekis ${entry.receiptNumber}` : ''}</Text></View><View style={styles.readingActions}><Pressable accessibilityLabel={`Redaguoti kuro pylimą ${entry.id}`} onPress={() => { setEditingFuelId(entry.id); setFuelDate(entry.filledAt.slice(0, 10)); setFuelLiters(String(entry.liters)); setFuelReceipt(entry.receiptNumber ?? ''); }} style={styles.iconButton}><PencilIcon size={18} color={colors.warning} /></Pressable><Pressable accessibilityLabel={`Ištrinti kuro pylimą ${entry.id}`} disabled={busy} onPress={() => confirmDeleteFuel(entry)} style={styles.iconButton}><TrashIcon size={18} color={colors.danger} /></Pressable></View></View>)}
          {profile.role === 'admin' ? <View style={styles.newDayForm} testID="vehicle-opening-fuel-balance">
            <Text style={styles.sectionTitle}>Pradinis kuro likutis</Text>
            <Text style={styles.hint}>Nurodykite, kiek litrų bake buvo nuo pasirinktos dienos. Naudokite, kai pradedate skaičiuoti nuo tam tikros datos.</Text>
            <DateInput accessibilityLabel="Pradinio likučio data" value={openingBalanceDate} onChangeText={setOpeningBalanceDate} style={styles.input} placeholderTextColor={colors.textMuted} />
            <TextInput value={openingBalanceLiters} onChangeText={setOpeningBalanceLiters} keyboardType="decimal-pad" style={styles.input} placeholder="Likutis, l" placeholderTextColor={colors.textMuted} />
            <TextInput value={openingBalanceNote} onChangeText={setOpeningBalanceNote} style={styles.input} placeholder="Priežastis (nebūtina)" placeholderTextColor={colors.textMuted} />
            <Pressable disabled={busy || !online} onPress={() => { void saveOpeningBalance(); }} style={[styles.button, (busy || !online) && styles.disabled]}><Text style={styles.buttonText}>Išsaugoti pradinį likutį</Text></Pressable>
          </View> : null}
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
        <DateInput accessibilityLabel="Techninė apžiūra iki" value={inspectionDueOn} onChangeText={setInspectionDueOn} style={styles.input} placeholderTextColor={colors.textMuted} testID="vehicle-inspection-due" />
        <Text style={styles.label}>Kelių mokestis iki</Text>
        <DateInput accessibilityLabel="Kelių mokestis iki" value={roadTaxDueOn} onChangeText={setRoadTaxDueOn} style={styles.input} placeholderTextColor={colors.textMuted} testID="vehicle-road-tax-due" />
        <Text style={styles.label}>Draudimas iki</Text>
        <DateInput accessibilityLabel="Draudimas iki" value={insuranceDueOn} onChangeText={setInsuranceDueOn} style={styles.input} placeholderTextColor={colors.textMuted} testID="vehicle-insurance-due" />
        <Text style={styles.label}>Tepalai / servisas iki</Text>
        <DateInput accessibilityLabel="Tepalai / servisas iki" value={serviceDueOn} onChangeText={setServiceDueOn} style={styles.input} placeholderTextColor={colors.textMuted} testID="vehicle-service-due" />
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
      {profile.role === 'driver' ? <View style={styles.card} testID="vehicle-fault-card">
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
      </View> : null}
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
  addDayButton: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  addDayButtonText: { ...type.button, color: colors.info },
  newDayForm: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: spacing.sm },
  bulkImportInput: { minHeight: 220, textAlignVertical: 'top' },
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
