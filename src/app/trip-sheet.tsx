import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { CompanyProfileSettings, type CompanyProfile } from '@/application/settings/company-profile';
import { buildFuelLedger, type FuelLedgerDay } from '@/application/trip-sheet/fuel-balance';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
import type { FuelType } from '@/domain/vehicle-and-trip';
import { employeeApi, type ServerFuelEntry, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
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

type TripFuelEntry = Pick<ServerFuelEntry, 'id' | 'filledAt' | 'odometer' | 'liters' | 'pricePerLiter' | 'totalCost' | 'station' | 'notes'>;
type DisplayTripSheet = Omit<ServerTripSheet, 'fuelEntries'> & { source: 'server' | 'local'; fuelEntries: TripFuelEntry[] };
type DailyTripRow = {
  date: string;
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
  source: DisplayTripSheet['source'];
  fuelEntries: TripFuelEntry[];
};
type MonthlyTripGroup = {
  key: string;
  month: string;
  driverName: string;
  vehicle: ServerTripSheet['vehicle'];
  rows: DailyTripRow[];
};

type FuelEntryInput = {
  date: string;
  odometer: number;
  liters: number;
  pricePerLiter: number | null;
  station: string | null;
  notes: string | null;
};

export default function TripSheetScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const [sheets, setSheets] = useState<DisplayTripSheet[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
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
  const visible = profile.role === 'driver' || selectedDriverId === 'all'
    ? sheets
    : sheets.filter((sheet) => sheet.driverId === selectedDriverId);
  const months = useMemo(() => [...new Set(sheets.map((sheet) => sheet.date.slice(0, 7)))].sort().reverse(), [sheets]);
  const monthVisible = selectedMonth === 'all' ? visible : visible.filter((sheet) => sheet.date.startsWith(selectedMonth));
  const monthlyGroups = useMemo(() => buildMonthlyGroups(monthVisible), [monthVisible]);
  const print = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.print();
    else setMessage('PDF arba spausdinimą atidarykite interneto naršyklėje.');
  };
  const addFuel = async (row: DailyTripRow, input: FuelEntryInput) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const filledAt = new Date(`${input.date}T12:00:00`).toISOString();
      if (online && row.source === 'server') {
        await employeeApi<{ entry: ServerFuelEntry }>(`/api/trip-sheets/${encodeURIComponent(row.assignmentId)}/fuel-entries`, {
          method: 'POST',
          body: JSON.stringify({
            filledAt,
            odometer: input.odometer,
            liters: input.liters,
            pricePerLiter: input.pricePerLiter ?? undefined,
            station: input.station ?? undefined,
            notes: input.notes ?? undefined,
          }),
        });
      } else {
        await repository.saveFuelEntry({ tripSheetId: row.tripSheetId, filledAt, ...input });
      }
      await load();
      setMessage(`Įpilta ${formatNumber(input.liters)} l – kuro įrašas išsaugotas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kuro įrašo išsaugoti nepavyko.');
      setBusy(false);
      throw error;
    }
  };
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, title: 'Kelionės lapai' }} />
      <FoundationScreen showFoundationNotice={false} title="Kelionės lapai" description={profile.role === 'driver'
        ? 'Jūsų užbaigtų maršrutų faktiniai darbo duomenys.'
        : 'Visų vairuotojų užbaigti maršrutai, odometrai ir automobiliai.'}>
        <View style={styles.actionRow} testID="trip-sheet-controls">
          <Pressable style={styles.primaryButton} disabled={busy} onPress={() => { void load(); }} testID="refresh-trip-sheets">
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Atnaujinti</Text>}
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={print} testID="print-trip-sheets"><Text style={styles.secondaryText}>Spausdinti / PDF</Text></Pressable>
        </View>
        {!online ? <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => { void syncLocal(); }} testID="sync-trip-sheets"><Text style={styles.secondaryText}>Atnaujinti iš įrenginio maršrutų</Text></Pressable> : null}
        {profile.role !== 'driver' && drivers.length > 1 ? <View style={styles.filters} testID="trip-sheet-driver-filter">
          <Filter label="Visi vairuotojai" active={selectedDriverId === 'all'} onPress={() => setSelectedDriverId('all')} styles={styles} />
          {drivers.map(([id, name]) => <Filter key={id} label={name} active={selectedDriverId === id} onPress={() => setSelectedDriverId(id)} styles={styles} />)}
        </View> : null}
        {months.length > 1 ? <View style={styles.filters} testID="trip-sheet-month-filter">
          <Filter label="Visi mėnesiai" active={selectedMonth === 'all'} onPress={() => setSelectedMonth('all')} styles={styles} />
          {months.map((month) => <Filter key={month} label={formatMonth(month)} active={selectedMonth === month} onPress={() => setSelectedMonth(month)} styles={styles} />)}
        </View> : null}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!busy && monthlyGroups.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Kelionės lapų dar nėra</Text><Text style={styles.meta}>Lapas atsiras automatiškai vairuotojui užbaigus priskirtą maršrutą ir įvedus galutinį odometrą.</Text></View> : null}
        {monthlyGroups.map((group) => <MonthlyTripSheet companyProfile={companyProfile} compact={width < 820} group={group} key={group.key} onAddFuel={addFuel} savingFuel={busy} styles={styles} vehicleFuelType={vehicleFuelType} />)}
      </FoundationScreen>
    </>
  );
}

function MonthlyTripSheet({ group, compact, onAddFuel, savingFuel, styles, companyProfile, vehicleFuelType }: {
  group: MonthlyTripGroup;
  compact: boolean;
  onAddFuel: (row: DailyTripRow, input: FuelEntryInput) => Promise<void>;
  savingFuel: boolean;
  styles: ReturnType<typeof createStyles>;
  companyProfile: CompanyProfile;
  vehicleFuelType: FuelType;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [fuelEditorDay, setFuelEditorDay] = useState<string | null>(null);
  const [fuelDate, setFuelDate] = useState('');
  const [fuelOdometer, setFuelOdometer] = useState('');
  const [fuelLiters, setFuelLiters] = useState('');
  const [fuelPrice, setFuelPrice] = useState('');
  const [fuelStation, setFuelStation] = useState('');
  const [fuelNotes, setFuelNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const totalDistance = group.rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = group.rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalFuelAdded = group.rows.reduce((sum, row) => sum + (row.fuelAdded ?? 0), 0);
  const totalCompensation = group.rows.reduce((sum, row) => sum + (row.compensationEur ?? 0), 0);
  const hasCompensation = group.rows.some((row) => row.compensationEur !== null);
  const firstOdometer = group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null;
  const lastOdometer = [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null;
  const firstFuel = group.rows.find((row) => row.fuelStart !== null)?.fuelStart ?? null;
  const lastFuel = [...group.rows].reverse().find((row) => row.fuelEnd !== null)?.fuelEnd ?? null;

  const openFuelEditor = (row: DailyTripRow) => {
    setExpandedDay(row.date);
    setFuelEditorDay(row.date);
    setFuelDate(row.date);
    setFuelOdometer(String(row.endOdometer ?? row.startOdometer ?? ''));
    setFuelLiters('');
    setFuelPrice('');
    setFuelStation('');
    setFuelNotes('');
    setFormError(null);
  };
  const saveFuel = async (row: DailyTripRow) => {
    const liters = parseDecimal(fuelLiters);
    const odometer = parseDecimal(fuelOdometer);
    const price = fuelPrice.trim() ? parseDecimal(fuelPrice) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fuelDate)) return setFormError('Įveskite datą formatu YYYY-MM-DD.');
    if (liters === null || liters <= 0) return setFormError('Įveskite įpiltų litrų kiekį.');
    if (odometer === null || odometer < 0) return setFormError('Įveskite odometro rodmenį pylimo metu.');
    if (price !== null && price < 0) return setFormError('Litro kaina negali būti neigiama.');
    setFormError(null);
    try {
      await onAddFuel(row, {
        date: fuelDate,
        odometer,
        liters,
        pricePerLiter: price,
        station: fuelStation.trim() || null,
        notes: fuelNotes.trim() || null,
      });
      setFuelEditorDay(null);
    } catch {
      setFormError('Kuro įrašo išsaugoti nepavyko. Patikrinkite ryšį ir bandykite dar kartą.');
    }
  };

  return <View style={styles.sheet} testID={`monthly-trip-sheet-${group.key}`}>
    <View style={styles.screenView} testID="trip-sheet-screen-view">
    <View style={styles.sheetHeader}>
      <View style={styles.flex}>
        <Text style={styles.date}>{formatMonth(group.month)}</Text>
        <Text style={styles.driver}>{group.driverName}</Text>
      </View>
      <View style={styles.vehicleIdentity}>
        <Text style={styles.vehicleNumber}>{group.vehicle?.registrationNumber ?? 'Automobilis nepriskirtas'}</Text>
        {group.vehicle ? <Text style={styles.meta}>{group.vehicle.model}</Text> : null}
      </View>
    </View>

    <View style={styles.metrics}>
      <Metric label="NUVAŽIUOTA" value={`${formatNumber(totalDistance)} km`} styles={styles} />
      <Metric label="KURO LIKUTIS PRADŽIOJE" value={firstFuel === null ? '—' : `${formatNumber(firstFuel)} l`} styles={styles} />
      <Metric label="ĮPILTA" value={`${formatNumber(totalFuelAdded)} l`} styles={styles} />
      <Metric label="SUNAUDOTA PAGAL NORMĄ" value={`${formatNumber(totalFuel)} l`} styles={styles} />
      <Metric label="DABARTINIS LIKUTIS" value={lastFuel === null ? '—' : `${formatNumber(lastFuel)} l`} styles={styles} />
      {hasCompensation ? <Metric label="ATLYGIS" value={formatMoney(totalCompensation)} styles={styles} /> : null}
    </View>
    <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)} style={styles.detailsToggle}>
      <Text style={styles.detailsToggleText}>{expanded ? 'Slėpti dienų informaciją' : `Peržiūrėti ${group.rows.length} d. informaciją`}</Text>
      <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
    </Pressable>

    {expanded ? <View style={styles.dayList}>
      <View style={styles.detailsSummary}>
        <Text style={styles.detailsSummaryText}>Odometras {formatNumber(firstOdometer)} → {formatNumber(lastOdometer)}</Text>
        <Text style={styles.detailsSummaryText}>Norma {group.rows[0]?.fuelNorm === null ? '—' : `${formatNumber(group.rows[0]?.fuelNorm ?? null)} l/100 km`}</Text>
      </View>
      {group.rows.map((row) => {
        const open = expandedDay === row.date;
        const editingFuel = fuelEditorDay === row.date;
        return <View key={row.date} style={styles.dayRow}>
          <Pressable accessibilityRole="button" onPress={() => setExpandedDay(open ? null : row.date)} style={styles.daySummary}>
            <View style={styles.flex}>
              <Text style={styles.mobileDayDate}>{compact ? formatDate(row.date) : formatShortDate(row.date)}</Text>
              <Text style={styles.routeBadgeText}>{row.routeNumbers.join(' · ') || 'Regiono kodas nenurodytas'}</Text>
            </View>
            <View style={styles.dayFuelSummary}>
              <Text style={styles.dayFuelValue}>{row.fuelEnd === null ? '—' : `${formatNumber(row.fuelEnd)} l`}</Text>
              <Text style={styles.meta}>{row.fuelAdded ? `+${formatNumber(row.fuelAdded)} l įpilta` : 'Nepilta'}</Text>
            </View>
            <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
          </Pressable>
          {open ? <View style={styles.dayDetails}>
            <Text style={styles.routeAddress}>{row.startAddress} → {row.endAddress}</Text>
            <View style={styles.mobileDayMetrics}>
              <Metric label="ODOMETRAS" value={`${formatNumber(row.startOdometer)} → ${formatNumber(row.endOdometer)}`} styles={styles} />
              <Metric
                label={row.distanceSource === 'planned' ? 'NUVAŽIUOTA (PLANUOTA)' : 'NUVAŽIUOTA'}
                value={`${formatNumber(row.distanceKm)} km`}
                styles={styles}
              />
              <Metric label="KURO PRADŽIOJE" value={row.fuelStart === null ? '—' : `${formatNumber(row.fuelStart)} l`} styles={styles} />
              <Metric label="ĮPILTA" value={`${formatNumber(row.fuelAdded)} l`} styles={styles} />
              <Metric
                label={row.fuelNorm === null ? 'SUNAUDOTA' : `SUNAUDOTA (${formatNumber(row.fuelNorm)} l/100 km)`}
                value={row.fuelConsumed === null ? '—' : `${formatNumber(row.fuelConsumed)} l`}
                styles={styles}
              />
              <Metric label="LIKO" value={row.fuelEnd === null ? '—' : `${formatNumber(row.fuelEnd)} l`} styles={styles} />
              {row.compensationEur !== null ? <Metric
                label={row.compensationPreliminary ? 'ATLYGIS (PRELIMINARUS)' : 'ATLYGIS'}
                value={formatMoney(row.compensationEur)}
                styles={styles}
              /> : null}
            </View>
            {fuelMissingHint(row.fuelMissing) ? (
              <Text style={styles.meta}>{fuelMissingHint(row.fuelMissing)}</Text>
            ) : null}
            {row.fuelEnd !== null && row.fuelEnd < 0 ? (
              <Text accessibilityRole="alert" style={styles.formError}>
                Likutis išėjo neigiamas ({formatNumber(row.fuelEnd)} l) — greičiausiai neįvestas kuro papildymas
                arba netikslus odometro rodmuo.
              </Text>
            ) : null}
            {row.fuelEntries.length > 0 ? <View style={styles.fuelEntries}>
              <Text style={styles.fuelEntriesTitle}>KURO PAPILDYMAI</Text>
              {row.fuelEntries.map((entry) => <View key={entry.id} style={styles.fuelEntryRow}>
                <View style={styles.flex}><Text style={styles.tableStrong}>{formatNumber(entry.liters)} l · {formatNumber(entry.odometer)} km</Text><Text style={styles.meta}>{entry.station || 'Degalinė nenurodyta'} · {formatDateTime(entry.filledAt)}</Text></View>
                <Text style={styles.tableStrong}>{entry.totalCost === null ? '—' : formatMoney(entry.totalCost)}</Text>
              </View>)}
            </View> : <Text style={styles.meta}>Šią dieną kuro papildymų dar neįvesta.</Text>}
            {!editingFuel ? <Pressable onPress={() => openFuelEditor(row)} style={styles.addFuelButton}><Text style={styles.addFuelButtonText}>+ Įvesti kuro papildymą</Text></Pressable> : <View style={styles.fuelForm} testID={`fuel-entry-form-${row.date}`}>
              <Text style={styles.cardTitle}>Kuro papildymas</Text>
              <Text style={styles.meta}>Privalomi laukai: litrai, odometras ir data.</Text>
              <View style={styles.formGrid}>
                <Field label="Įpilta, l *" value={fuelLiters} onChangeText={setFuelLiters} placeholder="Pvz. 45,5" keyboardType="decimal-pad" styles={styles} />
                <Field label="Odometras *" value={fuelOdometer} onChangeText={setFuelOdometer} placeholder="Pvz. 675628" keyboardType="decimal-pad" styles={styles} />
                <Field label="Data *" value={fuelDate} onChangeText={setFuelDate} placeholder="YYYY-MM-DD" styles={styles} />
                <Field label="Kaina už litrą" value={fuelPrice} onChangeText={setFuelPrice} placeholder="Pvz. 1,49" keyboardType="decimal-pad" styles={styles} />
                <Field label="Degalinė" value={fuelStation} onChangeText={setFuelStation} placeholder="Pavadinimas arba vieta" styles={styles} />
                <Field label="Pastaba" value={fuelNotes} onChangeText={setFuelNotes} placeholder="Nebūtina" styles={styles} />
              </View>
              {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
              <View style={styles.formActions}>
                <Pressable disabled={savingFuel} onPress={() => setFuelEditorDay(null)} style={styles.cancelFuelButton}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
                <Pressable disabled={savingFuel} onPress={() => void saveFuel(row)} style={[styles.saveFuelButton, savingFuel && styles.disabled]}><Text style={styles.primaryText}>{savingFuel ? 'Saugoma…' : 'Išsaugoti'}</Text></Pressable>
              </View>
            </View>}
          </View> : null}
        </View>;
      })}
      <Text style={styles.calculationNote}>Likutis = pradinis likutis + faktiškai įpilta − kilometrai × automobilio norma / 100.</Text>
    </View> : null}
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
        <Text style={styles.printMetaText}>Vairuotojas: {group.driverName}</Text>
        <Text style={styles.printMetaText}>Laikotarpis: {formatMonthPeriod(group.month)}</Text>
      </View>

      <View style={styles.printTable}>
        <View style={[styles.printRow, styles.printHeadRow]}>
          <Text style={[styles.printCell, styles.printCellDate, styles.printHeadText]}>Data</Text>
          <Text style={[styles.printCell, styles.printCellUsage, styles.printHeadText]}>Naudojimo laikas</Text>
          <Text style={[styles.printCell, styles.printCellRoute, styles.printHeadText]}>Maršrutas</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Atstumas, km</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Važiavimo laikas</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Sustojimo trukmė</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Stovėjimo laikas</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Degalų sąnaudos pagal normą, L</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Įpilta degalų, L</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>Degalų nupirkta, L</Text>
        </View>
        {group.rows.map((row) => (
          <View key={row.date} style={styles.printRow}>
            <Text style={[styles.printCell, styles.printCellDate]}>{row.date}</Text>
            <Text style={[styles.printCell, styles.printCellUsage]}>00:00:00-23:59:59</Text>
            <Text style={[styles.printCell, styles.printCellRoute]}>{row.startAddress}{row.startAddress !== row.endAddress ? ` - ${row.endAddress}` : ''}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{formatNumber(row.distanceKm)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>00:00:00</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>00:00:00</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>24:00:00</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{row.fuelConsumed === null ? '0,00' : formatNumber(row.fuelConsumed)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>{formatNumber(row.fuelAdded)}</Text>
            <Text style={[styles.printCell, styles.printCellNum]}>0,00</Text>
          </View>
        ))}
        <View style={[styles.printRow, styles.printTotalRow]}>
          <Text style={[styles.printCell, styles.printCellDate]} />
          <Text style={[styles.printCell, styles.printCellUsage]} />
          <Text style={[styles.printCell, styles.printCellRoute, styles.printHeadText]}>Iš viso:</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalDistance)}</Text>
          <Text style={[styles.printCell, styles.printCellNum]} />
          <Text style={[styles.printCell, styles.printCellNum]} />
          <Text style={[styles.printCell, styles.printCellNum]} />
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalFuel)}</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>{formatNumber(totalFuelAdded)}</Text>
          <Text style={[styles.printCell, styles.printCellNum, styles.printHeadText]}>0,00</Text>
        </View>
      </View>

      <View style={styles.printSignatures}>
        <Text style={styles.printSignatureLine}>Kelionės lapą išdavė ______________________________ (vardas, pavardė, parašas, data)</Text>
        <Text style={styles.printSignatureLine}>Vadovas ______________________________ (vardas, pavardė, parašas, data)</Text>
        <Text style={styles.printSignatureLine}>Kelionės lapą priėmė ______________________________ (vardas, pavardė, parašas, data)</Text>
      </View>

      <View style={styles.printSummaryTable}>
        <View style={styles.printSummaryRow}>
          <Text style={styles.printSummaryLabel}>Hodometro parodymai</Text>
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
  const groups = new Map<string, { month: string; driverName: string; vehicle: ServerTripSheet['vehicle']; sheets: DisplayTripSheet[] }>();
  for (const sheet of sheets) {
    const month = sheet.date.slice(0, 7);
    const vehicleKey = sheet.vehicle?.id ?? 'no-vehicle';
    const key = `${month}:${sheet.driverId}:${vehicleKey}`;
    const current = groups.get(key) ?? { month, driverName: sheet.driverName, vehicle: sheet.vehicle, sheets: [] };
    current.sheets.push(sheet);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    month: group.month,
    driverName: group.driverName,
    vehicle: group.vehicle,
    rows: buildDailyRows(group.sheets),
  })).sort((left, right) => right.month.localeCompare(left.month) || left.driverName.localeCompare(right.driverName, 'lt'));
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

/** Says which entry is missing, so an empty balance is not just a bare dash. */
function fuelMissingHint(missing: FuelLedgerDay['missing']): string | null {
  if (missing === 'no_odometer') return 'Likutis neskaičiuojamas: neįvesti šios dienos odometro rodmenys.';
  if (missing === 'no_norm') return 'Likutis neskaičiuojamas: automobiliui nenustatyta kuro norma (l/100 km).';
  if (missing === 'no_opening') return 'Likutis neskaičiuojamas: nežinomas kuro likutis laikotarpio pradžioje.';
  return null;
}

function minimum(values: (number | null)[]): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.min(...present) : null; }
function maximum(values: (number | null)[]): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.max(...present) : null; }

function Field({ label, styles, ...inputProps }: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} style={styles.input} /></View>;
}

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

function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'long' }).format(date); }
function formatShortDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { month: '2-digit', day: '2-digit' }).format(date); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function formatMonth(value: string): string { const date = new Date(`${value}-15T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(date); }
function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value); }
function parseDecimal(value: string): number | null { const parsed = Number(value.trim().replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; }
function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }
function formatFuelNorm(value: number | null): string { return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value)} L/100km`; }
function formatMonthPeriod(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  if (!year || !monthIndex) return month;
  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${year}-${pad(monthIndex)}-01 00:00:00 - ${year}-${pad(monthIndex)}-${pad(lastDay)} 23:59:59`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 120, minHeight: 48, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, secondaryText: { ...type.button, color: colors.textSecondary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, filter: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, justifyContent: 'center' }, filterActive: { backgroundColor: colors.info, borderColor: colors.info }, filterText: { ...type.secondaryStrong, color: colors.text }, filterTextActive: { color: colors.textInverse },
  message: { ...type.secondary, color: colors.textMuted }, empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  sheet: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  screenView: { gap: spacing.md },
  // Print-only accountant report: hidden on screen, shown for @media print
  // via a data-testid selector in +html.tsx. Mirrors the paper trip-sheet
  // template columns exactly, including the driving/stop/parking time
  // columns this app does not track (kept as the same fixed placeholders
  // the paper template already uses).
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
  printCellDate: { flexBasis: '8%' },
  printCellUsage: { flexBasis: '12%' },
  printCellRoute: { flexBasis: '24%' },
  printCellNum: { flexBasis: '8%', textAlign: 'right' as const },
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
  detailsToggle: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
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
  calculationNote: { ...type.meta, color: colors.textMuted, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle },
});
