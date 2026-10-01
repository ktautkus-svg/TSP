import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import {
  buildMonthSummary,
  draftFromRow,
  emptyDraft,
  filterMonthSummaryRows,
  formatMonthSummaryDay,
  formatSummaryClock,
  formatSummaryDateTime,
  MONTH_SUMMARY_EXPORT_HEADERS,
  monthSummaryExportRows,
  reviewMonthSummaryCreate,
  reviewMonthSummaryEdit,
  summarizeMonthRows,
  type MonthSummaryDraft,
  type MonthSummaryReview,
  type MonthSummaryRow,
  type MonthSummarySaveRequest,
} from '@/application/reporting/month-summary';
import { buildTableWorkbook } from '@/application/trip-sheet/export-xlsx';
import { DateInput } from '@/components/date-input';
import { FiroSelect, type FiroSelectOption } from '@/components/firo-select';
import { FoundationScreen } from '@/components/foundation-screen';
import { AppButton, AppTextField } from '@/components/ui-primitives';
import { lithuanianWallClockNow } from '@/domain/lithuanian-time';
import {
  employeeApi,
  type EmployeeProfile,
  type ServerAdminCorrection,
  type ServerFleetVehicle,
  type ServerRouteAssignment,
  type ServerTripSheet,
} from '@/infrastructure/auth/employee-session';
import { layout, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const MONTHS = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
const DESKTOP_WIDTH = 1280;
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CORRECTION_LABELS: Record<string, string> = {
  driver: 'Vairuotojas',
  vehicle: 'Automobilis',
  date: 'Data',
  totalStops: 'Taškai',
  totalWeightKg: 'Svoris',
  startOdometer: 'Odometras pradžioje',
  endOdometer: 'Odometras pabaigoje',
  startedAt: 'Išvykimas',
  completedAt: 'Užbaigimas',
};

const decimal = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

type EditorState = {
  mode: 'create' | 'edit';
  rowKey: string | null;
  draft: MonthSummaryDraft;
  phase: 'form' | 'confirm';
};

export default function MonthSummaryScreen() {
  const { profile, online } = useLocalAccess();
  const { width, height } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const desktop = width >= DESKTOP_WIDTH;
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageFinancials);
  const today = lithuanianWallClockNow();
  const currentYear = Number(today.date.slice(0, 4));
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(String(Number(today.date.slice(5, 7))));
  const [query, setQuery] = useState('');
  const [driverId, setDriverId] = useState('all');
  const [vehicleId, setVehicleId] = useState('all');
  const [plate, setPlate] = useState('all');
  const [day, setDay] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [tripSheets, setTripSheets] = useState<ServerTripSheet[]>([]);
  const [users, setUsers] = useState<EmployeeProfile[]>([]);
  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [corrections, setCorrections] = useState<ServerAdminCorrection[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [attempted, setAttempted] = useState(false);

  const monthKey = `${year}-${month.padStart(2, '0')}`;
  const load = useCallback(async () => {
    if (!allowed) return;
    if (!online) {
      setError('Nėra ryšio su serveriu. Mėnesio suvestinė skaičiuojama iš serverio duomenų.');
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const [assignmentResponse, sheetResponse, userResponse, vehicleResponse] = await Promise.all([
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
        employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets'),
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
      ]);
      setAssignments(assignmentResponse.assignments);
      setTripSheets(sheetResponse.tripSheets);
      setUsers(userResponse.users);
      setVehicles(vehicleResponse.vehicles);
      try {
        const correctionResponse = await employeeApi<{ corrections: ServerAdminCorrection[] }>(`/api/admin/accounting-corrections?month=${monthKey}`);
        setCorrections(correctionResponse.corrections);
      } catch {
        setCorrections([]);
        setNotice('Pakeitimų istorijos šį kartą nuskaityti nepavyko. Suvestinės duomenys užkrauti.');
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mėnesio duomenų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [allowed, monthKey, online]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDay(''); }, [year, month]);

  const summary = useMemo(
    () => buildMonthSummary({
      year: Number(year),
      month: Number(month),
      assignments: assignments.map((item) => ({ ...item, vehicle: item.vehicle ?? null })),
      tripSheets,
    }),
    [assignments, month, tripSheets, year],
  );
  const visible = useMemo(
    () => filterMonthSummaryRows(summary.rows, { query, driverId, vehicleId, plate, date: day, problemsOnly }),
    [day, driverId, plate, problemsOnly, query, summary.rows, vehicleId],
  );
  const totals = useMemo(() => summarizeMonthRows(visible), [visible]);
  const narrowing = Boolean(query.trim()) || driverId !== 'all' || vehicleId !== 'all' || plate !== 'all' || Boolean(day) || problemsOnly;

  const people = useMemo(
    () => users
      .filter((user) => !user.disabled && (user.role === 'driver' || user.role === 'admin'))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'lt')),
    [users],
  );
  const driverName = useCallback((id: string) => people.find((user) => user.id === id)?.displayName ?? '', [people]);
  const vehicleName = useCallback((id: string) => {
    const vehicle = vehicles.find((item) => item.id === id);
    if (!vehicle) return '';
    return vehicle.registrationNumber ? `${vehicle.model} · ${vehicle.registrationNumber}` : vehicle.model;
  }, [vehicles]);
  const review = useMemo(() => {
    if (!editor) return null;
    const names = { driverName, vehicleName };
    if (editor.mode === 'create') return reviewMonthSummaryCreate(editor.draft, summary.rows, names, new Date().toISOString());
    const row = summary.rows.find((item) => item.key === editor.rowKey);
    return row ? reviewMonthSummaryEdit(row, editor.draft, summary.rows, names) : null;
  }, [driverName, editor, summary.rows, vehicleName]);

  const yearOptions: FiroSelectOption[] = [0, 1, 2].map((offset) => {
    const value = String(currentYear - offset);
    return { id: value, primary: value };
  });
  const monthOptions: FiroSelectOption[] = MONTHS.map((label, index) => ({ id: String(index + 1), primary: label }));
  const driverOptions: FiroSelectOption[] = [{ id: 'all', primary: 'Visi vairuotojai' }, ...people.map((user) => ({ id: user.id, primary: user.displayName }))];
  const vehicleOptions: FiroSelectOption[] = [
    { id: 'all', primary: 'Visi automobiliai' },
    ...vehicles.map((vehicle) => ({ id: vehicle.id, primary: vehicle.registrationNumber, secondary: vehicle.model })),
  ];
  const plateOptions: FiroSelectOption[] = [
    { id: 'all', primary: 'Visi numeriai' },
    ...[...new Set(vehicles.map((vehicle) => vehicle.registrationNumber).filter(Boolean))].sort().map((value) => ({ id: value, primary: value })),
  ];
  const dayOptions: FiroSelectOption[] = [{ id: '', primary: 'Visos dienos' }, ...summary.days.map((date) => ({ id: date, primary: formatMonthSummaryDay(date) }))];

  const openCreate = (date: string) => {
    setAttempted(false);
    setEditor({ mode: 'create', rowKey: null, draft: emptyDraft(date), phase: 'form' });
  };
  const openEdit = (row: MonthSummaryRow) => {
    setAttempted(false);
    setEditor({ mode: 'edit', rowKey: row.key, draft: draftFromRow(row), phase: 'form' });
  };

  const save = async () => {
    if (!review?.ok || saving) return;
    setSaving(true);
    const notes: string[] = [];
    try {
      for (const request of review.requests) {
        const result = await sendMonthSummaryRequest(request);
        if (result.readingLeftInPlace) notes.push('Odometro diena liko senoje datoje, nes ja dalijasi keli reisai arba naujoje datoje jau yra rodmuo.');
        if (result.dayReadingSkipped) notes.push('Naujo reiso kilometrus gali uždengti jau esantis šios automobilio dienos odometras.');
      }
      setEditor(null);
      setNotice(notes.join(' ') || 'Pakeitimas išsaugotas.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pakeitimo išsaugoti nepavyko.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setNotice('Excel eksportą atidarykite interneto naršyklėje.');
      return;
    }
    const bytes = buildTableWorkbook({
      sheetName: 'Mėnesio suvestinė',
      title: 'Mėnesio suvestinė',
      subtitle: narrowing ? `${monthKey} · rodomos filtruotos eilutės` : monthKey,
      headers: MONTH_SUMMARY_EXPORT_HEADERS,
      rows: monthSummaryExportRows(visible),
      columnWidths: [14, 22, 22, 16, 18, 16, 12, 14, 14, 16, 18, 18, 36],
    });
    const payload = new Uint8Array(bytes);
    const blob = new Blob([payload], { type: MIME_XLSX });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `firo-menesio-suvestine-${monthKey}.xlsx`;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
    setNotice('Excel failas paruoštas. FiRo duomenys nebuvo pakeisti.');
  };

  const editingRow = editor?.rowKey ? summary.rows.find((row) => row.key === editor.rowKey) ?? null : null;

  return <>
    <Stack.Screen options={{ title: 'Mėnesio suvestinė' }} />
    <FoundationScreen
      contentMaxWidth={1240}
      description="Kiekvienas reisas atskira eilute. Tuščia diena reiškia, kad tą dieną FiRo neturi reiso."
      showFoundationNotice={false}
      title="Mėnesio suvestinė">
      {!allowed ? <Text style={styles.error}>Šiai suvestinei reikia finansų teisės.</Text> : <View testID="month-summary-screen">
        <View style={styles.filters}>
          <View style={styles.filterItem}><FiroSelect label="Metai" onChange={setYear} options={yearOptions} placeholder="Metai" testID="month-summary-year" value={year} /></View>
          <View style={styles.filterItem}><FiroSelect label="Mėnuo" onChange={setMonth} options={monthOptions} placeholder="Mėnuo" testID="month-summary-month" value={month} /></View>
          <View style={styles.filterGrow}>
            <Text style={styles.label}>Paieška</Text>
            <TextInput
              onChangeText={setQuery}
              placeholder="Vairuotojas, numeris, maršrutas"
              placeholderTextColor={colors.textSubtle}
              style={styles.search}
              testID="month-summary-search"
              value={query} />
          </View>
          <View style={styles.filterItem}><FiroSelect label="Vairuotojas" onChange={setDriverId} options={driverOptions} placeholder="Vairuotojas" testID="month-summary-driver" value={driverId} /></View>
          <View style={styles.filterItem}><FiroSelect label="Automobilis" onChange={setVehicleId} options={vehicleOptions} placeholder="Automobilis" testID="month-summary-vehicle" value={vehicleId} /></View>
          <View style={styles.filterItem}><FiroSelect label="Valstybinis numeris" onChange={setPlate} options={plateOptions} placeholder="Numeris" testID="month-summary-plate" value={plate} /></View>
          <View style={styles.filterItem}><FiroSelect label="Data" onChange={setDay} options={dayOptions} placeholder="Data" testID="month-summary-day" value={day} /></View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: problemsOnly }}
            onPress={() => setProblemsOnly((current) => !current)}
            style={[styles.problemToggle, problemsOnly && styles.problemToggleOn]}
            testID="month-summary-problems">
            <Text style={styles.problemToggleText}>Tik su trūkumais</Text>
            <Text style={styles.meta}>{problemsOnly ? 'Įjungta' : 'Išjungta'}</Text>
          </Pressable>
        </View>
        <View style={styles.actions}>
          <AppButton label="Atnaujinti" onPress={() => void load()} variant="secondary" />
          <AppButton label="Eksportuoti Excel" onPress={exportExcel} testID="month-summary-export" variant="secondary" />
          <AppButton label="Pridėti įrašą" onPress={() => openCreate(day || `${monthKey}-01`)} testID="month-summary-add" />
        </View>
        <Text style={styles.totals}>
          {`Reisai ${integer.format(totals.trips)} · Taškai ${integer.format(totals.stops)} · Svoris ${decimal.format(totals.weightKg)} kg · Kilometrai ${decimal.format(totals.distanceKm)} · Trūkumai ${integer.format(totals.problemRows)}`}
        </Text>
        {totals.plannedOnlyRows > 0 ? <Text style={styles.meta}>Planuojami kilometrai į sumą neįtraukti ({integer.format(totals.plannedOnlyRows)}).</Text> : null}
        {narrowing ? <Text style={styles.meta}>Tuščios dienos paslėptos, kol veikia filtras.</Text> : null}
        {visible.some((row) => row.sharesVehicleDay) ? <Text style={styles.meta}>Ta pati automobilio diena dalijasi vienu odometro rodmeniu, jei reisų yra keli.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {busy ? <ActivityIndicator color={colors.primary} /> : desktop
          ? <DesktopTable corrections={corrections} onCreate={openCreate} onEdit={openEdit} rows={visible} styles={styles} />
          : <PhoneList corrections={corrections} onCreate={openCreate} onEdit={openEdit} rows={visible} styles={styles} />}
      </View>}
      <EditorModal
        draft={editor?.draft ?? null}
        editingRow={editingRow}
        mode={editor?.mode ?? null}
        onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)}
        onBack={() => setEditor((current) => current ? { ...current, phase: 'form' } : current)}
        onClose={() => setEditor(null)}
        onConfirm={() => void save()}
        onReview={() => {
          if (!review?.ok) { setAttempted(true); return; }
          setEditor((current) => current ? { ...current, phase: 'confirm' } : current);
        }}
        people={people}
        phase={editor?.phase ?? 'form'}
        review={review}
        saving={saving}
        showErrors={attempted}
        sheetMaxHeight={Math.round(height * 0.9)}
        styles={styles}
        vehicles={vehicles}
        visible={editor !== null} />
    </FoundationScreen>
  </>;
}

async function sendMonthSummaryRequest(request: MonthSummarySaveRequest): Promise<{ readingLeftInPlace?: boolean; dayReadingSkipped?: boolean }> {
  if (request.kind === 'assignment') {
    await employeeApi(`/api/admin/assignments/${encodeURIComponent(request.assignmentId)}`, {
      method: 'PATCH',
      body: JSON.stringify(request.body),
    });
    return {};
  }
  if (request.kind === 'trip-sheet') {
    await employeeApi(`/api/trip-sheets/${encodeURIComponent(request.assignmentId)}`, {
      method: 'PATCH',
      body: JSON.stringify(request.body),
    });
    return {};
  }
  if (request.kind === 'work-date') {
    return employeeApi(`/api/admin/assignments/${encodeURIComponent(request.assignmentId)}/work-date`, {
      method: 'POST',
      body: JSON.stringify({ date: request.date }),
    });
  }
  if (request.kind === 'day-reading') {
    await employeeApi('/api/trip-sheets/day-readings', { method: 'POST', body: JSON.stringify(request.body) });
    return {};
  }
  if (request.kind === 'move-reading') {
    await employeeApi('/api/admin/vehicle-day-readings/move', { method: 'POST', body: JSON.stringify(request.body) });
    return {};
  }
  return employeeApi('/api/admin/accounting-trips', { method: 'POST', body: JSON.stringify(request.body) });
}

function DesktopTable({ rows, corrections, onEdit, onCreate, styles }: {
  rows: readonly MonthSummaryRow[];
  corrections: readonly ServerAdminCorrection[];
  onEdit: (row: MonthSummaryRow) => void;
  onCreate: (date: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View>
    <View style={styles.head}>
      {['Data', 'Vairuotojas', 'Numeris', 'Maršrutas', 'Taškai', 'Svoris', 'Km', 'Pastabos', ''].map((label) => (
        <Text key={label || 'action'} style={[styles.headCell, label === '' && styles.actionCell]}>{label}</Text>
      ))}
    </View>
    {rows.map((row) => <DesktopRow corrections={corrections} key={row.key} onCreate={onCreate} onEdit={onEdit} row={row} styles={styles} />)}
  </View>;
}

function DesktopRow({ row, corrections, onEdit, onCreate, styles }: {
  row: MonthSummaryRow;
  corrections: readonly ServerAdminCorrection[];
  onEdit: (row: MonthSummaryRow) => void;
  onCreate: (date: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const severe = isSevere(row);
  return <View style={[styles.row, row.issues.length > 0 && (severe ? styles.rowDanger : styles.rowWarning)]} testID={`month-summary-row-${row.key}`}>
    <Text style={styles.cell}>{formatMonthSummaryDay(row.date)}</Text>
    <Text style={styles.cell}>{shownDriver(row)}</Text>
    <Text style={styles.cell}>{row.registrationNumber || 'Nėra numerio'}</Text>
    <Text style={styles.cell}>{row.source === 'empty' ? '—' : row.routeLabel}</Text>
    <Text style={styles.cell}>{shownCount(row.totalStops)}</Text>
    <Text style={styles.cell}>{shownDecimal(row.totalWeightKg)}</Text>
    <Text style={styles.cell}>{kmText(row)}</Text>
    <Text style={styles.cell}>{noteText(row, corrections)}</Text>
    <View style={styles.actionCell}>
      {row.source === 'empty'
        ? <AppButton label="Pridėti" onPress={() => onCreate(row.date)} variant="secondary" />
        : row.canEdit
          ? <AppButton label="Taisyti" onPress={() => onEdit(row)} testID={`month-summary-edit-${row.key}`} variant="secondary" />
          : <Text style={styles.meta}>Tik peržiūra</Text>}
    </View>
  </View>;
}

function PhoneList({ rows, corrections, onEdit, onCreate, styles }: {
  rows: readonly MonthSummaryRow[];
  corrections: readonly ServerAdminCorrection[];
  onEdit: (row: MonthSummaryRow) => void;
  onCreate: (date: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const groups = new Map<string, MonthSummaryRow[]>();
  for (const row of rows) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  return <View style={styles.dayList}>
    {[...groups.entries()].map(([date, items]) => <View key={date} style={styles.daySection}>
      <Text style={styles.dayTitle}>{formatMonthSummaryDay(date)}</Text>
      {items.map((row) => {
        const severe = isSevere(row);
        return <View key={row.key} style={[styles.dayCard, row.issues.length > 0 && (severe ? styles.rowDanger : styles.rowWarning)]} testID={`month-summary-row-${row.key}`}>
          <Fact label="Vairuotojas" styles={styles} value={shownDriver(row)} />
          <Fact label="Valstybinis numeris" styles={styles} value={row.registrationNumber || 'Nėra numerio'} />
          <Fact label="Maršrutas" styles={styles} value={row.source === 'empty' ? '—' : row.routeLabel} />
          <Fact label="Taškai" styles={styles} value={shownCount(row.totalStops)} />
          <Fact label="Svoris, kg" styles={styles} value={shownDecimal(row.totalWeightKg)} />
          <Fact label="Kilometrai" styles={styles} value={kmText(row)} />
          <Fact label="Pastabos" styles={styles} value={noteText(row, corrections)} />
          {row.source === 'empty'
            ? <AppButton label="Pridėti" onPress={() => onCreate(date)} variant="secondary" />
            : row.canEdit
              ? <AppButton label="Taisyti" onPress={() => onEdit(row)} testID={`month-summary-edit-${row.key}`} variant="secondary" />
              : <Text style={styles.meta}>Tik peržiūra</Text>}
        </View>;
      })}
    </View>)}
  </View>;
}

function Fact({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.fact}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue}>{value}</Text>
  </View>;
}

function EditorModal({ visible, mode, phase, draft, editingRow, review, people, vehicles, saving, showErrors, sheetMaxHeight, styles, onChange, onClose, onReview, onBack, onConfirm }: {
  visible: boolean;
  mode: 'create' | 'edit' | null;
  phase: 'form' | 'confirm';
  draft: MonthSummaryDraft | null;
  editingRow: MonthSummaryRow | null;
  review: MonthSummaryReview | null;
  people: readonly EmployeeProfile[];
  vehicles: readonly ServerFleetVehicle[];
  saving: boolean;
  showErrors: boolean;
  sheetMaxHeight: number;
  styles: ReturnType<typeof createStyles>;
  onChange: (draft: MonthSummaryDraft) => void;
  onClose: () => void;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  if (!draft || !mode) return null;
  const patch = (partial: Partial<MonthSummaryDraft>) => onChange({ ...draft, ...partial });
  const driverOptions = people.map((user) => ({ id: user.id, primary: user.displayName, secondary: user.role === 'admin' ? 'Administratorius' : undefined }));
  const vehicleOptions = vehicles.map((vehicle) => ({ id: vehicle.id, primary: vehicle.registrationNumber, secondary: vehicle.model }));
  const canDriver = mode === 'create' || Boolean(editingRow?.canEditDriver);
  const canVehicle = mode === 'create' || Boolean(editingRow?.canEditVehicle);
  const canDate = mode === 'create' || Boolean(editingRow?.canEditDate);
  const canMetrics = mode === 'create' || Boolean(editingRow?.canEditMetrics);
  const canOdometer = mode === 'create' || Boolean(editingRow?.canEditOdometer);
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
    <View style={styles.modalBackdrop}>
      <ScrollView contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled" style={[styles.modalScroll, { maxHeight: sheetMaxHeight }]}>
        <Text style={styles.modalTitle}>{mode === 'create' ? 'Naujas apskaitos įrašas' : 'Taisyti reisą'}</Text>
        {editingRow ? editingRow.lockNotes.map((note) => <Text key={note} style={styles.meta}>{note}</Text>) : <Text style={styles.meta}>Įrašas bus užbaigtas apskaitos reisas be pristatymo taškų.</Text>}
        {phase === 'form' ? <>
          {canDate ? <View>
            <Text style={styles.label}>Data</Text>
            <DateInput onChangeText={(date) => patch({ date })} style={styles.search} testID="month-summary-edit-date" value={draft.date} />
          </View> : <Fact label="Data" styles={styles} value={draft.date} />}
          {canDriver
            ? <FiroSelect label="Vairuotojas" onChange={(id) => patch({ driverId: id })} options={driverOptions} placeholder="Pasirinkite vairuotoją" value={draft.driverId} />
            : <Fact label="Vairuotojas" styles={styles} value={editingRow ? shownDriver(editingRow) : '—'} />}
          {canVehicle
            ? <FiroSelect label="Automobilis" onChange={(id) => patch({ vehicleId: id })} options={vehicleOptions} placeholder="Pasirinkite automobilį" value={draft.vehicleId} />
            : <Fact label="Automobilis" styles={styles} value={editingRow ? shownVehicle(editingRow) : '—'} />}
          {mode === 'create' ? <AppTextField label="Maršrutas" onChangeText={(routeLabel) => patch({ routeLabel })} placeholder="R15 arba pavadinimas" value={draft.routeLabel} /> : <Fact label="Maršrutas" styles={styles} value={editingRow?.routeLabel ?? '—'} />}
          {canMetrics ? <>
            <AppTextField label="Taškai" keyboardType="number-pad" onChangeText={(totalStops) => patch({ totalStops })} value={draft.totalStops} />
            <AppTextField label="Svoris, kg" keyboardType="decimal-pad" onChangeText={(totalWeightKg) => patch({ totalWeightKg })} value={draft.totalWeightKg} />
          </> : null}
          {canOdometer ? <>
            <AppTextField label="Odometras pradžioje" keyboardType="decimal-pad" onChangeText={(startOdometer) => patch({ startOdometer })} value={draft.startOdometer} />
            <AppTextField label="Odometras pabaigoje" keyboardType="decimal-pad" onChangeText={(endOdometer) => patch({ endOdometer })} value={draft.endOdometer} />
          </> : null}
          {mode === 'create' ? <>
            <AppTextField label="Išvykimas" onChangeText={(startedClock) => patch({ startedClock })} placeholder="HH:MM" value={draft.startedClock} />
            <AppTextField label="Užbaigimas" onChangeText={(completedClock) => patch({ completedClock })} placeholder="HH:MM" value={draft.completedClock} />
          </> : <>
            <Fact label="Išvykimas" styles={styles} value={formatSummaryClock(editingRow?.startedAt ?? null)} />
            <Fact label="Užbaigimas" styles={styles} value={formatSummaryClock(editingRow?.completedAt ?? null)} />
          </>}
          {showErrors && review && !review.ok ? review.errors.map((item) => <Text key={item} style={styles.error}>{item}</Text>) : null}
          <View style={styles.actions}>
            <AppButton label="Atšaukti" onPress={onClose} variant="ghost" />
            <AppButton label="Peržiūrėti" onPress={onReview} />
          </View>
        </> : <>
          {review?.changes.map((change) => <Text key={change.field} style={styles.body}>{`${change.label}: ${change.before || '—'} → ${change.after || '—'}`}</Text>)}
          {review?.effects.map((effect) => <Text key={effect} style={styles.notice}>{effect}</Text>)}
          <View style={styles.actions}>
            <AppButton label="Grįžti" onPress={onBack} variant="secondary" />
            <AppButton disabled={!review?.ok || saving} label="Patvirtinti ir išsaugoti" loading={saving} onPress={onConfirm} />
          </View>
        </>}
      </ScrollView>
    </View>
  </Modal>;
}

function shownDriver(row: MonthSummaryRow): string {
  const name = row.driverName.trim().toLocaleLowerCase('lt');
  if (!row.driverId || row.driverId === 'unassigned' || name === '' || name === 'nepriskirtas' || name === '—') return 'Nepriskirtas';
  return row.driverName;
}

function shownVehicle(row: MonthSummaryRow): string {
  if (!row.vehicleId || row.vehicleLabel === '—') return 'Nepriskirtas';
  return row.registrationNumber ? `${row.vehicleLabel} · ${row.registrationNumber}` : row.vehicleLabel;
}

function shownCount(value: number | null): string {
  return value === null ? '—' : integer.format(value);
}

function shownDecimal(value: number | null): string {
  return value === null ? '—' : decimal.format(value);
}

function kmText(row: MonthSummaryRow): string {
  if (row.source === 'empty' || row.distanceKm === null) return '—';
  const value = decimal.format(row.distanceKm);
  // Planned km are not counted in the total, so only they keep a marker.
  if (row.distanceSource === 'planned') return `${value} (planas)`;
  return value;
}

function isSevere(row: MonthSummaryRow): boolean {
  return row.issues.some((issue) => issue === 'missing-driver' || issue === 'missing-vehicle' || issue === 'driver-mismatch');
}

function noteText(row: MonthSummaryRow, corrections: readonly ServerAdminCorrection[]): string {
  const parts = [row.source === 'empty' ? 'Reiso nėra' : row.issueText, correctionLine(row, corrections)].filter(Boolean);
  return parts.join(' · ') || '—';
}

function correctionLine(row: MonthSummaryRow, corrections: readonly ServerAdminCorrection[]): string {
  const match = corrections.find((item) => item.targetId === row.assignmentId || (row.source === 'odometer-day' && item.targetId === row.readingId));
  if (!match) return '';
  const fields = corrections
    .filter((item) => item.at === match.at && item.targetId === match.targetId)
    .map((item) => CORRECTION_LABELS[item.field] ?? item.field);
  return `${match.actorName} pakeitė: ${[...new Set(fields)].join(', ')} (${formatSummaryDateTime(match.at)})`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'flex-end' },
  filterItem: { width: 220, maxWidth: '100%', flexGrow: 1 },
  filterGrow: { minWidth: 220, flexGrow: 2, flexBasis: 280 },
  label: { ...type.label, color: colors.textMuted, marginBottom: spacing.xs },
  search: { minHeight: layout.minTouchTarget, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  problemToggle: { minHeight: layout.minTouchTarget, minWidth: 160, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  problemToggleOn: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  problemToggleText: { ...type.bodyStrong, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  totals: { ...type.bodyStrong, color: colors.text, marginTop: spacing.md },
  meta: { ...type.secondary, color: colors.textMuted, marginTop: spacing.xs },
  error: { ...type.secondary, color: colors.danger, marginTop: spacing.sm },
  notice: { ...type.secondary, color: colors.text, marginTop: spacing.sm },
  body: { ...type.body, color: colors.text, marginTop: spacing.xs },
  head: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  headCell: { ...type.label, color: colors.textMuted, flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  rowWarning: { borderLeftColor: colors.warning, backgroundColor: colors.warningSoft },
  rowDanger: { borderLeftColor: colors.danger, backgroundColor: colors.dangerSoft },
  cell: { ...type.secondary, color: colors.text, flex: 1, minWidth: 0 },
  actionCell: { width: 108, flexGrow: 0, flexShrink: 0 },
  dayList: { gap: spacing.lg, marginTop: spacing.md },
  daySection: { gap: spacing.sm },
  dayTitle: { ...type.sectionTitle, color: colors.text },
  dayCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderLeftWidth: 3 },
  fact: { gap: 2 },
  factLabel: { ...type.label, color: colors.textMuted },
  factValue: { ...type.body, color: colors.text },
  modalBackdrop: { flex: 1, backgroundColor: colors.primaryDark, justifyContent: 'center', padding: spacing.lg },
  modalScroll: { alignSelf: 'center', width: '100%', maxWidth: 560 },
  modalCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  modalTitle: { ...type.sectionTitle, color: colors.text, fontSize: 20 },
});
