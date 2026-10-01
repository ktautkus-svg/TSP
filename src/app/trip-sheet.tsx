import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { CompanyProfileSettings, type CompanyProfile } from '@/application/settings/company-profile';
import { TRIP_SHEET_GRID_COLUMNS, tripSheetCells, tripSheetColumnLegend, type TripSheetCell } from '@/application/trip-sheet/columns';
import { dailyRouteNumbers } from '@/application/trip-sheet/daily-route-merge';
import { printHtmlDocument } from '@/application/trip-sheet/print-frame';
import { driverSheetRunPeriod, splitDriverSheetRuns, type DriverSheetRun } from '@/application/trip-sheet/driver-sheets';
import { buildTripSheetWorkbook, MIME_XLSX } from '@/application/trip-sheet/export-xlsx';
import { assembleDailyTripRows, presentedDistanceKm, tripSheetRouteLabel, type TripDayFuelEntry } from '@/application/trip-sheet/day-rows';
import { buildFuelLedger, closingFuelLiters, FUEL_OVER_CAPACITY_NOTE, fuelFillContinuesLedger, fuelRemainderExceedsTank, openingFuelLiters, type FuelLedgerDay } from '@/application/trip-sheet/fuel-balance';
import { buildTripSheetPrintDocument } from '@/application/trip-sheet/print-document';
import { FiroSelect } from '@/components/firo-select';
import { FoundationScreen } from '@/components/foundation-screen';
import { PeriodCalendarPicker } from '@/components/period-calendar-picker';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
import { resolveFuelTankCapacity } from '@/domain/fleet-cargo-specs';
import type { FuelType } from '@/domain/vehicle-and-trip';
import {
    employeeApi,
    type ServerFuelEntry,
    type ServerTripSheet,
} from '@/infrastructure/auth/employee-session';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  diesel: 'Dyzelinas',
  petrol: 'Benzinas',
  electric: 'Elektra',
  hybrid: 'Hibridas',
  lpg: 'Dujos',
  other: 'Kita',
};

type TripFuelEntry = Pick<ServerFuelEntry, 'id' | 'filledAt' | 'odometer' | 'liters' | 'pricePerLiter' | 'totalCost' | 'station' | 'receiptNumber' | 'notes'>;
type DisplayTripSheet = Omit<ServerTripSheet, 'fuelEntries'> & { source: 'server' | 'local'; fuelEntries: TripFuelEntry[] };
type DailyTripRow = {
  date: string;
  driverId: string;
  driverName: string;
  routeNumbers: string[];
  startAddress: string;
  endAddress: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  /** 'odometer' once the readings are in, 'planned' until then. */
  distanceSource: 'odometer' | 'planned' | null;
  fuelNorm: number | null;
  fuelConsumed: number | null;
  fuelAdded: number | null;
  fuelStart: number | null;
  fuelEnd: number | null;
  fuelMissing: FuelLedgerDay['missing'];
  compensationEur: number | null;
  compensationPreliminary: boolean;
  assignmentId: string;
  tripSheetId: string;
  vehicleId: string | null;
  source: DisplayTripSheet['source'];
  fuelEntries: TripDayFuelEntry[];
};
type MonthlyTripGroup = {
  key: string;
  month: string;
  vehicle: ServerTripSheet['vehicle'];
  rows: DailyTripRow[];
};
/**
 * One printable / exportable kelionės lapas. `sheetNumber` null is the
 * continuous "all drivers" month sheet; a number is a per-driver run.
 */
type PrintableSheet = {
  key: string;
  sheetNumber: number | null;
  month: string;
  monthLabel: string;
  periodLabel: string;
  registrationNumber: string;
  vehicleModel: string;
  vehicle: ServerTripSheet['vehicle'];
  driverNames: string;
  fuelNorm: number | null;
  rows: DailyTripRow[];
};

type FuelEditorState = {
  mode: 'add' | 'edit' | 'delete';
  assignmentId: string;
  entryId: string | null;
  liters: string;
  receiptNumber: string;
  date: string;
  vehicleId: string;
  driverId: string;
  error: string | null;
};

function groupPrintableSheet(group: MonthlyTripGroup): PrintableSheet {
  return {
    key: group.key,
    sheetNumber: null,
    month: group.month,
    monthLabel: formatMonth(group.month),
    periodLabel: formatMonth(group.month),
    registrationNumber: group.vehicle?.registrationNumber ?? 'be-numerio',
    vehicleModel: group.vehicle?.model ?? 'Automobilis nepriskirtas',
    vehicle: group.vehicle,
    driverNames: [...new Set(group.rows.map((row) => row.driverName))].join(', '),
    fuelNorm: group.rows[0]?.fuelNorm ?? null,
    rows: group.rows,
  };
}

function runPrintableSheet(run: DriverSheetRun<DailyTripRow>, group: MonthlyTripGroup): PrintableSheet {
  return {
    key: `${group.key}:${run.driverKey}:${run.sheetNumber}`,
    sheetNumber: run.sheetNumber,
    month: group.month,
    monthLabel: formatMonth(group.month),
    periodLabel: driverSheetRunPeriod(run),
    registrationNumber: group.vehicle?.registrationNumber ?? 'be-numerio',
    vehicleModel: group.vehicle?.model ?? 'Automobilis nepriskirtas',
    vehicle: group.vehicle,
    driverNames: run.driverName,
    fuelNorm: run.days.find((day) => day.fuelNorm !== null)?.fuelNorm ?? group.rows[0]?.fuelNorm ?? null,
    rows: run.days,
  };
}

export default function TripSheetScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const [sheets, setSheets] = useState<DisplayTripSheet[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({ name: '', address: '' });
  const [vehicleFuelType, setVehicleFuelType] = useState<FuelType>('diesel');

  useEffect(() => {
    void new CompanyProfileSettings(db).get().then(setCompanyProfile);
    void repository.getVehicle().then((vehicle) => { if (vehicle) setVehicleFuelType(vehicle.fuelType); });
  }, [db, repository]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (online) {
        if (profile.role === 'driver') await pushCompletedRouteAssignmentProgress(db);
        const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
        setSheets(response.tripSheets.map((sheet) => ({ ...sheet, source: 'server', fuelEntries: sheet.fuelEntries ?? [] })));
      } else {
        setSheets(await localSheets(repository));
        setMessage('Rodomi šiame įrenginyje išsaugoti kelionės lapai. Prisijungus bus rodomi serverio duomenys.');
      }
    } catch (error) {
      const local = await repository.list().catch(() => []);
      const entries = await repository.listFuelEntries().catch(() => []);
      setSheets(local.map((sheet) => localSheet(sheet, entries.filter((entry) => entry.tripSheetId === sheet.id))));
      setMessage(error instanceof Error ? error.message : 'Kelionės lapų atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [db, online, profile.role, repository]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const syncLocal = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await repository.syncAllCompletedDates();
      await load();
      setMessage('Kelionės lapai atnaujinti.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kelionės lapo atnaujinti nepavyko.');
      setBusy(false);
    }
  };

  const drivers = useMemo(() => [...new Map(sheets.map((sheet) => [sheet.driverId, sheet.driverName])).entries()], [sheets]);
  const vehicles = useMemo(() => [...new Map(
    sheets.filter((sheet) => sheet.vehicle).map((sheet) => [sheet.vehicle!.id, sheet.vehicle!.registrationNumber]),
  ).entries()], [sheets]);
  const months = useMemo(() => [...new Set(sheets.map((sheet) => sheet.date.slice(0, 7)))].sort().reverse(), [sheets]);
  const driverFilterActive = profile.role !== 'driver' && selectedDriverId !== 'all';
  const inFilterWindow = (sheet: DisplayTripSheet) =>
    (selectedVehicleId === 'all' || sheet.vehicle?.id === selectedVehicleId)
    && (selectedMonth === 'all' || sheet.date.startsWith(selectedMonth))
    && (!dateFrom || sheet.date >= dateFrom)
    && (!dateTo || sheet.date <= dateTo);
  const visible = sheets.filter((sheet) => inFilterWindow(sheet)
    && (profile.role === 'driver' || selectedDriverId === 'all' || sheet.driverId === selectedDriverId));
  // When one driver is picked, still group the whole vehicle-month (every
  // driver) so the numbered-sheet split can see who else used the vehicle and
  // the fuel ledger runs across the full month; the driver filter is then
  // applied to the runs, not the rows.
  const groupSource = driverFilterActive ? sheets.filter(inFilterWindow) : visible;
  const monthlyGroups = useMemo(() => buildMonthlyGroups(groupSource, sheets), [groupSource, sheets]);
  const driverRuns = useMemo<{ run: DriverSheetRun<DailyTripRow>; group: MonthlyTripGroup }[]>(() => {
    if (!driverFilterActive) return [];
    return monthlyGroups.flatMap((group) =>
      splitDriverSheetRuns(group.rows.map((row) => ({
        date: row.date,
        driverKey: row.driverId,
        driverName: row.driverName,
        active: (row.distanceKm ?? 0) > 0 || (row.fuelAdded ?? 0) > 0,
        row,
      })))
        .filter((run) => run.driverKey === selectedDriverId)
        .map((run) => ({ run, group })));
  }, [driverFilterActive, monthlyGroups, selectedDriverId]);
  const printableSheets = useMemo<PrintableSheet[]>(() => (
    driverFilterActive
      ? driverRuns.map(({ run, group }) => runPrintableSheet(run, group))
      : monthlyGroups.map(groupPrintableSheet)
  ), [driverFilterActive, driverRuns, monthlyGroups]);
  const sheetKeySignature = printableSheets.map((sheet) => sheet.key).join('|');
  const [selectedSheetKeys, setSelectedSheetKeys] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedSheetKeys(new Set()); }, [sheetKeySignature]);
  const toggleSheet = (key: string) => setSelectedSheetKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allSheetsSelected = printableSheets.length > 0 && selectedSheetKeys.size === printableSheets.length;
  const toggleAllSheets = () => setSelectedSheetKeys(allSheetsSelected ? new Set() : new Set(printableSheets.map((sheet) => sheet.key)));
  // Nothing ticked = act on every visible sheet, not an empty file.
  const targetSheets = selectedSheetKeys.size === 0
    ? printableSheets
    : printableSheets.filter((sheet) => selectedSheetKeys.has(sheet.key));
  const periodLabel = dateFrom || dateTo ? `${dateFrom || '...'} - ${dateTo || '...'}` : selectedMonth === 'all' ? 'Visas laikotarpis' : formatMonth(selectedMonth);

  // P0.5 — an administrator edits fuel right here on the kelionės lapas
  // (the vehicle.tsx editor stays too). Web dialogs are unreliable, so the
  // delete confirmation is an in-app modal.
  const canEditFuel = profile.role === 'admin';
  const [fuelEditor, setFuelEditor] = useState<FuelEditorState | null>(null);
  const [fuelBusy, setFuelBusy] = useState(false);
  const openFuelEditor = (mode: FuelEditorState['mode'], row: DailyTripRow, entry?: TripDayFuelEntry) => {
    setFuelEditor({
      mode,
      assignmentId: row.assignmentId,
      entryId: entry?.id ?? null,
      liters: entry ? String(entry.liters) : '',
      receiptNumber: entry?.receiptNumber ?? '',
      date: (entry?.filledAt ?? `${row.date}T12:00:00.000Z`).slice(0, 10),
      vehicleId: row.vehicleId ?? selectedVehicleId,
      driverId: entry ? '' : row.driverId,
      error: null,
    });
  };
  const submitFuelEditor = async () => {
    if (!fuelEditor) return;
    setFuelBusy(true);
    setFuelEditor((prev) => (prev ? { ...prev, error: null } : prev));
    try {
      if (fuelEditor.mode === 'delete') {
        await employeeApi(`/api/fuel-entries/${encodeURIComponent(fuelEditor.entryId!)}`, { method: 'DELETE' });
      } else if (fuelEditor.mode === 'edit') {
        const patch: Record<string, unknown> = {
          filledAt: `${fuelEditor.date}T12:00:00.000Z`,
          liters: Number(fuelEditor.liters.replace(',', '.')),
          receiptNumber: fuelEditor.receiptNumber.trim() || null,
        };
        if (fuelEditor.vehicleId && fuelEditor.vehicleId !== 'all') patch.vehicleId = fuelEditor.vehicleId;
        if (fuelEditor.driverId) patch.driverId = fuelEditor.driverId;
        await employeeApi(`/api/fuel-entries/${encodeURIComponent(fuelEditor.entryId!)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      } else {
        const created = await employeeApi<{ entry: { id: string } }>(
          `/api/trip-sheets/${encodeURIComponent(fuelEditor.assignmentId)}/fuel-entries`,
          {
            method: 'POST',
            body: JSON.stringify({
              filledAt: `${fuelEditor.date}T12:00:00.000Z`,
              liters: Number(fuelEditor.liters.replace(',', '.')),
              receiptNumber: fuelEditor.receiptNumber.trim() || undefined,
            }),
          },
        );
        // POST derives vehicle/driver from the assignment; move it only if the
        // admin picked something else.
        const move: Record<string, unknown> = {};
        if (fuelEditor.vehicleId && fuelEditor.vehicleId !== 'all') move.vehicleId = fuelEditor.vehicleId;
        if (fuelEditor.driverId) move.driverId = fuelEditor.driverId;
        if (Object.keys(move).length > 0 && created?.entry?.id) {
          await employeeApi(`/api/fuel-entries/${encodeURIComponent(created.entry.id)}`, { method: 'PATCH', body: JSON.stringify(move) });
        }
      }
      setFuelEditor(null);
      await load();
      setMessage('Kuro įrašas atnaujintas.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Kuro įrašo išsaugoti nepavyko.';
      setFuelEditor((prev) => (prev ? {
        ...prev,
        error: online ? text : 'Nėra ryšio su serveriu — kuro įrašo pakeisti negalima. Bandykite prisijungę.',
      } : prev));
    } finally {
      setFuelBusy(false);
    }
  };
  const setDateRange = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const print = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      setMessage('PDF arba spausdinimą atidarykite interneto naršyklėje.');
      return;
    }
    if (targetSheets.length === 0) {
      setMessage('Nėra kelionės lapų spausdinimui.');
      return;
    }
    const html = buildTripSheetPrintDocument({
      companyName: companyProfile.name,
      companyAddress: companyProfile.address,
      periodLabel,
      fuelType: FUEL_TYPE_LABELS[vehicleFuelType],
      groups: targetSheets.map((sheet) => ({
        monthLabel: sheet.monthLabel,
        sheetNumber: sheet.sheetNumber,
        periodLabel: sheet.periodLabel,
        registrationNumber: sheet.registrationNumber,
        vehicleModel: sheet.vehicleModel,
        driverNames: sheet.driverNames,
        fuelNorm: sheet.fuelNorm,
        tankCapacityLiters: resolveFuelTankCapacity(sheet.vehicle),
        rows: sheet.rows.map((row) => ({
          date: row.date,
          driverName: row.driverName,
          route: tripRouteLabel(row),
          startOdometer: row.startOdometer,
          endOdometer: row.endOdometer,
          distanceKm: row.distanceKm,
          fuelStart: row.fuelStart,
          fuelAdded: row.fuelAdded,
          fuelConsumed: row.fuelConsumed,
          fuelEnd: row.fuelEnd,
          receiptNumbers: row.fuelEntries.map((entry) => entry.receiptNumber).filter((value): value is string => Boolean(value)),
        })),
      })),
    });
    printHtmlDocument(html);
  };
  const exportExcel = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      setMessage('Excel eksportą atidarykite interneto naršyklėje.');
      return;
    }
    if (targetSheets.length === 0) {
      setMessage('Nėra kelionės lapų, kuriuos būtų galima eksportuoti. Pakeiskite automobilį, vairuotoją arba laikotarpį.');
      return;
    }
    try {
      const bytes = buildTripSheetWorkbook({
        companyName: companyProfile.name,
        companyAddress: companyProfile.address,
        periodLabel,
        // Suvestinė only earns its place across several sheets or the
        // all-drivers view — never as the sole/first tab of one run.
        includeSummary: targetSheets.length > 1 || !driverFilterActive,
        groups: targetSheets.map((sheet) => ({
          month: sheet.month,
          driverName: sheet.driverNames,
          registrationNumber: sheet.registrationNumber,
          vehicleModel: sheet.vehicleModel,
          sheetLabel: sheet.sheetNumber == null
            ? undefined
            : `${sheet.registrationNumber} ${sheet.driverNames} Nr.${sheet.sheetNumber}`,
          periodLabel: sheet.periodLabel,
          fuelNormLitersPer100Km: sheet.fuelNorm,
          fuelType: FUEL_TYPE_LABELS[vehicleFuelType],
          rows: sheet.rows.map((row) => ({
            date: row.date,
            driverName: row.driverName,
            route: tripRouteLabel(row),
            distanceKm: row.distanceKm,
            fuelStartLiters: row.fuelStart,
            fuelAddedLiters: row.fuelAdded ?? 0,
            receiptNumbers: row.fuelEntries.map((entry) => entry.receiptNumber).filter((value): value is string => Boolean(value)),
            fuelConsumedLiters: row.fuelConsumed,
            fuelEndLiters: row.fuelEnd,
            startOdometer: row.startOdometer,
            endOdometer: row.endOdometer,
          })),
        })),
      });
      // Copy into a fresh Uint8Array so Blob never sees fflate's sliced
      // .buffer (extra bytes / SharedArrayBuffer) — Excel then opens a
      // truncated ZIP as named-but-empty sheets.
      const payload = new Uint8Array(bytes);
      const blob = new Blob([payload], { type: MIME_XLSX });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `keliones-lapai-${selectedMonth === 'all' ? new Date().toISOString().slice(0, 10) : selectedMonth}.xlsx`;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      // Revoking the object URL synchronously can race the browser's actual
      // download write on some systems, producing a 0-byte/truncated file
      // that still opens (and looks blank) — keep the URL until the write
      // has had a long window, then detach the hidden link.
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
      setMessage(`Excel ataskaita paruošta: ${targetSheets.length} lap.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel ataskaitos sukurti nepavyko.');
    }
  };
  const showGroups = true;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, title: 'Kelionės lapai' }} />
      <FoundationScreen showFoundationNotice={false} showHeading={false} title="Kelionės lapai" description="">
        {/* Filters and actions. Spausdinti / PDF builds a dedicated kelionės
            lapas document; Ctrl+P still hides this toolbar via +html.tsx. */}
        <View style={styles.toolbar} testID="trip-sheet-toolbar">
          <Text style={styles.screenTitle}>Kelionės lapai</Text>
          <Text style={styles.screenDescription}>{profile.role === 'driver'
            ? 'Jūsų užbaigtų maršrutų faktiniai darbo duomenys.'
            : 'Pasirinkite automobilį, vairuotoją ir laikotarpį. Ataskaita atnaujinama iškart.'}</Text>
          <View style={styles.actionRow} testID="trip-sheet-controls">
            <Pressable style={styles.primaryButton} disabled={busy} onPress={() => { void load(); }} testID="refresh-trip-sheets">
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Atnaujinti</Text>}
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={print} testID="print-trip-sheets"><Text style={styles.secondaryText}>Spausdinti / PDF</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={exportExcel} testID="export-trip-sheets-xlsx"><Text style={styles.secondaryText}>Eksportuoti Excel</Text></Pressable>
          </View>
          {!online ? <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => { void syncLocal(); }} testID="sync-trip-sheets"><Text style={styles.secondaryText}>Atnaujinti iš įrenginio maršrutų</Text></Pressable> : null}
          {profile.role !== 'driver' ? <PeriodCalendarPicker
            allowClear
            from={dateFrom}
            onChange={setDateRange}
            onClear={() => setDateRange('', '')}
            testID="trip-sheet-period-calendar"
            to={dateTo}
          /> : null}
          {vehicles.length > 1 || drivers.length > 1 || months.length > 1 ? (
            <View style={styles.filterSelects} testID="trip-sheet-entity-filters">
              {vehicles.length > 1 ? (
                <View testID="trip-sheet-vehicle-filter">
                  <FiroSelect
                    label="Automobilis"
                    placeholder="Pasirinkite automobilį"
                    value={selectedVehicleId}
                    onChange={setSelectedVehicleId}
                    options={[
                      { id: 'all', primary: 'Visi automobiliai' },
                      ...vehicles.map(([id, registrationNumber]) => ({ id, primary: registrationNumber })),
                    ]}
                  />
                </View>
              ) : null}
              {drivers.length > 1 ? (
                <View testID="trip-sheet-driver-filter">
                  <FiroSelect
                    label="Vairuotojas"
                    placeholder="Pasirinkite vairuotoją"
                    value={selectedDriverId}
                    onChange={setSelectedDriverId}
                    options={[
                      { id: 'all', primary: 'Visi vairuotojai' },
                      ...drivers.map(([id, name]) => ({ id, primary: name })),
                    ]}
                  />
                </View>
              ) : null}
              {months.length > 1 ? (
                <View testID="trip-sheet-month-filter">
                  <FiroSelect
                    label="Mėnuo"
                    placeholder="Pasirinkite mėnesį"
                    value={selectedMonth}
                    onChange={setSelectedMonth}
                    options={[
                      { id: 'all', primary: 'Visi mėnesiai' },
                      ...months.map((month) => ({ id: month, primary: formatMonth(month) })),
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        </View>
        {!busy && showGroups && printableSheets.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Kelionės lapų nerasta</Text><Text style={styles.meta}>Lapas atsiranda užbaigus maršrutą. Pakeiskite automobilį, vairuotoją arba laikotarpį.</Text></View> : null}
        {showGroups && printableSheets.length > 1 ? (
          <View style={styles.selectAllRow} testID="trip-sheet-select-all">
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allSheetsSelected }}
              onPress={toggleAllSheets}
              style={styles.checkboxRow}
              testID="trip-sheet-select-all-toggle"
            >
              <View style={[styles.checkbox, allSheetsSelected && styles.checkboxChecked]}><Text style={styles.checkboxMark}>{allSheetsSelected ? '✓' : ''}</Text></View>
              <Text style={styles.checkboxLabel}>Pažymėti visus ({printableSheets.length})</Text>
            </Pressable>
            <Text style={styles.meta}>{selectedSheetKeys.size === 0 ? 'Nepažymėjus — visi matomi lapai' : `Pažymėta: ${selectedSheetKeys.size}`}</Text>
          </View>
        ) : null}
        {showGroups ? printableSheets.map((sheet) => (
          <PrintableTripSheet
            canEditFuel={canEditFuel}
            key={sheet.key}
            onFuelAction={openFuelEditor}
            onToggle={() => toggleSheet(sheet.key)}
            selectable={printableSheets.length > 1}
            selected={selectedSheetKeys.has(sheet.key)}
            sheet={sheet}
            styles={styles}
          />
        )) : null}
        {fuelEditor ? (
          <FuelEditorModal
            busy={fuelBusy}
            drivers={drivers}
            offline={!online}
            onCancel={() => setFuelEditor(null)}
            onChange={(patch) => setFuelEditor((prev) => (prev ? { ...prev, ...patch } : prev))}
            onSubmit={() => { void submitFuelEditor(); }}
            state={fuelEditor}
            styles={styles}
            vehicles={vehicles}
          />
        ) : null}
      </FoundationScreen>
    </>
  );
}

function PrintableTripSheet({ sheet, selectable, selected, onToggle, canEditFuel, onFuelAction, styles }: {
  sheet: PrintableSheet;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  canEditFuel: boolean;
  onFuelAction: (mode: FuelEditorState['mode'], row: DailyTripRow, entry?: TripDayFuelEntry) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const rows = sheet.rows;
  const totalDistance = rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalFuelAdded = rows.reduce((sum, row) => sum + (row.fuelAdded ?? 0), 0);
  const firstOdometer = rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null;
  const lastOdometer = [...rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null;
  const tankCapacityLiters = resolveFuelTankCapacity(sheet.vehicle);
  const firstFuel = openingFuelLiters(rows.map((row) => row.fuelStart));
  const lastFuel = closingFuelLiters(rows.map((row) => row.fuelEnd));
  const fuelOverCapacity = rows.some((row) =>
    fuelRemainderExceedsTank(row.fuelStart, tankCapacityLiters) || fuelRemainderExceedsTank(row.fuelEnd, tankCapacityLiters));
  const heading = sheet.sheetNumber == null ? sheet.monthLabel : `Kelionės lapas Nr. ${sheet.sheetNumber}`;
  const subheading = sheet.sheetNumber == null ? sheet.driverNames : `${sheet.driverNames} · ${sheet.periodLabel}`;
  const drivers = new Set(rows.map((row) => row.driverName.trim()).filter(Boolean)).size;
  return <View style={styles.sheet} testID={`monthly-trip-sheet-${sheet.key}`}>
    {selectable ? (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={onToggle}
        style={styles.checkboxRow}
        testID={`trip-sheet-select-${sheet.key}`}
      >
        <View style={[styles.checkbox, selected && styles.checkboxChecked]}><Text style={styles.checkboxMark}>{selected ? '✓' : ''}</Text></View>
        <Text style={styles.checkboxLabel}>{heading}{sheet.sheetNumber == null ? '' : ` — ${sheet.driverNames}`}</Text>
      </Pressable>
    ) : null}
    <View style={styles.screenView} testID="trip-sheet-screen-view">
    <View style={styles.sheetHeader}>
      <View style={styles.flex}>
        <Text style={styles.date}>{heading}</Text>
        <Text style={styles.driver}>{subheading}</Text>
      </View>
      <View style={styles.vehicleIdentity}>
        <Text style={styles.vehicleNumber}>{sheet.registrationNumber}</Text>
        {sheet.vehicle ? <Text style={styles.meta}>{sheet.vehicle.model}</Text> : null}
      </View>
    </View>

    <View style={styles.metrics} testID="trip-sheet-metrics">
      <Metric label="PASKUTINIS ODOMETRAS" value={lastOdometer === null ? '—' : `${formatNumber(lastOdometer)} km`} styles={styles} />
      <Metric label="KURO LIKUTIS PRADŽIOJE" value={firstFuel === null ? '—' : `${formatNumber(firstFuel)} l`} styles={styles} />
      <Metric label="ĮPILTA" value={`${formatNumber(totalFuelAdded)} l`} styles={styles} />
      <Metric label="SUNAUDOTA PAGAL NORMĄ" value={`${formatNumber(totalFuel)} l`} styles={styles} />
      <Metric label="DABARTINIS LIKUTIS" value={lastFuel === null ? '—' : `${formatNumber(lastFuel)} l`} styles={styles} />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.reportTableScroll}>
    <View style={styles.reportTable} testID="trip-sheet-report-table">
      <View style={[styles.reportTableRow, styles.reportTableHeader]}>
        {TRIP_SHEET_GRID_COLUMNS.map((column) => (
          <HeaderCell key={column.key} column={column} style={[styles.reportTableCell, reportCellStyle(column.key, styles)]} />
        ))}
      </View>
      {rows.map((row, index) => <View key={`${row.date}-${index}`} style={styles.reportTableRow}>
        {tripSheetCells({
          lineNumber: index + 1,
          date: row.date,
          route: tripRouteLabel(row),
          driverName: row.driverName,
          distinctDriverCount: drivers,
          distanceKm: row.distanceKm,
          fuelStart: row.fuelStart,
          fuelAdded: row.fuelAdded,
          receiptNumbers: row.fuelEntries.map((entry) => entry.receiptNumber),
          fuelConsumed: row.fuelConsumed,
          fuelEnd: row.fuelEnd,
          startOdometer: row.startOdometer,
          endOdometer: row.endOdometer,
        }).map((cell) => (
          <ReportCell key={cell.key} cell={cell} styles={styles} tankCapacityLiters={tankCapacityLiters} total={false} />
        ))}
      </View>)}
      <View style={[styles.reportTableRow, styles.reportTableTotal]}>
        {tripSheetCells({
          lineNumber: null,
          date: '',
          route: 'Iš viso',
          driverName: '',
          distinctDriverCount: 1,
          distanceKm: totalDistance,
          fuelStart: firstFuel,
          fuelAdded: totalFuelAdded,
          receiptNumbers: [],
          fuelConsumed: totalFuel,
          fuelEnd: lastFuel,
          startOdometer: firstOdometer,
          endOdometer: lastOdometer,
        }).map((cell) => (
          <ReportCell key={cell.key} cell={cell} styles={styles} tankCapacityLiters={tankCapacityLiters} total />
        ))}
      </View>
    </View>
    </ScrollView>
    <Text style={styles.columnLegend} testID="trip-sheet-column-legend">{tripSheetColumnLegend(TRIP_SHEET_GRID_COLUMNS)}</Text>
    {fuelOverCapacity ? <Text style={styles.fuelOverCapacityNote} testID="fuel-over-capacity-note">{FUEL_OVER_CAPACITY_NOTE}</Text> : null}
    {canEditFuel ? (
      <View style={styles.fuelAdmin} testID={`trip-sheet-fuel-admin-${sheet.key}`}>
        <Text style={styles.fuelEntriesTitle}>Kuro įrašai — redagavimas</Text>
        {rows.map((row) => (
          <View key={row.date} style={styles.fuelAdminDay}>
            <Text style={styles.fuelAdminDate}>{row.date}</Text>
            <View style={styles.fuelAdminList}>
              {row.fuelEntries.length === 0 ? <Text style={styles.meta}>Pylimų nėra</Text> : row.fuelEntries.map((entry) => (
                <View key={entry.id} style={styles.fuelAdminEntry}>
                  <Text style={styles.fuelAdminEntryText}>{formatNumber(entry.liters)} l{entry.receiptNumber ? ` · Ček. ${entry.receiptNumber}` : ''}</Text>
                  <Pressable onPress={() => onFuelAction('edit', row, entry)} style={styles.smallButton} testID={`fuel-edit-${entry.id}`}><Text style={styles.smallButtonText}>Taisyti</Text></Pressable>
                  <Pressable onPress={() => onFuelAction('delete', row, entry)} style={styles.deleteFuelButton} testID={`fuel-delete-${entry.id}`}><Text style={styles.deleteFuelText}>Trinti</Text></Pressable>
                </View>
              ))}
              <Pressable onPress={() => onFuelAction('add', row)} style={styles.addFuelButton} testID={`fuel-add-${sheet.key}-${row.date}`}><Text style={styles.addFuelButtonText}>+ Pridėti pylimą</Text></Pressable>
            </View>
          </View>
        ))}
      </View>
    ) : null}
    <View style={styles.monthTotal} testID="trip-sheet-month-total">
      <Text style={styles.monthTotalTitle}>VISO PASIRINKTU LAIKOTARPIU</Text>
      <Text style={styles.monthTotalText}>Nuvaziuota: {formatNumber(totalDistance)} km · Įpilta: {formatNumber(totalFuelAdded)} l · Sunaudota: {formatNumber(totalFuel)} l</Text>
    </View>
    </View>
  </View>;
}

function FuelEditorModal({ state, styles, busy, offline, vehicles, drivers, onChange, onCancel, onSubmit }: {
  state: FuelEditorState;
  styles: ReturnType<typeof createStyles>;
  busy: boolean;
  offline: boolean;
  vehicles: [string, string][];
  drivers: [string, string][];
  onChange: (patch: Partial<FuelEditorState>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const title = state.mode === 'add' ? 'Pridėti pylimą' : state.mode === 'edit' ? 'Taisyti pylimą' : 'Ištrinti pylimą?';
  const litersValid = state.mode === 'delete' || Number(state.liters.replace(',', '.')) > 0;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="trip-sheet-fuel-modal">
          <Text style={styles.modalTitle}>{title}</Text>
          {state.mode === 'delete' ? (
            <Text style={styles.body}>Įrašas bus pašalintas, o kuro likutis perskaičiuotas.</Text>
          ) : (
            <View style={styles.formGrid}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Litrai</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={(text) => onChange({ liters: text })}
                  placeholder="0"
                  style={styles.input}
                  testID="fuel-modal-liters"
                  value={state.liters}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Kasos čekio Nr.</Text>
                <TextInput
                  onChangeText={(text) => onChange({ receiptNumber: text })}
                  placeholder="—"
                  style={styles.input}
                  testID="fuel-modal-receipt"
                  value={state.receiptNumber}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Data</Text>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={(text) => onChange({ date: text })}
                  placeholder="YYYY-MM-DD"
                  style={styles.input}
                  testID="fuel-modal-date"
                  value={state.date}
                />
              </View>
              {vehicles.length > 0 ? (
                <View style={styles.field}>
                  <FiroSelect
                    label="Automobilis"
                    placeholder="Pasirinkite automobilį"
                    value={state.vehicleId}
                    onChange={(id) => onChange({ vehicleId: id })}
                    options={vehicles.map(([id, plate]) => ({ id, primary: plate }))}
                  />
                </View>
              ) : null}
              {drivers.length > 0 ? (
                <View style={styles.field}>
                  <FiroSelect
                    label="Kas pylė"
                    placeholder="Pasirinkite vairuotoją"
                    value={state.driverId}
                    onChange={(id) => onChange({ driverId: state.driverId === id ? '' : id })}
                    options={drivers.map(([id, name]) => ({ id, primary: name }))}
                  />
                </View>
              ) : null}
            </View>
          )}
          {offline ? <Text style={styles.formError} testID="fuel-modal-offline">Įrenginys gali būti neprisijungęs — jei nepavyks, bandykite dar kartą prisijungę.</Text> : null}
          {state.error ? <Text style={styles.formError} testID="fuel-modal-error">{state.error}</Text> : null}
          <View style={styles.formActions}>
            <Pressable onPress={onCancel} style={styles.cancelFuelButton} testID="fuel-modal-cancel"><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
            <Pressable
              disabled={busy || !litersValid}
              onPress={onSubmit}
              style={[state.mode === 'delete' ? styles.deleteFuelConfirm : styles.saveFuelButton, (busy || !litersValid) && styles.disabled]}
              testID="fuel-modal-submit"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{state.mode === 'delete' ? 'Ištrinti' : 'Išsaugoti'}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildMonthlyGroups(sheets: DisplayTripSheet[], ledgerSourceSheets: DisplayTripSheet[] = sheets): MonthlyTripGroup[] {
  // Grouped by vehicle+month only — not by driver — so one vehicle's trip
  // sheet stays a single continuous report covering every driver who used it
  // that period, with each day showing its own driver. Selecting a specific
  // driver filter narrows `sheets` before this runs, so the sheet then only
  // contains that driver's days, still as one report.
  const groups = new Map<string, { month: string; vehicle: ServerTripSheet['vehicle']; sheets: DisplayTripSheet[] }>();
  for (const sheet of sheets) {
    const month = sheet.date.slice(0, 7);
    const vehicleKey = sheet.vehicle?.id ?? 'no-vehicle';
    const key = `${month}:${vehicleKey}`;
    const current = groups.get(key) ?? { month, vehicle: sheet.vehicle, sheets: [] };
    current.sheets.push(sheet);
    groups.set(key, current);
  }
  return [...groups.entries()]
    // A trip sheet without a vehicle has nothing meaningful to report — skip it
    // rather than rendering an all-zero "Automobilis nepriskirtas" card.
    .filter(([, group]) => group.vehicle)
    .map(([key, group]) => ({
      key,
      month: group.month,
      vehicle: group.vehicle,
      rows: buildDailyRows(group.sheets, ledgerSourceSheets.filter((sheet) => (
        sheet.date.startsWith(group.month)
        && (sheet.vehicle?.id ?? 'no-vehicle') === (group.vehicle?.id ?? 'no-vehicle')
      ))),
    })).sort((left, right) => right.month.localeCompare(left.month) || (left.vehicle?.registrationNumber ?? '').localeCompare(right.vehicle?.registrationNumber ?? '', 'lt'));
}

function buildDailyRows(sheets: DisplayTripSheet[], ledgerSheets: DisplayTripSheet[] = sheets): DailyTripRow[] {
  const ledgerRows = buildDailyRowsWithoutLedger(ledgerSheets);
  const ledgerByDate = new Map(applyFuelLedger(ledgerRows, ledgerSheets).map((row) => [row.date, row]));
  return buildDailyRowsWithoutLedger(sheets).map((day) => {
    const ledgerDay = ledgerByDate.get(day.date);
    return {
      ...day,
      // A fuel-only day has no trip. Show 0 km after the ledger has already
      // treated the null distance as zero consumption.
      distanceKm: presentedDistanceKm(day),
      fuelConsumed: ledgerDay?.fuelConsumed ?? null,
      fuelStart: ledgerDay?.fuelStart ?? null,
      fuelEnd: ledgerDay?.fuelEnd ?? null,
      fuelMissing: ledgerDay?.fuelMissing ?? null,
    };
  });
}

function buildDailyRowsWithoutLedger(sheets: DisplayTripSheet[]): Omit<DailyTripRow, 'fuelConsumed' | 'fuelStart' | 'fuelEnd' | 'fuelMissing'>[] {
  return assembleDailyTripRows(sheets).map((day) => ({
    ...day,
    routeNumbers: dailyRouteNumbers(sheets.filter((sheet) => sheet.date === day.date)),
  }));
}

function applyFuelLedger(
  days: Omit<DailyTripRow, 'fuelConsumed' | 'fuelStart' | 'fuelEnd' | 'fuelMissing'>[],
  sheets: DisplayTripSheet[],
): DailyTripRow[] {
  // The tank balance is a running total across the month, not a per-day figure:
  // each day opens on what the previous day left. The opening reading is the
  // approved balance dated on or before the first day of this period — an
  // administrator's correction, or the driver's confirmed reading. Only when no
  // anchor exists that early does it fall back to the vehicle's current
  // remaining litres, which is right for the running month but not for an old one.
  const firstDate = days[0]?.date;
  const firstDaySheets = firstDate ? sheets.filter((sheet) => sheet.date === firstDate) : [];
  const anchorOnFirstDay = firstDaySheets.map((sheet) => sheet.fuelAnchor).find(Boolean) ?? null;
  // A fuel fill with no trip of its own has no sheet yet. Use an already
  // confirmed balance from this vehicle only when that balance is dated on
  // or before the fill. A later correction must not leak backwards.
  const carriedAnchor = !anchorOnFirstDay && firstDaySheets.length === 0 && firstDate
    ? sheets
      .map((sheet) => sheet.fuelAnchor)
      .filter((anchor): anchor is { liters: number; effectiveAt: string } => !!anchor && anchor.effectiveAt <= firstDate)
      .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null
    : null;
  const firstAnchor = anchorOnFirstDay ?? carriedAnchor;
  const openingLiters = firstAnchor?.liters
    ?? sheets
      .map((sheet) => sheet.vehicle?.fuelRemainingLiters)
      .find((value): value is number => value !== null && value !== undefined)
    ?? null;
  const ledger = buildFuelLedger(
    days.map((day) => {
      const fuelOnly = fuelFillContinuesLedger(day);
      return {
        date: day.date,
        distanceKm: fuelOnly ? 0 : day.distanceKm,
        fuelOnly,
        fuelNormLPer100Km: day.fuelNorm,
        addedLiters: day.fuelAdded ?? 0,
      };
    }),
    openingLiters,
  );

  return days.map((day, index) => ({
    ...day,
    fuelConsumed: ledger[index]!.consumedLiters,
    fuelStart: ledger[index]!.startLiters,
    fuelEnd: ledger[index]!.endLiters,
    fuelMissing: ledger[index]!.missing,
  }));
}

function HeaderCell({ column, style }: { column: (typeof TRIP_SHEET_GRID_COLUMNS)[number]; style: StyleProp<TextStyle> }) {
  return <Text accessibilityLabel={column.full} style={style}>{column.short}</Text>;
}

function reportCellStyle(key: TripSheetCell['key'], styles: ReturnType<typeof createStyles>) {
  if (key === 'line') return styles.reportLineCell;
  if (key === 'date') return styles.reportDateCell;
  if (key === 'route') return styles.reportRouteCell;
  if (key === 'receipt') return styles.reportReceiptCell;
  if (key === 'fuelStart' || key === 'fuelEnd' || key === 'consumed') return styles.reportWideNumberCell;
  if (key === 'odoStart' || key === 'odoEnd') return styles.reportOdoCell;
  return styles.reportNumberCell;
}

function ReportCell({ cell, total, tankCapacityLiters, styles }: {
  cell: TripSheetCell;
  total: boolean;
  tankCapacityLiters: number | null;
  styles: ReturnType<typeof createStyles>;
}) {
  const style = [styles.reportTableCell, reportCellStyle(cell.key, styles), total ? styles.reportTotalText : null];
  if (cell.key === 'fuelStart' || cell.key === 'fuelEnd') {
    return <FuelLiterCell cellStyle={reportCellStyle(cell.key, styles)} styles={styles} tankCapacityLiters={tankCapacityLiters} total={total} value={typeof cell.value === 'number' ? cell.value : null} />;
  }
  const text = cell.value === null || cell.value === ''
    ? (total ? '' : '—')
    : typeof cell.value === 'number' ? formatNumber(cell.value) : cell.value;
  return <Text style={style}>{text}</Text>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

async function localSheets(repository: TripSheetRepository): Promise<DisplayTripSheet[]> {
  const [sheets, entries] = await Promise.all([repository.list(), repository.listFuelEntries()]);
  return sheets.map((sheet) => localSheet(sheet, entries.filter((entry) => entry.tripSheetId === sheet.id)));
}

function localSheet(sheet: TripSheetWithRoutes, fuelEntries: TripFuelEntry[] = []): DisplayTripSheet {
  return {
    id: sheet.id, assignmentId: sheet.id, routeId: sheet.routeIds[0] ?? sheet.id, routeNumbers: [], date: sheet.date, status: 'completed',
    driverId: 'local', driverName: 'Šio įrenginio vairuotojas', vehicle: { id: sheet.vehicleId, registrationNumber: sheet.vehicleName, model: sheet.vehicleName, maximumPayloadKg: 0 }, fuelNormLitersPer100Km: null,
    startOdometer: sheet.startOdometer, endOdometer: sheet.endOdometer, actualDistanceKm: sheet.actualDistanceKm,
    plannedDistanceKm: sheet.plannedDistanceKm, startedAt: sheet.actualStartAt, completedAt: sheet.completedAt,
    durationMinutes: sheet.actualDurationMinutes, totalStops: sheet.totalStops, deliveredStops: sheet.totalStops,
    totalWeightKg: sheet.totalDeliveredWeightKg, deliveredWeightKg: sheet.totalDeliveredWeightKg,
    startAddress: sheet.startLocation.address ?? sheet.startLocation.label, endAddress: sheet.endLocation.address ?? sheet.endLocation.label, compensation: null, source: 'local', fuelEntries,
  };
}

function tripRouteLabel(row: DailyTripRow): string {
  return tripSheetRouteLabel(row);
}
function formatMonth(value: string): string { const date = new Date(`${value}-15T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(date); }
function FuelLiterCell({ value, tankCapacityLiters, styles, total = false, cellStyle }: {
  value: number | null;
  tankCapacityLiters: number | null;
  styles: ReturnType<typeof createStyles>;
  total?: boolean;
  cellStyle: StyleProp<TextStyle>;
}) {
  const over = fuelRemainderExceedsTank(value, tankCapacityLiters);
  return <Text accessibilityLabel={over ? `${formatNumber(value)}. ${FUEL_OVER_CAPACITY_NOTE}` : undefined} style={[styles.reportTableCell, cellStyle, total ? styles.reportTotalText : null, over ? styles.fuelOverCapacity : null]}>{formatNumber(value)}</Text>;
}

function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value); }
const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 120, minHeight: 48, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  toolbar: { gap: spacing.md, marginBottom: spacing.lg },
  screenTitle: { ...type.pageTitle, color: colors.text, letterSpacing: -0.3 }, screenDescription: { ...type.body, color: colors.textMuted },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, dateRange: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, dateInput: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  primaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, secondaryText: { ...type.button, color: colors.textSecondary },
  filterSelects: { gap: spacing.sm },
  message: { ...type.secondary, color: colors.textMuted }, empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  sheet: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  screenView: { gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, flex: { flex: 1, minWidth: 0 }, date: { ...type.sectionTitle, color: colors.text }, driver: { ...type.bodyStrong, color: colors.info, marginTop: 2 },
  vehicleIdentity: { alignItems: 'flex-end', gap: 2 },
  routeBadge: { borderRadius: radius.sm, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, routeBadgeText: { ...type.label, color: colors.info },
  vehicleBar: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 2 }, vehicleNumber: { ...type.readout, color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, minWidth: 115, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle, gap: 2 }, metricLabel: { ...type.label, color: colors.textMuted }, metricValue: { ...type.bodyStrong, color: colors.text },
  reportTable: { minWidth: 1040, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, overflow: 'hidden' },
  reportTableScroll: { minWidth: '100%' },
  reportTableRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  reportTableHeader: { minHeight: 56, backgroundColor: colors.surfaceMuted },
  reportTableTotal: { backgroundColor: colors.infoSoft, borderBottomWidth: 0 },
  reportTableCell: { ...type.meta, color: colors.text, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  reportLineCell: { width: 56, textAlign: 'right' },
  reportDateCell: { width: 96 },
  reportRouteCell: { flex: 1, minWidth: 140 },
  reportReceiptCell: { width: 96 },
  reportNumberCell: { width: 68, textAlign: 'right' },
  reportWideNumberCell: { width: 118, textAlign: 'right' },
  reportOdoCell: { width: 84, textAlign: 'right' },
  reportTotalText: { ...type.secondaryStrong },
  columnLegend: { ...type.meta, color: colors.textMuted },
  fuelOverCapacity: { color: colors.warning },
  fuelOverCapacityNote: { ...type.secondary, color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: radius.sm, padding: spacing.sm },
  compensation: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceSubtle, gap: spacing.sm }, compensationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, compensationEyebrow: { ...type.label, color: colors.success }, compensationTotal: { ...type.readout, color: colors.text, marginTop: 2 }, compensationSource: { ...type.secondary, color: colors.textMuted }, compensationRows: { gap: 3 }, compensationLine: { ...type.secondary, color: colors.textSecondary },
  routeBlock: { borderLeftWidth: 3, borderLeftColor: colors.info, paddingLeft: spacing.sm, gap: 2 }, routeLabel: { ...type.label, color: colors.textMuted }, routeAddress: { ...type.body, color: colors.text }, cardTitle: { ...type.sectionTitle, color: colors.text }, meta: { ...type.secondary, color: colors.textMuted },
  tableHeader: { minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableHeaderText: { ...type.label, color: colors.textMuted },
  tableBody: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  tableRow: { minHeight: 68, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableCell: { ...type.secondary, color: colors.text, textAlign: 'right' },
  tableStrong: { ...type.bodyStrong, color: colors.text },
  tableMeta: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  dateColumn: { width: 72 },
  routeColumn: { flex: 1, minWidth: 180 },
  numberColumn: { width: 112, textAlign: 'right' },
  moneyColumn: { width: 92, textAlign: 'right' },
  mobileDayRow: { paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  mobileDayHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mobileDayDate: { ...type.cardTitle, color: colors.text },
  mobileDayMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addFuelPrimary: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.info, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  addFuelPrimaryText: { ...type.button, color: colors.textInverse },
  detailsToggle: { flexGrow: 1, minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  detailsToggleText: { ...type.button, color: colors.textSecondary },
  chevron: { ...type.sectionTitle, color: colors.info, minWidth: 24, textAlign: 'center' },
  dayList: { gap: spacing.sm },
  detailsSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  detailsSummaryText: { ...type.secondaryStrong, color: colors.textSecondary },
  dayRow: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  daySummary: { minHeight: 72, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSubtle },
  dayFuelSummary: { alignItems: 'flex-end', gap: 2 },
  dayFuelValue: { ...type.bodyStrong, color: colors.success },
  dayDetails: { padding: spacing.md, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  fuelEntries: { gap: spacing.xs },
  fuelEntriesTitle: { ...type.label, color: colors.textMuted },
  fuelEntryRow: { minHeight: 52, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  entryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  smallButton: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { ...type.label, color: colors.info },
  deleteFuelButton: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  deleteFuelText: { ...type.label, color: colors.danger },
  addFuelButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.info, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  addFuelButtonText: { ...type.button, color: colors.info },
  fuelForm: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderStrong, gap: spacing.sm },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { flexGrow: 1, flexBasis: 180, minWidth: 0, gap: spacing.xs },
  fieldLabel: { ...type.label, color: colors.textSecondary },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...type.body, color: colors.text },
  formError: { ...type.secondaryStrong, color: colors.danger },
  formActions: { flexDirection: 'row', gap: spacing.sm },
  cancelFuelButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveFuelButton: { flex: 1, minHeight: 48, backgroundColor: colors.success, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
  calculationNote: { ...type.meta, color: colors.textMuted, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle }, monthTotal: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.info, gap: spacing.xs }, monthTotalTitle: { ...type.label, color: colors.info }, monthTotalText: { ...type.bodyStrong, color: colors.text },
  selectAllRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingRight: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxChecked: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  checkboxMark: { ...type.secondaryStrong, color: colors.textInverse, lineHeight: 20 },
  checkboxLabel: { ...type.secondaryStrong, color: colors.text, flexShrink: 1 },
  body: { ...type.body, color: colors.text },
  fuelAdmin: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceSubtle, gap: spacing.sm },
  fuelAdminDay: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.xs },
  fuelAdminDate: { ...type.label, color: colors.textMuted },
  fuelAdminList: { gap: spacing.xs },
  fuelAdminEntry: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  fuelAdminEntryText: { ...type.secondaryStrong, color: colors.text, flexGrow: 1, minWidth: 120 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 520, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  modalTitle: { ...type.sectionTitle, color: colors.text },
  deleteFuelConfirm: { flex: 1, minHeight: 48, backgroundColor: colors.danger, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
