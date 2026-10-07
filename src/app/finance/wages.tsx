import { Stack, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { ChevronDownIcon } from '@/components/app-icons';
import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { buildWagePrintDocument } from '@/application/finance/wage-document';
import { applyWageQuickEditOpen } from '@/application/finance/wage-quick-edit-open';
import { aggregateWageDays, summarizeWageDays, wageDayCell, wageTableColumns, wageTotalCell, type WageAdjustment, type WageColumnKey, type WageDayRow } from '@/application/finance/wage-report';
import { buildWageWorkbook } from '@/application/finance/wage-workbook';
import { roleHomePath } from '@/application/navigation/role-home';
import {
  calendarPresetRange,
  formatDateKey,
} from '@/application/reporting/period-range';
import { CompanyProfileSettings } from '@/application/settings/company-profile';
import { printHtmlDocument } from '@/application/trip-sheet/print-frame';
import { MIME_XLSX } from '@/application/trip-sheet/export-xlsx';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { PeriodCalendarPicker } from '@/components/period-calendar-picker';
import { parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import { FinanceConfirmDialog } from '@/components/finance-confirm-dialog';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const UNASSIGNED_DRIVER_ID = 'unassigned';

type DriverFinanceRow = {
  driverId: string;
  driverName: string;
  routes: number;
  km: number;
  fuelLiters: number;
  fuelCostEur: number;
  wageEur: number;
  totalEur: number;
  sheets: ServerTripSheet[];
};

const eur2Formatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 });

const ALL_DRIVERS = 'all';
const DESKTOP_WIDTH = 1280;

export default function FinanceScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_WIDTH;
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createWageScreenStyles(colors), [colors]);
  const [companyName, setCompanyName] = useState('FiRo');
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageFinancials);

  const [tripSheets, setTripSheets] = useState<ServerTripSheet[]>([]);
  const [adjustments, setAdjustments] = useState<WageAdjustment[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const initialPeriod = useMemo(() => calendarPresetRange('thisMonth'), []);
  const [periodFrom, setPeriodFrom] = useState(initialPeriod.from);
  const [periodTo, setPeriodTo] = useState(initialPeriod.to);
  const [driverFilter, setDriverFilter] = useState<string>(ALL_DRIVERS);
  const [driverPickerOpen, setDriverPickerOpen] = useState(false);
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  /** When set, the day detail opens straight into the manual-adjustment form. */
  const [quickEditDayKey, setQuickEditDayKey] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const consumeQuickEdit = useCallback(() => setQuickEditDayKey(null), []);

  useEffect(() => {
    void new CompanyProfileSettings(db).get().then((company) => {
      if (company.name.trim()) setCompanyName(company.name.trim());
    }).catch(() => undefined);
  }, [db]);

  const load = useCallback(async () => {
    if (!online) { setError('Nėra ryšio su serveriu. Finansų ataskaita skaičiuojama serveryje.'); setBusy(false); return; }
    setBusy(true);
    try {
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
      setTripSheets(response.tripSheets);
      // Bonuses are optional: an older server without the endpoint must not
      // break the whole wage report.
      try {
        const extra = await employeeApi<{ adjustments: WageAdjustment[] }>('/api/admin/wage-adjustments?from=2000-01-01&to=2100-12-31');
        setAdjustments(extra.adjustments);
      } catch { setAdjustments([]); }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kelionės lapų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [online]);

  useEffect(() => {
    if (!allowed) { router.replace(roleHomePath(profile.role) as Href); return; }
    void load();
  }, [allowed, load, profile.role, router]);

  const period = useMemo(() => ({ from: periodFrom, to: periodTo }), [periodFrom, periodTo]);
  const inPeriod = useMemo(
    () => tripSheets.filter((sheet) => sheet.date >= period.from && sheet.date <= period.to),
    [tripSheets, period],
  );
  const adjustmentsInPeriod = useMemo(
    () => adjustments.filter((item) => item.date >= period.from && item.date <= period.to),
    [adjustments, period],
  );
  const drivers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const sheet of inPeriod) if (!seen.has(sheet.driverId)) seen.set(sheet.driverId, sheet.driverName);
    for (const item of adjustmentsInPeriod) if (!seen.has(item.driverId)) seen.set(item.driverId, item.driverName);
    return [...seen].map(([driverId, driverName]) => ({ driverId, driverName }))
      .sort((left, right) => left.driverName.localeCompare(right.driverName, 'lt'));
  }, [inPeriod, adjustmentsInPeriod]);
  // A driver filter chosen for one period may not exist in another — fall back
  // to "all" rather than showing an empty report.
  const activeDriver = driverFilter !== ALL_DRIVERS && drivers.some((driver) => driver.driverId === driverFilter)
    ? driverFilter
    : ALL_DRIVERS;
  const visible = useMemo(
    () => inPeriod.filter((sheet) => activeDriver === ALL_DRIVERS || sheet.driverId === activeDriver),
    [inPeriod, activeDriver],
  );
  const rows = useMemo(() => aggregateByDriver(visible), [visible]);
  const visibleAdjustments = useMemo(
    () => adjustmentsInPeriod.filter((item) => activeDriver === ALL_DRIVERS || item.driverId === activeDriver),
    [adjustmentsInPeriod, activeDriver],
  );
  const wageDays = useMemo(() => aggregateWageDays(visible, visibleAdjustments), [visible, visibleAdjustments]);
  const showDriverNames = useMemo(() => new Set(wageDays.map((day) => day.driverId)).size > 1, [wageDays]);
  const unassignedRow = useMemo(() => rows.find((row) => row.driverId === UNASSIGNED_DRIVER_ID) ?? null, [rows]);
  const wageTotals = useMemo(() => summarizeWageDays(wageDays), [wageDays]);
  const selectedEmployeeName = activeDriver === ALL_DRIVERS
    ? 'Visi darbuotojai'
    : drivers.find((driver) => driver.driverId === activeDriver)?.driverName ?? 'Darbuotojas';
  const periodLabel = `${periodFrom} – ${periodTo}`;

  const openWagePrint = (purpose: 'pdf' | 'print') => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setExportNote('PDF ir spausdinimą atidarykite interneto naršyklėje.');
      return;
    }
    if (wageDays.length === 0) {
      setExportNote('Pasirinktu laikotarpiu nėra dienų.');
      return;
    }
    printHtmlDocument(buildWagePrintDocument({
      companyName,
      employeeName: selectedEmployeeName,
      periodLabel,
      days: wageDays,
    }));
    setExportNote(purpose === 'pdf'
      ? 'Atsidariusiame lange pasirinkite „Išsaugoti kaip PDF“. Dokumentas naudoja tas pačias dienas kaip ekranas.'
      : 'Spausdinimo dokumentas naudoja tas pačias dienas kaip ekranas.');
  };

  const exportExcel = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setExportNote('Excel eksportą atidarykite interneto naršyklėje.');
      return;
    }
    if (wageDays.length === 0) {
      setExportNote('Pasirinktu laikotarpiu nėra dienų.');
      return;
    }
    const bytes = buildWageWorkbook({
      companyName,
      employeeName: selectedEmployeeName,
      periodLabel,
      days: wageDays,
    });
    const payload = new Uint8Array(bytes);
    const blob = new Blob([payload], { type: MIME_XLSX });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileEmployee = selectedEmployeeName.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'darbuotojas';
    link.href = url;
    link.download = `firo-atlygis-${fileEmployee}-${periodFrom}-${periodTo}.xlsx`;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
    setExportNote('Excel failas paruoštas. Skaičiai įrašyti kaip skaičiai, FiRo duomenys nebuvo pakeisti.');
  };

  const deleteUnassigned = (row: DriverFinanceRow) => {
    Alert.alert(
      'Ištrinti neaiškias dienas?',
      `Bus visam laikui pašalinta ${row.sheets.length} ${row.sheets.length === 1 ? 'diena' : 'dienos'} be priskirto vairuotojo (kelionių lapų importas). Veiksmo atšaukti negalima.`,
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Ištrinti', style: 'destructive', onPress: () => { void (async () => {
          setCleaningUp(true);
          const failures: string[] = [];
          for (const sheet of row.sheets) {
            // sheet.vehicle is null when the vehicle was renamed after this
            // reading was recorded (the old plate no longer resolves to a
            // live vehicle) — the raw id survives inside the assignment id,
            // which is built as vehicle-day-<vehicleId>-<date>.
            const vehicleId = sheet.vehicle?.id ?? parseVehicleDayAssignmentId(sheet.assignmentId)?.vehicleId ?? null;
            if (!vehicleId) { failures.push(sheet.date); continue; }
            try {
              await employeeApi(`/api/admin/trip-sheets/unassigned-day/${encodeURIComponent(vehicleId)}/${encodeURIComponent(sheet.date)}`, { method: 'DELETE' });
            } catch {
              failures.push(sheet.date);
            }
          }
          await load();
          setCleaningUp(false);
          if (failures.length > 0) setError(`Nepavyko ištrinti: ${failures.join(', ')}.`);
        })(); } },
      ],
    );
  };

  if (!allowed) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Darbuotojų atlygis' }} />
      <FoundationScreen
        contentMaxWidth={1480}
        description="Kiekvieno vairuotojo atlygis ir kuro sąnaudos pagal kelionės lapų faktinius duomenis."
        showFoundationNotice={false}
        title="Darbuotojų atlygis">

        <View style={styles.periodPanel} testID="finance-period-panel">
          <PeriodCalendarPicker
            from={periodFrom}
            onChange={(from, to) => { setPeriodFrom(from); setPeriodTo(to); }}
            testID="finance-period-calendar"
            to={periodTo}
          />
        </View>

        {!busy && drivers.length > 1 ? <View style={styles.driverFilter} testID="finance-driver-filter">
          <Text style={styles.driverFilterLabel}>Darbuotojas</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: driverPickerOpen }}
            onPress={() => setDriverPickerOpen((value) => !value)}
            style={({ pressed }) => [styles.driverTrigger, driverPickerOpen && styles.driverTriggerOpen, pressed && styles.driverChipPressed]}
            testID="finance-driver-trigger">
            <View style={styles.driverTriggerText}>
              <Text style={styles.driverTriggerValue}>
                {activeDriver === ALL_DRIVERS ? 'Visi darbuotojai' : drivers.find((driver) => driver.driverId === activeDriver)?.driverName ?? 'Visi darbuotojai'}
              </Text>
              <Text style={styles.driverTriggerHint}>{driverPickerOpen ? 'Uždaryti sąrašą' : 'Keisti darbuotoją'}</Text>
            </View>
            <View style={[styles.driverChevron, driverPickerOpen && styles.driverChevronOpen]}><ChevronDownIcon color={colors.info} size={20} /></View>
          </Pressable>
          {driverPickerOpen ? <View style={styles.driverOptions}>
            {[{ driverId: ALL_DRIVERS, driverName: 'Visi darbuotojai' }, ...drivers].map((option) => {
              const selected = activeDriver === option.driverId;
              return <Pressable
                key={option.driverId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => { setDriverFilter(option.driverId); setExpandedDayKey(null); setDriverPickerOpen(false); }}
                style={({ pressed }) => [styles.driverOption, selected && styles.driverOptionSelected, pressed && styles.wageDayRowPressed]}
                testID={`finance-driver-${option.driverId}`}>
                <Text style={[styles.driverOptionText, selected && styles.driverOptionTextSelected]}>{option.driverName}</Text>
                {selected ? <Text style={styles.driverOptionCheck}>✓</Text> : null}
              </Pressable>;
            })}
          </View> : null}
        </View> : null}

        {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.info} size="large" /> : null}

        {!busy && rows.length === 0 && wageDays.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Pasirinktu laikotarpiu duomenų nėra</Text><Text style={styles.meta}>Pakeiskite laikotarpį arba patikrinkite, ar kelionės lapai užpildyti.</Text></View> : null}

        {!busy && (rows.length > 0 || wageDays.length > 0) ? <View style={styles.totalsRow} testID="finance-totals">
          <Metric label="Reisų" value={String(wageTotals.routes)} styles={styles} />
          <Metric label="Km" value={qtyFormatter.format(wageTotals.km)} styles={styles} />
          <Metric label="Kuras" value={eur2Formatter.format(wageTotals.fuelCostEur)} styles={styles} />
          <Metric label="Atlygis" value={eur2Formatter.format(wageTotals.payEur)} styles={styles} />
          <Metric label="Iš viso" value={eur2Formatter.format(wageTotals.totalEur)} emphasis styles={styles} />
        </View> : null}

        {!busy && wageDays.length > 0 ? <View style={styles.exportRow} testID="finance-wage-export">
          <Pressable onPress={exportExcel} style={styles.exportButton} testID="finance-wage-excel"><Text style={styles.exportButtonText}>Eksportuoti į Excel</Text></Pressable>
          <Pressable onPress={() => openWagePrint('pdf')} style={styles.exportButton} testID="finance-wage-pdf"><Text style={styles.exportButtonText}>Atsisiųsti PDF</Text></Pressable>
          <Pressable onPress={() => openWagePrint('print')} style={styles.exportButton} testID="finance-wage-print"><Text style={styles.exportButtonText}>Spausdinti</Text></Pressable>
        </View> : null}
        {exportNote ? <Text style={styles.meta}>{exportNote}</Text> : null}
        {!busy && profile.role === 'admin' && activeDriver !== ALL_DRIVERS ? <AddAdjustmentForm
          driverId={activeDriver}
          defaultDate={periodFrom}
          online={online}
          onSaved={load}
          styles={styles}
        /> : null}

        {!busy && wageDays.length > 0 ? <View style={styles.wageList} testID="finance-wage-days">
          <View style={styles.wageListHeading}>
            <Text style={styles.wageListTitle}>Atlygis pagal dieną</Text>
            <Text style={styles.meta}>Seniausia diena viršuje. Viena diena rodoma vieną kartą, nepriklausomai nuo reisų skaičiaus.</Text>
          </View>
          {desktop ? <WageDayTable
            days={wageDays}
            expandedDayKey={expandedDayKey}
            quickEditDayKey={quickEditDayKey}
            onToggle={(key) => {
              setQuickEditDayKey(null);
              setExpandedDayKey(expandedDayKey === key ? null : key);
            }}
            onQuickEdit={(key) => {
              setQuickEditDayKey(key);
              setExpandedDayKey(key);
            }}
            onQuickEditConsumed={consumeQuickEdit}
            showDriverNames={showDriverNames}
            totals={wageTotals}
            canEdit={profile.role === 'admin'}
            online={online}
            onSaved={load}
            styles={styles}
          /> : wageDays.map((day) => {
            const expanded = expandedDayKey === day.key;
            const canEdit = profile.role === 'admin';
            return <View key={day.key} testID={`finance-wage-day-${day.key}`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => {
                  setQuickEditDayKey(null);
                  setExpandedDayKey(expanded ? null : day.key);
                }}
                style={({ pressed }) => [styles.wageDayRow, pressed && styles.wageDayRowPressed]}
                testID={`finance-wage-day-toggle-${day.key}`}>
                <View style={styles.wageDayIdentity}>
                  <Text style={styles.wageDayDate}>{formatDateKey(day.date)}</Text>
                  {showDriverNames ? <Text style={styles.wageDayDriver}>{day.driverName}</Text> : null}
                  {day.preliminary ? <Text style={styles.wageDayStatus}>Preliminaru</Text> : null}
                </View>
                <Text style={styles.wageDayAmount}>{formatWageAmount(day.figures.payEur)}</Text>
                <Text style={styles.wageDayChevron}>{expanded ? '⌃' : '⌄'}</Text>
              </Pressable>
              {canEdit ? <View style={styles.dayQuickActions}>
                <Pressable
                  onPress={() => { setQuickEditDayKey(day.key); setExpandedDayKey(day.key); }}
                  style={({ pressed }) => [styles.metricsEditLink, pressed && styles.driverChipPressed]}
                  testID={`finance-quick-edit-adjustment-${day.key}`}>
                  <Text style={styles.metricsEditLinkText}>{day.manualAdjustment ? 'Taisyti priedą' : 'Pridėti priedą'}</Text>
                </Pressable>
              </View> : null}
              {expanded ? <WageDayDetail
                canEdit={canEdit}
                day={day}
                online={online}
                onSaved={load}
                onStartEditingConsumed={consumeQuickEdit}
                startEditingAdjustment={quickEditDayKey === day.key}
                styles={styles}
              /> : null}
            </View>;
          })}
          {unassignedRow ? <View style={styles.unassignedCleanup}>
            <Text style={styles.meta}>Yra dienų be priskirto vairuotojo. Jei tai bandomieji importo įrašai, juos galima pašalinti.</Text>
            <Pressable disabled={cleaningUp} onPress={() => deleteUnassigned(unassignedRow)} style={[styles.dangerButton, cleaningUp && styles.disabled]} testID="finance-delete-unassigned">
              <Text style={styles.dangerButtonText}>{cleaningUp ? 'Šalinama…' : 'Ištrinti nepriskirtas dienas'}</Text>
            </Pressable>
          </View> : null}
        </View> : null}

        <Text style={styles.disclaimer}>Atlygis yra rodomų dienų sumų suma. Iš viso prideda kuro pylimų kainą. Kuro suma skaičiuojama iš pylimų, kuriuose nurodyta kaina — jei kaina nenurodyta, litrai matomi, bet į € sumą neįskaičiuojami. Bazinis dienos atlygis skaičiuojamas vieną kartą. „Papildomai“ – ranka įrašytas dienos priedas, jis įtrauktas į dienos sumą. Draudimas ir kelių mokestis į šią sumą neįtraukti.</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'finance-wages' } } as unknown as Href)}
          style={({ pressed }) => [styles.settingsLink, pressed && styles.settingsLinkPressed]}
          testID="finance-open-settings">
          <MenuArtwork kind="finance" size={44} />
          <View style={styles.flex}>
            <Text style={styles.settingsLinkTitle}>Kuro ir atlygio parametrai</Text>
            <Text style={styles.meta}>Kuro kaina, automobilių ir vairuotojų tarifai, naudojami maršruto kainos įverčiui.</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </FoundationScreen>
    </>
  );
}

function aggregateByDriver(sheets: readonly ServerTripSheet[]): DriverFinanceRow[] {
  const buckets = new Map<string, { driverId: string; driverName: string; routeIds: Set<string>; km: number; fuelLiters: number; fuelCostEur: number; sheets: ServerTripSheet[] }>();
  const wageByDriverDate = new Map<string, number>();
  const countedFuelEntryIds = new Set<string>();
  for (const sheet of sheets) {
    if (!buckets.has(sheet.driverId)) buckets.set(sheet.driverId, { driverId: sheet.driverId, driverName: sheet.driverName, routeIds: new Set(), km: 0, fuelLiters: 0, fuelCostEur: 0, sheets: [] });
    const bucket = buckets.get(sheet.driverId)!;
    bucket.routeIds.add(sheet.routeId);
    bucket.km += sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0;
    bucket.sheets.push(sheet);
    for (const entry of sheet.fuelEntries) {
      if (countedFuelEntryIds.has(entry.id)) continue;
      countedFuelEntryIds.add(entry.id);
      bucket.fuelLiters += entry.liters;
      bucket.fuelCostEur += entry.totalCost ?? 0;
    }
    // Compensation is computed per driver per day and attached to every sheet
    // from that day, so it must be deduped by driver+date before summing —
    // otherwise a driver with two routes the same day would be paid twice.
    if (sheet.compensation) {
      const key = `${sheet.driverId}:${sheet.date}`;
      if (!wageByDriverDate.has(key)) wageByDriverDate.set(key, sheet.compensation.totalNetEur);
    }
  }
  const wageByDriver = new Map<string, number>();
  for (const [key, value] of wageByDriverDate) {
    const driverId = key.slice(0, key.lastIndexOf(':'));
    wageByDriver.set(driverId, (wageByDriver.get(driverId) ?? 0) + value);
  }
  return [...buckets.values()]
    .map((bucket) => {
      const wageEur = wageByDriver.get(bucket.driverId) ?? 0;
      return {
        driverId: bucket.driverId,
        driverName: bucket.driverName,
        routes: bucket.routeIds.size,
        km: bucket.km,
        fuelLiters: bucket.fuelLiters,
        fuelCostEur: bucket.fuelCostEur,
        wageEur,
        totalEur: bucket.fuelCostEur + wageEur,
        sheets: bucket.sheets.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)),
      };
    })
    .sort((left, right) => right.totalEur - left.totalEur);
}

function Metric({ label, value, emphasis, styles }: { label: string; value: string; emphasis?: boolean; styles: ReturnType<typeof createWageScreenStyles> }) {
  return <View style={styles.metric}>
    <Text style={[styles.metricValue, emphasis && styles.metricValueEmphasis]}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>;
}

function RouteMetricsRow({ sheet, canEdit, online, onSaved, styles }: {
  sheet: WageDayRow['sheets'][number];
  canEdit: boolean;
  online: boolean;
  onSaved: () => void;
  styles: ReturnType<typeof createWageScreenStyles>;
}) {
  const [editing, setEditing] = useState(false);
  const [stops, setStops] = useState('');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEditor = () => {
    setStops(String(sheet.totalStops));
    setWeight(sheet.totalWeightKg ? String(sheet.totalWeightKg) : '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const nextStops = Number(stops || '0');
    const nextWeight = Number((weight || '0').replace(',', '.'));
    if (!Number.isInteger(nextStops) || nextStops < 0) { setError('Neteisingas taškų skaičius.'); return; }
    if (!Number.isFinite(nextWeight) || nextWeight < 0) { setError('Neteisingas svoris.'); return; }
    setBusy(true);
    setError(null);
    try {
      await employeeApi(`/api/admin/assignments/${encodeURIComponent(sheet.assignmentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ totalStops: nextStops, totalWeightKg: nextWeight }),
      });
      setEditing(false);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko išsaugoti.');
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.detailRoute}>
    <Text style={styles.detailRouteTitle}>{sheet.routeNumbers.length > 0 ? sheet.routeNumbers.join(' · ') : 'Maršrutas'}</Text>
    <Text style={styles.detailRouteMeta}>
      {qtyFormatter.format(sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0)} km · {sheet.totalStops} tašk. · {qtyFormatter.format(sheet.totalWeightKg)} kg{sheet.vehicle ? ` · ${sheet.vehicle.registrationNumber}` : ''}
    </Text>
    {canEdit && !editing ? (
      <Pressable
        onPress={openEditor}
        style={({ pressed }) => [styles.metricsEditLink, pressed && styles.driverChipPressed]}
        testID={`finance-edit-metrics-${sheet.assignmentId}`}>
        <Text style={styles.metricsEditLinkText}>Taisyti taškus ir svorį</Text>
      </Pressable>
    ) : null}
    {editing ? <View style={styles.metricsEditor}>
      <View style={styles.metricsFieldRow}>
        <View style={styles.metricsField}>
          <Text style={styles.metricsFieldLabel}>Taškų sk.</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={(value) => setStops(value.replace(/[^\d]/g, '').slice(0, 6))}
            style={styles.metricsInput}
            testID={`finance-metrics-stops-${sheet.assignmentId}`}
            value={stops}
          />
        </View>
        <View style={styles.metricsField}>
          <Text style={styles.metricsFieldLabel}>Svoris, kg</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={(value) => setWeight(value.replace(/[^\d.,]/g, '').slice(0, 9))}
            style={styles.metricsInput}
            testID={`finance-metrics-weight-${sheet.assignmentId}`}
            value={weight}
          />
        </View>
      </View>
      {error ? <Text style={styles.metricsError}>{error}</Text> : null}
      {!online ? <Text style={styles.meta}>Reikia ryšio su serveriu.</Text> : null}
      <View style={styles.metricsActions}>
        <Pressable
          disabled={busy || !online}
          onPress={() => { void save(); }}
          style={({ pressed }) => [styles.metricsSave, (busy || !online) && styles.disabled, pressed && styles.driverChipPressed]}
          testID={`finance-metrics-save-${sheet.assignmentId}`}>
          <Text style={styles.metricsSaveText}>{busy ? 'Saugoma…' : 'Išsaugoti'}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => { setEditing(false); setError(null); }} style={({ pressed }) => [styles.metricsCancel, pressed && styles.driverChipPressed]}>
          <Text style={styles.metricsCancelText}>Atšaukti</Text>
        </Pressable>
      </View>
    </View> : null}
  </View>;
}

/** A bonus for a day that has no trip at all (e.g. an extra Saturday job). */
function AddAdjustmentForm({ driverId, defaultDate, online, onSaved, styles }: {
  driverId: string;
  defaultDate: string;
  online: boolean;
  onSaved: () => void;
  styles: ReturnType<typeof createWageScreenStyles>;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const value = amount.trim() ? Number(amount.trim().replace(',', '.')) : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Įveskite datą YYYY-MM-DD.'); return; }
    if (!Number.isFinite(value) || (value === 0 && !comment.trim())) { setError('Įveskite sumą arba komentarą.'); return; }
    setBusy(true);
    setError(null);
    try {
      await employeeApi('/api/admin/wage-adjustments', { method: 'PUT', body: JSON.stringify({ driverId, date, amountEur: value, comment }) });
      setOpen(false); setAmount(''); setComment('');
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko išsaugoti.');
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.metricsEditLink, pressed && styles.driverChipPressed]} testID="finance-add-adjustment">
      <Text style={styles.metricsEditLinkText}>+ Papildoma suma dienai be reiso</Text>
    </Pressable>;
  }
  return <View style={styles.metricsEditor} testID="finance-add-adjustment-form">
    <View style={styles.metricsFieldRow}>
      <View style={styles.metricsField}>
        <Text style={styles.metricsFieldLabel}>Data</Text>
        <DateInput accessibilityLabel="Papildomos sumos data" value={date} onChangeText={setDate} style={styles.metricsInput} placeholderTextColor={colors.textMuted} />
      </View>
      <View style={styles.metricsField}>
        <Text style={styles.metricsFieldLabel}>Papildomai, €</Text>
        <TextInput keyboardType="decimal-pad" onChangeText={(value) => setAmount(value.replace(/[^\d.,-]/g, '').slice(0, 10))} style={styles.metricsInput} value={amount} />
      </View>
    </View>
    <View style={styles.metricsField}>
      <Text style={styles.metricsFieldLabel}>Komentaras</Text>
      <TextInput onChangeText={(value) => setComment(value.slice(0, 300))} style={styles.metricsInput} value={comment} />
    </View>
    {error ? <Text style={styles.metricsError}>{error}</Text> : null}
    <View style={styles.metricsActions}>
      <Pressable disabled={busy || !online} onPress={() => { void save(); }} style={({ pressed }) => [styles.metricsSave, (busy || !online) && styles.disabled, pressed && styles.driverChipPressed]}>
        <Text style={styles.metricsSaveText}>{busy ? 'Saugoma…' : 'Išsaugoti'}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => setOpen(false)} style={({ pressed }) => [styles.metricsCancel, pressed && styles.driverChipPressed]}>
        <Text style={styles.metricsCancelText}>Atšaukti</Text>
      </Pressable>
    </View>
  </View>;
}

function WageAdjustmentEditor({ day, canEdit, online, onSaved, styles, startEditing = false, onStartEditingConsumed }: {
  day: WageDayRow;
  canEdit: boolean;
  online: boolean;
  onSaved: () => void;
  styles: ReturnType<typeof createWageScreenStyles>;
  /** Open the form immediately (row-level quick action, no long scroll). */
  startEditing?: boolean;
  /** Clear parent quickEditDayKey after consuming the one-shot open request. */
  onStartEditingConsumed?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Only the saved wage-adjustments document — never figures.payEur / wageEur.
  const manual = day.manualAdjustment;
  const hasManualAdjustment = manual !== null;
  const manualAmount = manual?.amountEur ?? 0;
  const manualComment = manual?.comment ?? '';
  // Refs keep seed values current without listing them as effect deps (that
  // would re-fire after save+load and reopen / overwrite in-progress text).
  const manualAmountRef = useRef(manualAmount);
  const manualCommentRef = useRef(manualComment);
  manualAmountRef.current = manualAmount;
  manualCommentRef.current = manualComment;

  useEffect(() => {
    // Depend only on startEditing (not manualAmount/manualComment): after save,
    // load refreshes those values and must not reopen the form or overwrite text.
    applyWageQuickEditOpen({
      startEditing,
      manualAmount: manualAmountRef.current,
      manualComment: manualCommentRef.current,
      seed: (nextAmount, nextComment) => {
        setAmount(nextAmount);
        setComment(nextComment);
        setError(null);
      },
      setEditing,
      consume: () => onStartEditingConsumed?.(),
    });
  }, [startEditing, onStartEditingConsumed]);

  const open = () => {
    setAmount(manualAmount ? String(manualAmount).replace('.', ',') : '');
    setComment(manualComment);
    setError(null);
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setError(null);
    onStartEditingConsumed?.();
  };

  const save = async () => {
    const value = amount.trim() ? Number(amount.trim().replace(',', '.')) : 0;
    if (!Number.isFinite(value)) { setError('Neteisinga suma.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Writes only the manual record for this driver+date. Trip wage parts stay
      // untouched, so saving cannot double legacy/route extras into wage-adjustments.
      await employeeApi('/api/admin/wage-adjustments', {
        method: 'PUT',
        body: JSON.stringify({ driverId: day.driverId, date: day.date, amountEur: value, comment }),
      });
      closeEditor();
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko išsaugoti.');
    } finally {
      setBusy(false);
    }
  };

  // Narrow by driverId + date only, so a failed attempt leaves the record
  // untouched and can simply be pressed again. Legacy trip amounts never get
  // a remove button because hasManualAdjustment requires a saved document.
  // Modal (not RN Alert) keeps cancel/confirm/busy/error/retry working on web.
  const removeAdjustment = () => {
    if (!hasManualAdjustment || !manual) return;
    setRemoveError(null);
    setConfirmRemove(true);
  };

  const executeRemove = async () => {
    if (!hasManualAdjustment || !manual) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await employeeApi('/api/admin/wage-adjustments', {
        method: 'PUT',
        body: JSON.stringify({ driverId: day.driverId, date: day.date, amountEur: 0, comment: '' }),
      });
      setConfirmRemove(false);
      closeEditor();
      setRemoveError(null);
      onSaved();
    } catch (reason) {
      // The adjustment stays as-is on failure; dialog stays open for retry.
      setRemoveError(reason instanceof Error ? reason.message : 'Pašalinti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.detailSection} testID={`finance-wage-adjustment-${day.key}`}>
    <Text style={styles.detailSectionTitle}>Rankinė papildoma suma ir komentaras</Text>
    {!editing ? <>
      <DetailLine
        label={hasManualAdjustment ? (manualComment || 'Komentaro nėra') : 'Rankinio koregavimo nėra'}
        value={hasManualAdjustment && manualAmount ? eur2Formatter.format(manualAmount) : hasManualAdjustment ? '0,00 €' : '—'}
        styles={styles}
      />
      {day.figures.wageEur != null && day.figures.wageEur !== 0 ? (
        <Text style={styles.meta}>Reiso atlygis ({eur2Formatter.format(day.figures.wageEur)}) čia neredaguojamas ir nešalinamas.</Text>
      ) : null}
      {removeError && !confirmRemove ? <Text accessibilityRole="alert" style={styles.metricsError}>{removeError}</Text> : null}
      {canEdit ? <View style={styles.metricsActionLinks}>
        <Pressable
          onPress={open}
          style={({ pressed }) => [styles.metricsEditLink, pressed && styles.driverChipPressed]}
          testID={`finance-edit-adjustment-${day.key}`}>
          <Text style={styles.metricsEditLinkText}>{hasManualAdjustment ? 'Taisyti rankinę sumą ir komentarą' : 'Pridėti rankinę sumą ar komentarą'}</Text>
        </Pressable>
        {hasManualAdjustment ? <Pressable
          disabled={busy || !online}
          onPress={removeAdjustment}
          style={({ pressed }) => [styles.metricsEditLink, (busy || !online) && styles.disabled, pressed && styles.driverChipPressed]}
          testID={`finance-remove-adjustment-${day.key}`}>
          <Text style={[styles.metricsEditLinkText, styles.metricsRemoveText]}>Pašalinti rankinę sumą</Text>
        </Pressable> : null}
      </View> : null}
    </> : <View style={styles.metricsEditor}>
      <View style={styles.metricsFieldRow}>
        <View style={styles.metricsField}>
          <Text style={styles.metricsFieldLabel}>Papildomai, €</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={(value) => setAmount(value.replace(/[^\d.,-]/g, '').slice(0, 10))}
            style={styles.metricsInput}
            testID={`finance-adjustment-amount-${day.key}`}
            value={amount}
          />
        </View>
        <View style={styles.metricsField}>
          <Text style={styles.metricsFieldLabel}>Komentaras</Text>
          <TextInput
            onChangeText={(value) => setComment(value.slice(0, 300))}
            style={styles.metricsInput}
            testID={`finance-adjustment-comment-${day.key}`}
            value={comment}
          />
        </View>
      </View>
      {error ? <Text style={styles.metricsError}>{error}</Text> : null}
      {!online ? <Text style={styles.meta}>Reikia ryšio su serveriu.</Text> : null}
      <View style={styles.metricsActions}>
        <Pressable
          disabled={busy || !online}
          onPress={() => { void save(); }}
          style={({ pressed }) => [styles.metricsSave, (busy || !online) && styles.disabled, pressed && styles.driverChipPressed]}
          testID={`finance-adjustment-save-${day.key}`}>
          <Text style={styles.metricsSaveText}>{busy ? 'Saugoma…' : 'Išsaugoti'}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={closeEditor} style={({ pressed }) => [styles.metricsCancel, pressed && styles.driverChipPressed]} testID={`finance-adjustment-cancel-${day.key}`}>
          <Text style={styles.metricsCancelText}>Atšaukti</Text>
        </Pressable>
      </View>
    </View>}
    <FinanceConfirmDialog
      busy={busy}
      error={removeError}
      message={`${day.driverName} · ${formatDateKey(day.date)} rankinė papildoma suma (${manualAmount ? eur2Formatter.format(manualAmount) : '0,00 €'}${manualComment ? ` · ${manualComment}` : ''}) bus pašalinta. Reisas, kuro ir odometrų įrašai nekeičiami.`}
      onCancel={() => { if (!busy) { setConfirmRemove(false); setRemoveError(null); } }}
      onConfirm={() => { void executeRemove(); }}
      onRetry={() => { void executeRemove(); }}
      testID={`finance-remove-confirm-${day.key}`}
      title="Pašalinti papildomą sumą?"
      visible={confirmRemove}
    />
  </View>;
}

function DetailLine({ label, value, emphasis, styles, testID }: {
  label: string;
  value: string;
  emphasis?: boolean;
  styles: ReturnType<typeof createWageScreenStyles>;
  testID?: string;
}) {
  return <View style={styles.detailLine} testID={testID}>
    <Text style={styles.detailLineLabel}>{label}</Text>
    <Text style={[styles.detailLineValue, emphasis && styles.detailLineValueEmphasis]}>{value}</Text>
  </View>;
}

function formatWageAmount(value: number | null): string {
  return value === null ? '—' : eur2Formatter.format(value);
}

function formatWageCell(day: WageDayRow, key: WageColumnKey): string {
  if (key === 'date') return formatDateKey(day.date);
  const value = wageDayCell(day, key);
  if (value === null || value === '') return '—';
  if (typeof value === 'number') {
    if (key === 'stops') return String(value);
    if (key === 'km' || key === 'kg') return qtyFormatter.format(value);
    return eur2Formatter.format(value);
  }
  return value;
}

function formatWageTotal(totals: ReturnType<typeof summarizeWageDays>, key: WageColumnKey): string {
  if (key === 'date') return 'Iš viso';
  const value = wageTotalCell(totals, key);
  if (value === null || value === '') return '';
  if (typeof value === 'number') {
    if (key === 'stops') return String(value);
    if (key === 'km' || key === 'kg') return qtyFormatter.format(value);
    return eur2Formatter.format(value);
  }
  return value;
}

function WageDayTable({ days, totals, showDriverNames, expandedDayKey, quickEditDayKey, onToggle, onQuickEdit, onQuickEditConsumed, canEdit, online, onSaved, styles }: {
  days: WageDayRow[];
  totals: ReturnType<typeof summarizeWageDays>;
  showDriverNames: boolean;
  expandedDayKey: string | null;
  quickEditDayKey: string | null;
  onToggle: (key: string) => void;
  onQuickEdit: (key: string) => void;
  onQuickEditConsumed: () => void;
  canEdit: boolean;
  online: boolean;
  onSaved: () => void;
  styles: ReturnType<typeof createWageScreenStyles>;
}) {
  const columns = wageTableColumns(showDriverNames);
  return <ScrollView horizontal showsHorizontalScrollIndicator testID="finance-wage-table">
    <View style={styles.wageTable}>
      <View style={[styles.wageTableRow, styles.wageTableHeader]}>
        {columns.map((column) => <Text key={column.key} style={[styles.wageTableCell, column.format === 'text' ? styles.wageTableText : styles.wageTableNumber, styles.wageTableHeaderText]}>{column.header}</Text>)}
        {canEdit ? <Text style={[styles.wageTableCell, styles.wageTableQuick, styles.wageTableHeaderText]}>Priedas</Text> : null}
        <Text style={styles.wageTableToggle} />
      </View>
      {days.map((day) => {
        const expanded = expandedDayKey === day.key;
        return <View key={day.key} testID={`finance-wage-day-${day.key}`}>
          <View style={styles.wageTableRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => onToggle(day.key)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }, pressed && styles.wageDayRowPressed]}
              testID={`finance-wage-day-toggle-${day.key}`}>
              {columns.map((column) => <Text key={column.key} style={[styles.wageTableCell, column.format === 'text' ? styles.wageTableText : styles.wageTableNumber, column.key === 'totalEur' ? styles.wageDayAmount : null]}>{formatWageCell(day, column.key)}{column.key === 'date' && day.preliminary ? ' · prel.' : ''}</Text>)}
            </Pressable>
            {canEdit ? <Pressable
              onPress={() => onQuickEdit(day.key)}
              style={({ pressed }) => [styles.wageTableCell, styles.wageTableQuick, pressed && styles.driverChipPressed]}
              testID={`finance-quick-edit-adjustment-${day.key}`}>
              <Text style={styles.metricsEditLinkText}>{day.manualAdjustment ? 'Taisyti' : 'Pridėti'}</Text>
            </Pressable> : null}
            <Pressable onPress={() => onToggle(day.key)} style={styles.wageTableToggle} testID={`finance-wage-day-chevron-${day.key}`}>
              <Text style={styles.wageTableToggle}>{expanded ? '⌃' : '⌄'}</Text>
            </Pressable>
          </View>
          {expanded ? <WageDayDetail
            canEdit={canEdit}
            day={day}
            online={online}
            onSaved={onSaved}
            onStartEditingConsumed={onQuickEditConsumed}
            startEditingAdjustment={quickEditDayKey === day.key}
            styles={styles}
          /> : null}
        </View>;
      })}
      <View style={[styles.wageTableRow, styles.wageTableTotal]}>
        {columns.map((column) => <Text key={column.key} style={[styles.wageTableCell, column.format === 'text' ? styles.wageTableText : styles.wageTableNumber, styles.wageTableTotalText]}>{formatWageTotal(totals, column.key)}</Text>)}
        {canEdit ? <Text style={[styles.wageTableCell, styles.wageTableQuick]} /> : null}
        <Text style={styles.wageTableToggle} />
      </View>
    </View>
  </ScrollView>;
}

/** Day expansion body: routes, wage composition (incl. manual extra), fuel. Exported for render tests. */
export function WageDayDetail({ day, canEdit, online, onSaved, styles, startEditingAdjustment = false, onStartEditingConsumed }: {
  day: WageDayRow;
  canEdit: boolean;
  online: boolean;
  onSaved: () => void;
  styles: ReturnType<typeof createWageScreenStyles>;
  startEditingAdjustment?: boolean;
  onStartEditingConsumed?: () => void;
}) {
  const figures = day.figures;
  const fuelEntries = [...new Map(day.sheets.flatMap((sheet) => sheet.fuelEntries).map((entry) => [entry.id, entry])).values()];
  const distanceSource = day.sheets.find((sheet) => sheet.compensation)?.compensation?.distanceSource;
  // Manual bonus is already folded into figures.payEur; never add wageEur again.
  const manual = day.manualAdjustment;
  return <View style={styles.wageDayDetail} testID={`finance-wage-day-detail-${day.key}`}>
    {/* Manual adjustment first so quick-edit does not require scrolling past routes. */}
    <WageAdjustmentEditor
      canEdit={canEdit}
      day={day}
      online={online}
      onSaved={onSaved}
      onStartEditingConsumed={onStartEditingConsumed}
      startEditing={startEditingAdjustment}
      styles={styles}
    />

    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{day.sheets.length > 1 ? `Reisai (${day.sheets.length})` : 'Reisas'}</Text>
      {day.sheets.length === 0 ? <Text style={styles.meta}>Šią dieną reiso nėra – tik papildoma suma.</Text> : null}
      {day.sheets.map((sheet) => (
        <RouteMetricsRow key={sheet.id} canEdit={canEdit} onSaved={onSaved} online={online} sheet={sheet} styles={styles} />
      ))}
    </View>

    {figures.hasCompensation ? <View style={styles.detailSection} testID={`finance-wage-composition-${day.key}`}>
      <Text style={styles.detailSectionTitle}>Atlygio sudėtis{day.preliminary ? ' · preliminaru' : ''}</Text>
      {day.sheets.length > 1 ? <Text style={styles.meta}>Bazinis dienos atlygis įrašytas vieną kartą ir nėra dauginamas iš reisų skaičiaus. Eurai yra dienos, ne atskiro reiso.</Text> : null}
      <DetailLine label="Bazinis (diena)" value={formatWageAmount(figures.fixedAmountEur)} styles={styles} />
      <DetailLine label={`Atstumas · ${qtyFormatter.format(figures.distanceKm)} km${distanceSource ? ` (${distanceSource === 'odometer' ? 'odometras' : 'planuota'})` : ''}`} value={formatWageAmount(figures.distanceAmountEur)} styles={styles} />
      <DetailLine label={`Svoris · ${qtyFormatter.format(figures.weightKg)} kg`} value={formatWageAmount(figures.weightAmountEur)} styles={styles} />
      <DetailLine label={`Taškai · ${figures.stops}`} value={formatWageAmount(figures.stopsAmountEur)} styles={styles} />
      {manual ? (
        <DetailLine
          label="Papildomai"
          value={formatWageAmount(manual.amountEur)}
          styles={styles}
          testID={`finance-wage-composition-extra-${day.key}`}
        />
      ) : null}
      {/* Same total as the day card (payEur = trip wage + manual), not trip-only wageEur. */}
      <DetailLine
        label="Dienos suma"
        value={formatWageAmount(figures.payEur)}
        emphasis
        styles={styles}
        testID={`finance-wage-composition-total-${day.key}`}
      />
    </View> : <Text style={styles.meta}>Atlygio detalizacija dar neapskaičiuota.</Text>}

    {fuelEntries.length > 0 ? <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>Kuras</Text>
      {fuelEntries.map((entry) => (
        <DetailLine
          key={entry.id}
          label={`${qtyFormatter.format(entry.liters)} l${entry.receiptNumber ? ` · čekis ${entry.receiptNumber}` : ''}`}
          value={entry.totalCost != null ? eur2Formatter.format(entry.totalCost) : '—'}
          styles={styles}
        />
      ))}
    </View> : null}
  </View>;
}

export const createWageScreenStyles = (colors: ColorPalette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  periodPanel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  driverFilter: { gap: spacing.xs },
  driverFilterLabel: { ...type.label, color: colors.textMuted },
  driverChipPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  driverTrigger: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driverTriggerOpen: { borderColor: colors.info },
  driverTriggerText: { flex: 1, minWidth: 0 },
  driverTriggerValue: { ...type.bodyStrong, color: colors.text },
  driverTriggerHint: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  driverChevron: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  driverChevronOpen: { transform: [{ rotate: '180deg' }] },
  driverOptions: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden' },
  driverOption: { minHeight: 48, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  driverOptionSelected: { backgroundColor: colors.infoSoft },
  driverOptionText: { ...type.body, color: colors.text },
  driverOptionTextSelected: { ...type.bodyStrong, color: colors.info },
  driverOptionCheck: { ...type.bodyStrong, color: colors.info },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 4 },
  emptyTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, minHeight: 74, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  metricValue: { ...type.sectionTitle, color: colors.text },
  metricValueEmphasis: { color: colors.info },
  metricLabel: { ...type.label, color: colors.textMuted },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  exportButton: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  exportButtonText: { ...type.button, color: colors.textSecondary },
  wageList: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden' },
  wageTable: { minWidth: 860, width: '100%' },
  wageTableRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  wageTableHeader: { backgroundColor: colors.surfaceMuted, borderTopWidth: 0 },
  wageTableHeaderText: { ...type.label, color: colors.textMuted },
  wageTableTotal: { backgroundColor: colors.surfaceSubtle },
  wageTableTotalText: { ...type.secondaryStrong, color: colors.text },
  wageTableCell: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  wageTableText: { ...type.secondary, color: colors.text, width: 140, flexShrink: 0 },
  wageTableNumber: { ...type.secondary, color: colors.text, width: 72, textAlign: 'right', flexShrink: 0 },
  wageTableQuick: { width: 72, flexShrink: 0, justifyContent: 'center' },
  wageTableToggle: { ...type.body, color: colors.textMuted, width: 36, textAlign: 'center' },
  dayQuickActions: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, gap: spacing.xs, backgroundColor: colors.surfaceSubtle },
  wageListHeading: { padding: spacing.md, gap: 2, backgroundColor: colors.surfaceSubtle },
  wageListTitle: { ...type.sectionTitle, color: colors.text },
  wageDayRow: { minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  wageDayRowPressed: { backgroundColor: colors.surfaceSubtle },
  wageDayIdentity: { flex: 1, minWidth: 0, gap: 2 },
  wageDayDate: { ...type.bodyStrong, color: colors.text },
  wageDayDriver: { ...type.secondary, color: colors.textSecondary },
  wageDayStatus: { ...type.meta, color: colors.warning },
  wageDayAmount: { ...type.sectionTitle, color: colors.text, textAlign: 'right' },
  wageDayChevron: { ...type.body, color: colors.textMuted },
  wageDayDetail: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md, backgroundColor: colors.surfaceSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  detailSection: { gap: spacing.xs },
  detailSectionTitle: { ...type.label, color: colors.textMuted },
  detailRoute: { gap: spacing.xs, paddingBottom: spacing.xs },
  detailRouteTitle: { ...type.secondaryStrong, color: colors.text },
  detailRouteMeta: { ...type.meta, color: colors.textMuted },
  metricsEditLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  metricsEditLinkText: { ...type.secondaryStrong, color: colors.info },
  metricsRemoveText: { color: colors.danger },
  metricsActionLinks: { gap: spacing.xs },
  metricsEditor: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  metricsFieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricsField: { flex: 1, minWidth: 0, gap: 2 },
  metricsFieldLabel: { ...type.label, color: colors.textMuted },
  metricsInput: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, backgroundColor: colors.surfaceSubtle, color: colors.text, ...type.body },
  metricsError: { ...type.secondary, color: colors.danger },
  metricsActions: { flexDirection: 'row', gap: spacing.sm },
  metricsSave: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  metricsSaveText: { ...type.button, color: colors.textInverse },
  metricsCancel: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  metricsCancelText: { ...type.button, color: colors.textSecondary },
  detailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 26 },
  detailLineLabel: { ...type.secondary, color: colors.textSecondary, flex: 1, minWidth: 0 },
  detailLineValue: { ...type.secondaryStrong, color: colors.text, textAlign: 'right' },
  detailLineValueEmphasis: { color: colors.info },
  unassignedCleanup: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dangerButton: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { ...type.button, color: colors.danger },
  disabled: { opacity: 0.6 },
  disclaimer: { ...type.meta, color: colors.textMuted },
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  settingsLinkPressed: { opacity: 0.85 },
  settingsLinkTitle: { ...type.bodyStrong, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
