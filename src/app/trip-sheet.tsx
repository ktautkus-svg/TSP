import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { CompanyProfileSettings, type CompanyProfile } from '@/application/settings/company-profile';
import { buildTripSheetWorkbook, MIME_XLSX } from '@/application/trip-sheet/export-xlsx';
import { buildFuelLedger, type FuelLedgerDay } from '@/application/trip-sheet/fuel-balance';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
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
  fuelEntries: TripFuelEntry[];
};
type MonthlyTripGroup = {
  key: string;
  month: string;
  vehicle: ServerTripSheet['vehicle'];
  rows: DailyTripRow[];
};

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
  // Hides the shared navigation header for the duration of printing — the
  // header lives outside this screen's own tree (rendered by Stack.Screen),
  // so CSS alone can't reach it. Restored on the browser's 'afterprint' event
  // so it comes back even if the user cancels the print dialog.
  const [printMode, setPrintMode] = useState(false);
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
  const visible = sheets.filter((sheet) =>
    (profile.role === 'driver' || selectedDriverId === 'all' || sheet.driverId === selectedDriverId)
    && (selectedVehicleId === 'all' || sheet.vehicle?.id === selectedVehicleId)
    && (selectedMonth === 'all' || sheet.date.startsWith(selectedMonth))
    && (!dateFrom || sheet.date >= dateFrom)
    && (!dateTo || sheet.date <= dateTo));
  const monthlyGroups = useMemo(() => buildMonthlyGroups(visible), [visible]);
  const periodLabel = dateFrom || dateTo ? `${dateFrom || '...'} - ${dateTo || '...'}` : selectedMonth === 'all' ? 'Visas laikotarpis' : formatMonth(selectedMonth);
  const selectFilter = (apply: () => void) => { apply(); };
  const setDateRange = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const print = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setMessage('PDF arba spausdinimą atidarykite interneto naršyklėje.');
      return;
    }
    setPrintMode(true);
    // Let the header actually unmount (headerShown: false) before the print
    // dialog captures the page — a same-tick window.print() would still
    // catch it mid-render.
    requestAnimationFrame(() => {
      window.print();
    });
    const restore = () => { setPrintMode(false); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
  };
  const exportExcel = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setMessage('Excel eksportą atidarykite interneto naršyklėje.');
      return;
    }
    try {
      const bytes = buildTripSheetWorkbook({
        companyName: companyProfile.name,
        companyAddress: companyProfile.address,
        groups: monthlyGroups.map((group) => ({
          month: group.month,
          driverName: [...new Set(group.rows.map((row) => row.driverName))].join(', '),
          registrationNumber: group.vehicle?.registrationNumber ?? 'be-numerio',
          vehicleModel: group.vehicle?.model ?? 'Automobilis nepriskirtas',
          fuelNormLitersPer100Km: group.rows[0]?.fuelNorm ?? null,
          fuelType: FUEL_TYPE_LABELS[vehicleFuelType],
          rows: group.rows.map((row) => ({
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
      const payload = new Uint8Array(bytes.byteLength);
      payload.set(bytes);
      const blob = new Blob([payload.buffer], { type: MIME_XLSX });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `keliones-lapai-${selectedMonth === 'all' ? new Date().toISOString().slice(0, 10) : selectedMonth}.xlsx`;
      link.click();
      // Revoking the object URL synchronously can race the browser's actual
      // download write on some systems, producing a 0-byte/truncated file
      // that still opens (and looks blank) — give it a beat first.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage(`Excel ataskaita paruošta: ${monthlyGroups.length} lap.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel ataskaitos sukurti nepavyko.');
    }
  };
  const showGroups = true;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, headerShown: !printMode, title: 'Kelionės lapai' }} />
      <FoundationScreen showFoundationNotice={false} showHeading={false} title="Kelionės lapai" description="">
        {/* Everything except the report itself — hidden as one block when
            printing (see +html.tsx), so a new control added here never needs
            a matching print-CSS update to stay off the printed page. */}
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
          {profile.role !== 'driver' ? <View style={styles.dateRange} testID="trip-sheet-date-range">
            <DateInput accessibilityLabel="Nuo" value={dateFrom} onChangeText={setDateFrom} style={[styles.input, styles.dateInput]} placeholderTextColor={colors.textMuted} />
            <DateInput accessibilityLabel="Iki" value={dateTo} onChangeText={setDateTo} style={[styles.input, styles.dateInput]} placeholderTextColor={colors.textMuted} />
          </View> : null}
          {profile.role !== 'driver' ? <View style={styles.filters} testID="trip-sheet-date-presets">
            {DATE_PRESETS.map((preset) => <Filter key={preset.kind} label={preset.label} active={false} onPress={() => { const [from, to] = datePresetRange(preset.kind); setDateRange(from, to); }} styles={styles} />)}
            {dateFrom || dateTo ? <Filter label="Išvalyti" active={false} onPress={() => setDateRange('', '')} styles={styles} /> : null}
          </View> : null}
          {vehicles.length > 1 ? <View style={styles.filters} testID="trip-sheet-vehicle-filter">
            <Filter label="Visi automobiliai" active={selectedVehicleId === 'all'} onPress={() => selectFilter(() => setSelectedVehicleId('all'))} styles={styles} />
            {vehicles.map(([id, registrationNumber]) => <Filter key={id} label={registrationNumber} active={selectedVehicleId === id} onPress={() => selectFilter(() => setSelectedVehicleId(id))} styles={styles} />)}
          </View> : null}
          {drivers.length > 1 ? <View style={styles.filters} testID="trip-sheet-driver-filter">
            <Filter label="Visi vairuotojai" active={selectedDriverId === 'all'} onPress={() => selectFilter(() => setSelectedDriverId('all'))} styles={styles} />
            {drivers.map(([id, name]) => <Filter key={id} label={name} active={selectedDriverId === id} onPress={() => selectFilter(() => setSelectedDriverId(id))} styles={styles} />)}
          </View> : null}
          {months.length > 1 ? <View style={styles.filters} testID="trip-sheet-month-filter">
            <Filter label="Visi mėnesiai" active={selectedMonth === 'all'} onPress={() => selectFilter(() => setSelectedMonth('all'))} styles={styles} />
            {months.map((month) => <Filter key={month} label={formatMonth(month)} active={selectedMonth === month} onPress={() => selectFilter(() => setSelectedMonth(month))} styles={styles} />)}
          </View> : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        </View>
        {!busy && showGroups && monthlyGroups.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Kelionės lapų nerasta</Text><Text style={styles.meta}>Lapas atsiranda užbaigus maršrutą. Pakeiskite automobilį, vairuotoją arba laikotarpį.</Text></View> : null}
        {showGroups ? monthlyGroups.map((group) => <MonthlyTripSheet companyProfile={companyProfile} group={group} key={group.key} periodLabel={periodLabel} styles={styles} vehicleFuelType={vehicleFuelType} />) : null}
      </FoundationScreen>
    </>
  );
}

function MonthlyTripSheet({ group, periodLabel, styles, companyProfile, vehicleFuelType }: {
  group: MonthlyTripGroup;
  periodLabel: string;
  styles: ReturnType<typeof createStyles>;
  companyProfile: CompanyProfile;
  vehicleFuelType: FuelType;
}) {
  const totalDistance = group.rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = group.rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalFuelAdded = group.rows.reduce((sum, row) => sum + (row.fuelAdded ?? 0), 0);
  const firstOdometer = group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null;
  const lastOdometer = [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null;
  const firstFuel = group.rows.find((row) => row.fuelStart !== null)?.fuelStart ?? null;
  const lastFuel = [...group.rows].reverse().find((row) => row.fuelEnd !== null)?.fuelEnd ?? null;
  const driverNames = [...new Set(group.rows.map((row) => row.driverName))].join(', ');
  return <View style={styles.sheet} testID={`monthly-trip-sheet-${group.key}`}>
    <View style={styles.screenView} testID="trip-sheet-screen-view">
    <View style={styles.sheetHeader}>
      <View style={styles.flex}>
        <Text style={styles.date}>{formatMonth(group.month)}</Text>
        <Text style={styles.driver}>{driverNames}</Text>
      </View>
      <View style={styles.vehicleIdentity}>
        <Text style={styles.vehicleNumber}>{group.vehicle?.registrationNumber ?? 'Automobilis nepriskirtas'}</Text>
        {group.vehicle ? <Text style={styles.meta}>{group.vehicle.model}</Text> : null}
      </View>
    </View>

    <View style={styles.metrics}>
      <Metric label="PASKUTINIS ODOMETRAS" value={lastOdometer === null ? '—' : `${formatNumber(lastOdometer)} km`} styles={styles} />
      <Metric label="KURO LIKUTIS PRADŽIOJE" value={firstFuel === null ? '—' : `${formatNumber(firstFuel)} l`} styles={styles} />
      <Metric label="ĮPILTA" value={`${formatNumber(totalFuelAdded)} l`} styles={styles} />
      <Metric label="SUNAUDOTA PAGAL NORMĄ" value={`${formatNumber(totalFuel)} l`} styles={styles} />
      <Metric label="DABARTINIS LIKUTIS" value={lastFuel === null ? '—' : `${formatNumber(lastFuel)} l`} styles={styles} />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.reportTableScroll}>
    <View style={styles.reportTable} testID="trip-sheet-report-table">
      <View style={[styles.reportTableRow, styles.reportTableHeader]}>
        <Text style={[styles.reportTableCell, styles.reportDateCell]}>Data</Text>
        <Text style={[styles.reportTableCell, styles.reportDriverCell]}>Vairuotojas</Text>
        <Text style={[styles.reportTableCell, styles.reportRouteCell]}>Kur važiuota</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Odometras pradžioje</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Odometras pabaigoje</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Nuvažiuota, km</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Sunaudota, l</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Įpilta, l</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Likutis pradžioje</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>Likutis pabaigoje</Text>
      </View>
      {group.rows.map((row) => <View key={row.date} style={styles.reportTableRow}>
        <Text style={[styles.reportTableCell, styles.reportDateCell]}>{row.date}</Text>
        <Text style={[styles.reportTableCell, styles.reportDriverCell]}>{row.driverName}</Text>
        <Text style={[styles.reportTableCell, styles.reportRouteCell]}>{tripRouteLabel(row)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.startOdometer)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.endOdometer)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.distanceKm)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.fuelConsumed)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.fuelAdded)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.fuelStart)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(row.fuelEnd)}</Text>
      </View>)}
      <View style={[styles.reportTableRow, styles.reportTableTotal]}>
        <Text style={[styles.reportTableCell, styles.reportDateCell]} />
        <Text style={[styles.reportTableCell, styles.reportDriverCell]} />
        <Text style={[styles.reportTableCell, styles.reportRouteCell, styles.reportTotalText]}>Iš viso</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell, styles.reportTotalText]}>{formatNumber(firstOdometer)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell, styles.reportTotalText]}>{formatNumber(lastOdometer)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell, styles.reportTotalText]}>{formatNumber(totalDistance)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell, styles.reportTotalText]}>{formatNumber(totalFuel)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell, styles.reportTotalText]}>{formatNumber(totalFuelAdded)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(firstFuel)}</Text>
        <Text style={[styles.reportTableCell, styles.reportNumberCell]}>{formatNumber(lastFuel)}</Text>
      </View>
    </View>
    </ScrollView>
    <View style={styles.monthTotal}>
      <Text style={styles.monthTotalTitle}>VISO PASIRINKTU LAIKOTARPIU</Text>
      <Text style={styles.monthTotalText}>Nuvaziuota: {formatNumber(totalDistance)} km · Įpilta: {formatNumber(totalFuelAdded)} l · Sunaudota: {formatNumber(totalFuel)} l</Text>
    </View>
    </View>

    <View style={styles.printSheet} testID="trip-sheet-print-view">
      <Text style={styles.printTitle}>Kelionės lapų ataskaita</Text>
      <Text style={styles.printCompanyLine}>{[companyProfile.name, companyProfile.address].filter((part) => part.trim()).join(', ') || ' '}</Text>
      <View style={styles.printMetaRow}>
        <Text style={styles.printMetaText}>Transporto priemonė: {group.vehicle?.model ?? '—'}</Text>
        <Text style={styles.printMetaText}>Degalų norma: {formatFuelNorm(group.rows[0]?.fuelNorm ?? null)}</Text>
        <Text style={styles.printMetaText}>Kuro tipas: {FUEL_TYPE_LABELS[vehicleFuelType]}</Text>
      </View>
      <View style={styles.printMetaRow}>
        <Text style={styles.printMetaText}>Vairuotojas(-ai): {driverNames}</Text>
        <Text style={styles.printMetaText}>Laikotarpis: {periodLabel}</Text>
      </View>

      <View style={styles.printTable}>
        <View style={[styles.printRow, styles.printHeadRow]}>
          <Text style={[styles.printCell, styles.printCellDate, styles.printHeadText]}>Data</Text>
          <Text style={[styles.printCell, styles.printCellDriver, styles.printHeadText]}>Vairuotojas</Text>
          <Text style={[styles.printCell, styles.printCellRoute, styles.printHeadText]}>Maršrutas</Text>
          <Text style={[styles.printCell, styles.printCellOdometer, styles.printHeadText]}>Odometras pradžioje</Text>
          <Text style={[styles.printCell, styles.printCellOdometer, styles.printHeadText]}>Odometras pabaigoje</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Atstumas, km</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Kuras dienos pradžioje, L</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Įpilta kuro, L</Text>
          <Text style={[styles.printCell, styles.printCellReceipt, styles.printHeadText]}>Kasos čekio Nr.</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Degalų sąnaudos pagal normą, L</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Kuro likutis, L</Text>
        </View>
        {group.rows.map((row) => (
          <View key={row.date} style={styles.printRow}>
            <Text style={[styles.printCell, styles.printCellDate]}>{row.date}</Text>
            <Text style={[styles.printCell, styles.printCellDriver]}>{row.driverName}</Text>
            <Text style={[styles.printCell, styles.printCellRoute]}>{tripRouteLabel(row)}</Text>
            <Text style={[styles.printCell, styles.printCellOdometer]}>{formatNumber(row.startOdometer)}</Text>
            <Text style={[styles.printCell, styles.printCellOdometer]}>{formatNumber(row.endOdometer)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{formatNumber(row.distanceKm)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{row.fuelStart === null ? '—' : formatNumber(row.fuelStart)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{formatNumber(row.fuelAdded)}</Text>
            <Text style={[styles.printCell, styles.printCellReceipt]}>{row.fuelEntries.map((entry) => entry.receiptNumber).filter(Boolean).join(' / ') || '—'}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{row.fuelConsumed === null ? '0,00' : formatNumber(row.fuelConsumed)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{row.fuelEnd === null ? '—' : formatNumber(row.fuelEnd)}</Text>
          </View>
        ))}
        <View style={[styles.printRow, styles.printTotalRow]}>
          <Text style={[styles.printCell, styles.printCellDate]} />
          <Text style={[styles.printCell, styles.printCellDriver]} />
          <Text style={[styles.printCell, styles.printCellRoute, styles.printHeadText]}>Iš viso:</Text>
          <Text style={[styles.printCell, styles.printCellOdometer, styles.printHeadText]}>{formatNumber(firstOdometer)}</Text>
          <Text style={[styles.printCell, styles.printCellOdometer, styles.printHeadText]}>{formatNumber(lastOdometer)}</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalDistance)}</Text>
          <Text style={[styles.printCell, styles.printCellNum]} />
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalFuelAdded)}</Text>
          <Text style={[styles.printCell, styles.printCellReceipt]} />
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalFuel)}</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{lastFuel === null ? '—' : formatNumber(lastFuel)}</Text>
        </View>
      </View>

      <View style={styles.printSignatures}>
        <Text style={styles.printSignatureLine}>Kelionės lapą išdavė ______________________________ (vardas, pavardė, parašas, data)</Text>
        <Text style={styles.printSignatureLine}>Vadovas ______________________________ (vardas, pavardė, parašas, data)</Text>
        <Text style={styles.printSignatureLine}>Kelionės lapą priėmė ______________________________ (vardas, pavardė, parašas, data)</Text>
      </View>

      <View style={styles.printSummaryTable}>
        <View style={styles.printSummaryRow}>
          <Text style={styles.printSummaryLabel}>Odometro parodymai</Text>
          <Text style={styles.printSummaryCell}>Pradžioje: {formatNumber(firstOdometer)}</Text>
          <Text style={styles.printSummaryCell}>Pabaigoje: {formatNumber(lastOdometer)}</Text>
          <Text style={styles.printSummaryCell}>Atstumas: {formatNumber(totalDistance)}</Text>
        </View>
        <View style={styles.printSummaryRow}>
          <Text style={styles.printSummaryLabel}>Degalai</Text>
          <Text style={styles.printSummaryCell}>Likutis pradžioje: {firstFuel === null ? '—' : formatNumber(firstFuel)}</Text>
          <Text style={styles.printSummaryCell}>Likutis pabaigoje: {lastFuel === null ? '—' : formatNumber(lastFuel)}</Text>
          <Text style={styles.printSummaryCell}>Įpilta: {formatNumber(totalFuelAdded)}</Text>
          <Text style={styles.printSummaryCell}>Sunaudota: {formatNumber(totalFuel)}</Text>
          <Text style={styles.printSummaryCell}>Norma: {formatFuelNorm(group.rows[0]?.fuelNorm ?? null)}</Text>
        </View>
      </View>
    </View>
  </View>;
}

function buildMonthlyGroups(sheets: DisplayTripSheet[]): MonthlyTripGroup[] {
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
      rows: buildDailyRows(group.sheets),
    })).sort((left, right) => right.month.localeCompare(left.month) || (left.vehicle?.registrationNumber ?? '').localeCompare(right.vehicle?.registrationNumber ?? '', 'lt'));
}

function buildDailyRows(sheets: DisplayTripSheet[]): DailyTripRow[] {
  const byDate = new Map<string, DisplayTripSheet[]>();
  for (const sheet of sheets) byDate.set(sheet.date, [...(byDate.get(sheet.date) ?? []), sheet]);
  const days = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, daySheets]) => {
    const startOdometer = minimum(daySheets.map((sheet) => sheet.startOdometer));
    const endOdometer = maximum(daySheets.map((sheet) => sheet.endOdometer));
    // The odometer is the truth once both readings are in; the planned figure
    // only stands in until the driver closes the day.
    const odometerKm = startOdometer !== null && endOdometer !== null && endOdometer >= startOdometer
      ? endOdometer - startOdometer
      : null;
    const plannedValues = daySheets
      .map((sheet) => sheet.actualDistanceKm ?? sheet.plannedDistanceKm)
      .filter((value): value is number => value !== null);
    const plannedKm = plannedValues.length > 0 ? plannedValues.reduce((sum, value) => sum + value, 0) : null;
    const distanceKm = odometerKm ?? plannedKm;
    const fuelNorm = daySheets.find((sheet) => sheet.fuelNormLitersPer100Km !== null)?.fuelNormLitersPer100Km ?? null;
    const fuelEntries = daySheets.flatMap((sheet) => sheet.fuelEntries).sort((left, right) => left.filledAt.localeCompare(right.filledAt));
    const compensation = daySheets.find((sheet) => sheet.compensation)?.compensation ?? null;
    const targetSheet = daySheets[daySheets.length - 1]!;
    return {
      date,
      driverName: targetSheet.driverName,
      routeNumbers: [...new Set(daySheets.flatMap((sheet) => sheet.routeNumbers))],
      startAddress: daySheets[0]?.startAddress ?? 'Pradžia nenurodyta',
      endAddress: daySheets[daySheets.length - 1]?.endAddress ?? 'Pabaiga nenurodyta',
      startOdometer,
      endOdometer,
      distanceKm,
      distanceSource: odometerKm !== null ? ('odometer' as const) : plannedKm !== null ? ('planned' as const) : null,
      fuelNorm,
      fuelAdded: fuelEntries.reduce((sum, entry) => sum + entry.liters, 0),
      compensationEur: compensation?.totalNetEur ?? null,
      compensationPreliminary: compensation?.preliminary ?? true,
      assignmentId: targetSheet.assignmentId,
      tripSheetId: targetSheet.id,
      vehicleId: targetSheet.vehicle?.id ?? null,
      source: targetSheet.source,
      fuelEntries,
    };
  });

  // The tank balance is a running total across the month, not a per-day figure:
  // each day opens on what the previous day left. The opening reading is the
  // approved balance dated on or before the first day of this period — an
  // administrator's correction, or the driver's confirmed reading. Only when no
  // anchor exists that early does it fall back to the vehicle's current
  // remaining litres, which is right for the running month but not for an old one.
  const firstAnchor = days[0]
    ? sheets.filter((sheet) => sheet.date === days[0]!.date).map((sheet) => sheet.fuelAnchor).find(Boolean) ?? null
    : null;
  const openingLiters = firstAnchor?.liters
    ?? sheets
      .map((sheet) => sheet.vehicle?.fuelRemainingLiters)
      .find((value): value is number => value !== null && value !== undefined)
    ?? null;
  const ledger = buildFuelLedger(
    days.map((day) => ({
      date: day.date,
      distanceKm: day.distanceKm,
      fuelNormLPer100Km: day.fuelNorm,
      addedLiters: day.fuelAdded,
    })),
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

function minimum(values: (number | null)[]): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.min(...present) : null; }
function maximum(values: (number | null)[]): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.max(...present) : null; }

function Filter({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable onPress={onPress} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
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

type DatePresetKind = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';
const DATE_PRESETS: { kind: DatePresetKind; label: string }[] = [
  { kind: 'today', label: 'Šiandien' },
  { kind: 'yesterday', label: 'Vakar' },
  { kind: 'thisWeek', label: 'Ši savaitė' },
  { kind: 'lastWeek', label: 'Praėjusi savaitė' },
  { kind: 'thisMonth', label: 'Šis mėnuo' },
  { kind: 'lastMonth', label: 'Praėjęs mėnuo' },
];
function datePresetRange(kind: DatePresetKind): [string, string] {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (kind === 'today') return [iso(today), iso(today)];
  if (kind === 'yesterday') { const day = new Date(today); day.setDate(day.getDate() - 1); return [iso(day), iso(day)]; }
  // Monday-based week, matching the rest of the app's LT convention.
  const mondayOffset = (today.getDay() + 6) % 7;
  if (kind === 'thisWeek') { const start = new Date(today); start.setDate(start.getDate() - mondayOffset); const end = new Date(start); end.setDate(end.getDate() + 6); return [iso(start), iso(end)]; }
  if (kind === 'lastWeek') { const start = new Date(today); start.setDate(start.getDate() - mondayOffset - 7); const end = new Date(start); end.setDate(end.getDate() + 6); return [iso(start), iso(end)]; }
  if (kind === 'thisMonth') { const start = new Date(today.getFullYear(), today.getMonth(), 1); const end = new Date(today.getFullYear(), today.getMonth() + 1, 0); return [iso(start), iso(end)]; }
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return [iso(start), iso(end)];
}
function tripRouteLabel(row: DailyTripRow): string {
  if (row.routeNumbers.length > 0) return row.routeNumbers.join(' · ');
  if (row.startAddress === row.endAddress) return row.startAddress;
  return `${row.startAddress} - ${row.endAddress}`;
}
function formatMonth(value: string): string { const date = new Date(`${value}-15T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(date); }
function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value); }
function formatFuelNorm(value: number | null): string { return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value)} L/100km`; }
const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 120, minHeight: 48, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  toolbar: { gap: spacing.md, marginBottom: spacing.lg },
  screenTitle: { ...type.pageTitle, color: colors.text, letterSpacing: -0.3 }, screenDescription: { ...type.body, color: colors.textMuted },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, dateRange: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, dateInput: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  primaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, secondaryText: { ...type.button, color: colors.textSecondary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, filter: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, justifyContent: 'center' }, filterActive: { backgroundColor: colors.info, borderColor: colors.info }, filterText: { ...type.secondaryStrong, color: colors.text }, filterTextActive: { color: colors.textInverse },
  message: { ...type.secondary, color: colors.textMuted }, empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  sheet: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  screenView: { gap: spacing.md },
  // Print-only accountant report: hidden on screen and shown for @media print
  // via a data-testid selector in +html.tsx. It contains only measured or
  // entered operational data; untracked stop/parking placeholders are omitted.
  printSheet: { display: 'none', gap: 6 },
  printTitle: { fontSize: 16, fontWeight: '700', color: '#000000', textAlign: 'center' },
  printCompanyLine: { fontSize: 11, fontWeight: '700', color: '#000000', textAlign: 'center' },
  printMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'center' },
  printMetaText: { fontSize: 10, color: '#000000' },
  printTable: { borderWidth: 1, borderColor: '#000000', marginTop: 4 },
  printRow: { flexDirection: 'row' },
  printHeadRow: { backgroundColor: '#EAEAEA' },
  printTotalRow: { backgroundColor: '#F3F3F3' },
  printCell: { fontSize: 8, color: '#000000', paddingHorizontal: 3, paddingVertical: 2, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#000000' },
  printHeadText: { fontWeight: '700' },
  printCellDate: { flexBasis: '7%' },
  printCellDriver: { flexBasis: '12%' },
  printCellRoute: { flexBasis: '14%' },
  printCellNum: { flexBasis: '8%', textAlign: 'right' as const },
  printCellReceipt: { flexBasis: '9%' },
  printCellOdometer: { flexBasis: '9%', textAlign: 'right' as const },
  printSignatures: { marginTop: 8, gap: 6 },
  printSignatureLine: { fontSize: 9, color: '#000000' },
  printSummaryTable: { marginTop: 6, borderWidth: 1, borderColor: '#000000' },
  printSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, borderColor: '#000000' },
  printSummaryLabel: { fontSize: 9, fontWeight: '700', color: '#000000', minWidth: 120 },
  printSummaryCell: { fontSize: 9, color: '#000000' },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, flex: { flex: 1, minWidth: 0 }, date: { ...type.sectionTitle, color: colors.text }, driver: { ...type.bodyStrong, color: colors.info, marginTop: 2 },
  vehicleIdentity: { alignItems: 'flex-end', gap: 2 },
  routeBadge: { borderRadius: radius.sm, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, routeBadgeText: { ...type.label, color: colors.info },
  vehicleBar: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 2 }, vehicleNumber: { ...type.readout, color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, minWidth: 115, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle, gap: 2 }, metricLabel: { ...type.label, color: colors.textMuted }, metricValue: { ...type.bodyStrong, color: colors.text },
  reportTable: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, overflow: 'hidden' },
  reportTableScroll: { minWidth: '100%' },
  reportTableRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  reportTableHeader: { backgroundColor: colors.surfaceMuted },
  reportTableTotal: { backgroundColor: colors.infoSoft, borderBottomWidth: 0 },
  reportTableCell: { ...type.meta, color: colors.text, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  reportDateCell: { width: 88 },
  reportDriverCell: { width: 140 },
  reportRouteCell: { flex: 1, minWidth: 72 },
  reportNumberCell: { width: 92, textAlign: 'right' },
  reportTotalText: { ...type.secondaryStrong },
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
});
