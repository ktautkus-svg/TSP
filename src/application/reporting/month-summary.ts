import { lithuanianDateKey } from '@/domain/lithuanian-time';
import { parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import {
  accountingRouteLabel,
  displayAccountingRouteLabel,
  findAccountingDuplicate,
  isIsoDate,
  monthDates,
  parseOdometerPairInput,
  parseStopCountInput,
  parseWeightInput,
  resolveAccountingClocks,
  type AccountingIdentity,
} from '@/domain/accounting-trip';

export type MonthSummarySource = 'assignment' | 'odometer-day' | 'fuel-day' | 'sheet-only' | 'empty';

export type MonthSummaryIssue =
  | 'missing-driver'
  | 'missing-vehicle'
  | 'missing-plate'
  | 'missing-km'
  | 'missing-times'
  | 'missing-stops'
  | 'driver-mismatch';

export const MONTH_SUMMARY_ISSUE_LABELS: Record<MonthSummaryIssue, string> = {
  'missing-driver': 'Nėra vairuotojo',
  'missing-vehicle': 'Nėra automobilio',
  'missing-plate': 'Nėra valstybinio numerio',
  'missing-km': 'Nėra kilometrų',
  'missing-times': 'Nėra išvykimo arba užbaigimo laiko',
  'missing-stops': 'Nėra taškų',
  'driver-mismatch': 'Priskyrimo ir kelionės lapo vairuotojai skiriasi',
};

export type MonthSummaryDistanceSource = 'odometer' | 'actual' | 'planned' | 'missing';

export type MonthSummaryRow = {
  key: string;
  date: string;
  source: MonthSummarySource;
  assignmentId: string | null;
  readingId: string | null;
  routeId: string | null;
  driverId: string | null;
  driverName: string;
  vehicleId: string | null;
  vehicleLabel: string;
  registrationNumber: string;
  routeLabel: string;
  status: string;
  statusLabel: string;
  totalStops: number | null;
  totalWeightKg: number | null;
  distanceKm: number | null;
  distanceSource: MonthSummaryDistanceSource;
  startOdometer: number | null;
  endOdometer: number | null;
  startedAt: string | null;
  completedAt: string | null;
  issues: MonthSummaryIssue[];
  issueText: string;
  canEditDriver: boolean;
  canEditVehicle: boolean;
  canEditDate: boolean;
  canEditMetrics: boolean;
  canEditOdometer: boolean;
  canEdit: boolean;
  sharesVehicleDay: boolean;
  lockNotes: string[];
};

export type MonthSummaryAssignment = {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: 'assigned' | 'downloaded' | 'in_progress' | 'completed' | 'cancelled';
  assignedAt: string;
  vehicle: { id: string; registrationNumber: string; model: string } | null;
  routeSnapshot: {
    route: Record<string, unknown>;
    stops: Record<string, unknown>[];
    shipmentLines: Record<string, unknown>[];
  };
};

export type MonthSummarySheet = {
  assignmentId: string;
  routeId: string;
  routeNumbers: string[];
  status: MonthSummaryAssignment['status'];
  date: string;
  driverId: string;
  driverName: string;
  vehicle: { id: string; registrationNumber: string; model: string } | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  startedAt: string | null;
  completedAt: string | null;
  totalStops: number;
  totalWeightKg: number;
  startAddress: string;
  endAddress: string;
};

export type MonthSummaryFilter = {
  query: string;
  driverId: string;
  vehicleId: string;
  plate: string;
  date: string;
  problemsOnly: boolean;
};

export type MonthSummaryDraft = {
  driverId: string;
  vehicleId: string;
  date: string;
  routeLabel: string;
  totalStops: string;
  totalWeightKg: string;
  startOdometer: string;
  endOdometer: string;
  startedClock: string;
  completedClock: string;
};

export type MonthSummaryChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type MonthSummarySaveRequest =
  | { kind: 'assignment'; assignmentId: string; body: Record<string, string | number> }
  | { kind: 'trip-sheet'; assignmentId: string; body: Record<string, string | number> }
  | { kind: 'work-date'; assignmentId: string; date: string }
  | { kind: 'day-reading'; body: { vehicleId: string; date: string; startOdometer: number; endOdometer: number; driverId: string | null } }
  | { kind: 'move-reading'; body: { fromVehicleId: string; fromDate: string; toVehicleId: string; toDate: string; startOdometer: number; endOdometer: number; driverId: string | null } }
  | { kind: 'create'; body: { date: string; driverId: string; vehicleId: string; routeLabel: string; totalStops: number; totalWeightKg: number; startOdometer: number | null; endOdometer: number | null; startedClock: string; completedClock: string } };

export type MonthSummaryReview = {
  ok: boolean;
  errors: string[];
  changes: MonthSummaryChange[];
  effects: string[];
  requests: MonthSummarySaveRequest[];
};

const FIELD_LABELS: Record<string, string> = {
  driver: 'Vairuotojas',
  vehicle: 'Automobilis',
  date: 'Data',
  routeLabel: 'Maršrutas',
  totalStops: 'Taškai',
  totalWeightKg: 'Svoris, kg',
  startOdometer: 'Odometras pradžioje',
  endOdometer: 'Odometras pabaigoje',
  startedClock: 'Išvykimas',
  completedClock: 'Užbaigimas',
};

const WAGE_EFFECT = 'Atlygis bus perskaičiuotas pagal pakeistus vairuotojo, kilometrų, taškų ar svorio duomenis. Skaičiavimo taisyklės nesikeičia.';
const STOP_EFFECT = 'Bus pakeisti tik suvestiniai taškų ir svorio skaičiai. Jau užbaigtų pristatymų būsenos ir jų laikai lieka.';
const FUEL_EFFECT = 'Su šiuo reisu susieti kuro įrašai bus perkelti paskui naują vairuotoją arba automobilį.';
const SHARED_ODOMETER_EFFECT = 'Šios dienos odometras yra bendras šiam automobiliui. Jei tą dieną yra keli reisai, jų rodomi kilometrai seks paskui šį rodmenį.';
const DATE_EFFECT = 'Kelionės diena ataskaitose persikels. Pristatymų būsenos ir pristatymo laikai nesikeičia. Atlygis bus priskirtas naujai dienai.';
const READING_DATE_EFFECT = 'Jei odometro įrašas priklauso tik šiam reisui, jis persikels kartu. Jei tą dieną yra daugiau reisų, odometro diena liks senoje datoje.';
const ODOMETER_FUEL_EFFECT = 'Kuro įrašai su šia odometro diena neperkeliami. Jei pylimas buvo kitame automobilyje, jį pataisykite kuro skiltyje.';

export function buildMonthSummary(input: {
  year: number;
  month: number;
  assignments: readonly MonthSummaryAssignment[];
  tripSheets: readonly MonthSummarySheet[];
}): { monthKey: string; days: string[]; rows: MonthSummaryRow[] } {
  const days = monthDates(input.year, input.month);
  const monthKey = `${input.year}-${String(input.month).padStart(2, '0')}`;
  const daySet = new Set(days);
  const sheetsByAssignment = new Map(input.tripSheets.map((sheet) => [sheet.assignmentId, sheet]));
  const assignmentIds = new Set(input.assignments.map((assignment) => assignment.id));
  const rows: MonthSummaryRow[] = [];

  for (const assignment of input.assignments) {
    const sheet = sheetsByAssignment.get(assignment.id) ?? null;
    const date = sheet?.date ?? assignmentWorkDate(assignment);
    if (!daySet.has(date)) continue;
    rows.push(buildAssignmentRow(assignment, sheet, date));
  }

  for (const sheet of input.tripSheets) {
    if (!daySet.has(sheet.date) || assignmentIds.has(sheet.assignmentId)) continue;
    const parsed = parseVehicleDayAssignmentId(sheet.assignmentId);
    if (parsed && sheet.startAddress === 'Kuro pylimas') rows.push(buildSyntheticRow(sheet, 'fuel-day'));
    else if (parsed) rows.push(buildSyntheticRow(sheet, 'odometer-day'));
    else rows.push(buildSyntheticRow(sheet, 'sheet-only'));
  }

  const vehicleDayCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.vehicleId || row.source === 'fuel-day' || row.status === 'cancelled') continue;
    const key = `${row.vehicleId}:${row.date}`;
    vehicleDayCounts.set(key, (vehicleDayCounts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.vehicleId && (vehicleDayCounts.get(`${row.vehicleId}:${row.date}`) ?? 0) > 1) row.sharesVehicleDay = true;
  }

  const covered = new Set(rows.map((row) => row.date));
  for (const day of days) {
    if (!covered.has(day)) rows.push(buildEmptyRow(day));
  }

  rows.sort((left, right) => left.date.localeCompare(right.date)
    || Number(left.source === 'empty') - Number(right.source === 'empty')
    || left.driverName.localeCompare(right.driverName, 'lt')
    || left.registrationNumber.localeCompare(right.registrationNumber, 'lt')
    || left.routeLabel.localeCompare(right.routeLabel, 'lt'));
  return { monthKey, days, rows };
}

export function filterMonthSummaryRows(rows: readonly MonthSummaryRow[], filter: MonthSummaryFilter): MonthSummaryRow[] {
  const query = filter.query.trim().toLocaleLowerCase('lt');
  const narrowing = Boolean(query)
    || filter.driverId !== 'all'
    || filter.vehicleId !== 'all'
    || filter.plate !== 'all'
    || Boolean(filter.date)
    || filter.problemsOnly;
  return rows.filter((row) => {
    if (row.source === 'empty' && narrowing) return false;
    if (filter.problemsOnly && row.issues.length === 0) return false;
    if (filter.driverId !== 'all' && row.driverId !== filter.driverId) return false;
    if (filter.vehicleId !== 'all' && row.vehicleId !== filter.vehicleId) return false;
    if (filter.plate !== 'all' && row.registrationNumber !== filter.plate) return false;
    if (filter.date && row.date !== filter.date) return false;
    if (!query) return true;
    const haystack = [
      row.date,
      row.driverName,
      row.vehicleLabel,
      row.registrationNumber,
      row.routeLabel,
      row.statusLabel,
      row.issueText,
    ].join(' ').toLocaleLowerCase('lt');
    return haystack.includes(query);
  });
}

export function summarizeMonthRows(rows: readonly MonthSummaryRow[]): {
  trips: number;
  stops: number;
  weightKg: number;
  distanceKm: number;
  problemRows: number;
  plannedOnlyRows: number;
} {
  const trips = rows.filter((row) => row.source !== 'empty');
  return {
    trips: trips.length,
    stops: trips.reduce((sum, row) => sum + (row.totalStops ?? 0), 0),
    weightKg: round1(trips.reduce((sum, row) => sum + (row.totalWeightKg ?? 0), 0)),
    distanceKm: round1(trips.reduce((sum, row) => sum + (row.distanceSource === 'odometer' || row.distanceSource === 'actual' ? row.distanceKm ?? 0 : 0), 0)),
    problemRows: rows.filter((row) => row.issues.length > 0).length,
    plannedOnlyRows: trips.filter((row) => row.distanceSource === 'planned').length,
  };
}

export function draftFromRow(row: MonthSummaryRow): MonthSummaryDraft {
  return {
    driverId: row.driverId && row.driverId !== 'unassigned' ? row.driverId : '',
    vehicleId: row.vehicleId ?? '',
    date: row.date,
    routeLabel: editableRouteLabel(row.routeLabel),
    totalStops: row.totalStops === null ? '' : String(row.totalStops),
    totalWeightKg: formatDraftNumber(row.totalWeightKg),
    startOdometer: formatDraftNumber(row.startOdometer),
    endOdometer: formatDraftNumber(row.endOdometer),
    startedClock: '',
    completedClock: '',
  };
}

export function emptyDraft(date: string): MonthSummaryDraft {
  return {
    driverId: '',
    vehicleId: '',
    date,
    routeLabel: '',
    totalStops: '',
    totalWeightKg: '',
    startOdometer: '',
    endOdometer: '',
    startedClock: '',
    completedClock: '',
  };
}

export function reviewMonthSummaryEdit(
  row: MonthSummaryRow,
  draft: MonthSummaryDraft,
  rows: readonly MonthSummaryRow[],
  names: { driverName: (id: string) => string; vehicleName: (id: string) => string },
): MonthSummaryReview {
  if (!row.canEdit) return blocked('Šio įrašo čia redaguoti negalima.');
  const errors: string[] = [];
  if (!isIsoDate(draft.date)) errors.push('Data turi būti parinkta kalendoriuje.');
  if (row.canEditMetrics) {
    if (!draft.totalStops.trim() || !draft.totalWeightKg.trim()) errors.push('Įveskite taškų skaičių ir svorį. Jei jų nebuvo, įrašykite 0.');
  }
  const stops = row.canEditMetrics ? parseStopCountInput(draft.totalStops) : null;
  const weight = row.canEditMetrics ? parseWeightInput(draft.totalWeightKg) : null;
  if (stops && !stops.ok) errors.push(stops.message);
  if (weight && !weight.ok) errors.push(weight.message);
  const odometer = row.canEditOdometer ? parseOdometerPairInput(draft.startOdometer, draft.endOdometer) : null;
  if (odometer && !odometer.ok) errors.push(odometer.message);
  if (row.canEditOdometer && odometer && odometer.ok && odometer.start === null && (row.startOdometer !== null || row.endOdometer !== null)) {
    errors.push('Jau įrašyto odometro ištrinti negalima. Pataisykite abu rodmenis.');
  }
  if (row.source === 'odometer-day' && odometer && odometer.ok && odometer.start === null) {
    errors.push('Odometro dienai reikia pradžios ir pabaigos rodmenų.');
  }
  if (row.canEditDriver && row.driverId && row.driverId !== 'unassigned' && !draft.driverId) {
    errors.push('Vairuotojo ištrinti negalima. Pasirinkite kitą vairuotoją.');
  }
  if (row.canEditVehicle && row.vehicleId && !draft.vehicleId) {
    errors.push('Automobilio ištrinti negalima. Pasirinkite kitą automobilį.');
  }
  if (errors.length > 0) return { ok: false, errors, changes: [], effects: [], requests: [] };

  const nextDriverId = draft.driverId || null;
  const nextVehicleId = draft.vehicleId || null;
  const currentDriverId = row.driverId && row.driverId !== 'unassigned' ? row.driverId : null;
  const changes: MonthSummaryChange[] = [];
  if (row.canEditDate && draft.date !== row.date) pushChange(changes, 'date', row.date, draft.date);
  if (row.canEditDriver && nextDriverId !== currentDriverId) {
    pushChange(changes, 'driver', displayDriver(row), names.driverName(draft.driverId) || 'Nepriskirtas');
  }
  if (row.canEditVehicle && nextVehicleId !== row.vehicleId) {
    pushChange(changes, 'vehicle', displayVehicle(row), names.vehicleName(draft.vehicleId) || 'Nepriskirtas');
  }
  if (stops && stops.ok && stops.value !== row.totalStops) pushChange(changes, 'totalStops', numberText(row.totalStops), String(stops.value));
  if (weight && weight.ok && weight.value !== row.totalWeightKg) pushChange(changes, 'totalWeightKg', numberText(row.totalWeightKg), String(weight.value));
  if (odometer && odometer.ok && (odometer.start !== row.startOdometer || odometer.end !== row.endOdometer)) {
    pushChange(changes, 'startOdometer', numberText(row.startOdometer), numberText(odometer.start));
    pushChange(changes, 'endOdometer', numberText(row.endOdometer), numberText(odometer.end));
  }
  if (changes.length === 0) return blocked('Nėra ką išsaugoti.');

  const duplicate = duplicateOfEdit(row, draft, rows, nextDriverId, nextVehicleId);
  if (duplicate) return blocked(`Toks reisas jau yra ${duplicate.date}. Dublis nebus kuriamas.`);

  const requests = saveRequests(row, draft, {
    stops: stops && stops.ok ? stops.value : null,
    weight: weight && weight.ok ? weight.value : null,
    odometer: odometer && odometer.ok ? odometer : null,
    driverChanged: changes.some((change) => change.field === 'driver'),
    vehicleChanged: changes.some((change) => change.field === 'vehicle'),
    dateChanged: changes.some((change) => change.field === 'date'),
    stopsChanged: changes.some((change) => change.field === 'totalStops'),
    weightChanged: changes.some((change) => change.field === 'totalWeightKg'),
    odometerChanged: changes.some((change) => change.field === 'startOdometer' || change.field === 'endOdometer'),
  });
  return { ok: true, errors: [], changes, effects: editEffects(row, changes), requests };
}

export function reviewMonthSummaryCreate(
  draft: MonthSummaryDraft,
  rows: readonly MonthSummaryRow[],
  names: { driverName: (id: string) => string; vehicleName: (id: string) => string },
  nowIso: string,
): MonthSummaryReview {
  const errors: string[] = [];
  if (!isIsoDate(draft.date)) errors.push('Data turi būti parinkta kalendoriuje.');
  if (!draft.driverId) errors.push('Pasirinkite vairuotoją.');
  if (!draft.vehicleId) errors.push('Pasirinkite automobilį.');
  if (!draft.totalStops.trim() || !draft.totalWeightKg.trim()) errors.push('Įveskite taškų skaičių ir svorį. Jei jų nebuvo, įrašykite 0.');
  const stops = draft.totalStops.trim() ? parseStopCountInput(draft.totalStops) : null;
  const weight = draft.totalWeightKg.trim() ? parseWeightInput(draft.totalWeightKg) : null;
  const odometer = parseOdometerPairInput(draft.startOdometer, draft.endOdometer);
  if (stops && !stops.ok) errors.push(stops.message);
  if (weight && !weight.ok) errors.push(weight.message);
  if (!odometer.ok) errors.push(odometer.message);
  const clocks = isIsoDate(draft.date)
    ? resolveAccountingClocks({ date: draft.date, startedClock: draft.startedClock, completedClock: draft.completedClock, nowIso })
    : { ok: true as const, startedAt: null, completedAt: null };
  if (!clocks.ok) errors.push(clocks.message);
  if (errors.length > 0 || !stops || !stops.ok || !weight || !weight.ok || !odometer.ok || !clocks.ok) {
    return { ok: false, errors, changes: [], effects: [], requests: [] };
  }
  const routeLabel = draft.routeLabel.trim();
  const candidate: AccountingIdentity = {
    id: 'new-accounting-trip',
    status: 'completed',
    driverId: draft.driverId,
    vehicleId: draft.vehicleId,
    date: draft.date,
    routeLabel: routeLabel || 'Nenurodytas',
  };
  const duplicate = findAccountingDuplicate(rows.flatMap(rowIdentity), candidate);
  if (duplicate) return blocked(`Toks reisas jau yra ${duplicate.date}. Dublis nebus kuriamas.`);
  const changes: MonthSummaryChange[] = [
    change('date', '—', draft.date),
    change('driver', '—', names.driverName(draft.driverId) || draft.driverId),
    change('vehicle', '—', names.vehicleName(draft.vehicleId) || draft.vehicleId),
    change('routeLabel', '—', routeLabel || 'Nenurodytas'),
    change('totalStops', '—', String(stops.value)),
    change('totalWeightKg', '—', String(weight.value)),
  ];
  if (odometer.start !== null && odometer.end !== null) {
    changes.push(change('startOdometer', '—', String(odometer.start)), change('endOdometer', '—', String(odometer.end)));
  }
  if (draft.startedClock.trim()) changes.push(change('startedClock', '—', draft.startedClock.trim()), change('completedClock', '—', draft.completedClock.trim()));
  const effects = [
    'Bus sukurtas užbaigtas apskaitos įrašas be pristatymo taškų. Vairuotojo darbų eilė ir maršruto optimizavimas nesikeičia.',
    WAGE_EFFECT,
    STOP_EFFECT,
  ];
  if (rows.some((row) => row.vehicleId === draft.vehicleId && row.date === draft.date && row.source === 'odometer-day')) {
    effects.push('Šiai automobilio dienai jau yra odometro įrašas. Naujo reiso kilometrus ir vairuotoją ataskaitoje gali uždengti tas rodmuo.');
  }
  return {
    ok: true,
    errors: [],
    changes,
    effects,
    requests: [{
      kind: 'create',
      body: {
        date: draft.date,
        driverId: draft.driverId,
        vehicleId: draft.vehicleId,
        routeLabel,
        totalStops: stops.value,
        totalWeightKg: weight.value,
        startOdometer: odometer.start,
        endOdometer: odometer.end,
        startedClock: draft.startedClock.trim(),
        completedClock: draft.completedClock.trim(),
      },
    }],
  };
}

export function monthSummaryExportRows(rows: readonly MonthSummaryRow[]): (string | number | null)[][] {
  return rows.map((row) => [
    row.date,
    row.source === 'empty' || isMissingDriver(row.driverId, row.driverName) ? '' : row.driverName,
    row.vehicleId ? row.vehicleLabel : '',
    row.registrationNumber,
    row.source === 'empty' ? '' : row.routeLabel,
    row.statusLabel,
    row.totalStops,
    row.totalWeightKg,
    row.distanceKm,
    distanceSourceLabel(row.distanceSource),
    row.startedAt ? formatSummaryDateTime(row.startedAt) : '',
    row.completedAt ? formatSummaryDateTime(row.completedAt) : '',
    row.source === 'empty' ? 'Reiso nėra' : row.issueText,
  ]);
}

export const MONTH_SUMMARY_EXPORT_HEADERS = [
  'Data',
  'Vairuotojas',
  'Automobilis',
  'Valstybinis numeris',
  'Maršrutas',
  'Būsena',
  'Taškai',
  'Svoris, kg',
  'Kilometrai',
  'Kilometrų šaltinis',
  'Išvykimas',
  'Užbaigimas',
  'Pastabos',
] as const;

export function formatMonthSummaryDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('lt-LT', {
    timeZone: 'Europe/Vilnius',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

export function formatSummaryClock(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('lt-LT', {
    timeZone: 'Europe/Vilnius',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
}

export function formatSummaryDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vilnius',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

export function distanceSourceLabel(source: MonthSummaryDistanceSource): string {
  if (source === 'odometer') return 'Odometras';
  if (source === 'actual') return 'Faktas';
  if (source === 'planned') return 'Planas';
  return 'Nėra';
}

export function assignmentWorkDate(assignment: MonthSummaryAssignment): string {
  const route = assignment.routeSnapshot.route;
  const actual = text(route.started_at) ?? text(route.completed_at);
  const actualDate = actual ? lithuanianDateKey(actual) : null;
  return actualDate ?? text(route.date) ?? assignment.assignedAt.slice(0, 10);
}

function buildAssignmentRow(
  assignment: MonthSummaryAssignment,
  sheet: MonthSummarySheet | null,
  date: string,
): MonthSummaryRow {
  const vehicle = sheet?.vehicle ?? assignment.vehicle;
  const driverId = sheet?.driverId || assignment.driverId || null;
  const driverName = sheet?.driverName || assignment.driverName || '';
  const routeLabel = displayAccountingRouteLabel(accountingRouteLabel({
    shipmentLines: sheet?.routeNumbers.length
      ? sheet.routeNumbers.map((routeCode) => ({ route_code: routeCode }))
      : assignment.routeSnapshot.shipmentLines,
    accountingRouteLabel: assignment.routeSnapshot.route.accounting_route_label,
    startAddress: sheet?.startAddress,
    endAddress: sheet?.endAddress,
  }), assignment.routeId);
  const startOdometer = sheet?.startOdometer ?? numberOrNull(assignment.routeSnapshot.route.start_odometer);
  const endOdometer = sheet?.endOdometer ?? numberOrNull(assignment.routeSnapshot.route.end_odometer);
  const actual = sheet?.actualDistanceKm ?? numberOrNull(assignment.routeSnapshot.route.actual_distance_km);
  const planned = sheet?.plannedDistanceKm ?? numberOrNull(assignment.routeSnapshot.route.estimated_distance_km);
  const distance = describeDistance(actual, planned, startOdometer, endOdometer);
  const totalStops = sheet?.totalStops ?? numberOrNull(assignment.routeSnapshot.route.total_stops) ?? assignment.routeSnapshot.stops.length;
  const totalWeightKg = sheet?.totalWeightKg ?? numberOrNull(assignment.routeSnapshot.route.total_weight_kg) ?? 0;
  const clocks = realClocks(sheet?.startedAt ?? text(assignment.routeSnapshot.route.started_at), sheet?.completedAt ?? text(assignment.routeSnapshot.route.completed_at), 'assignment');
  const issues = assignmentIssues({
    status: assignment.status,
    driverId,
    driverName,
    assignmentDriverId: assignment.driverId,
    sheetDriverId: sheet?.driverId ?? null,
    vehicleId: vehicle?.id ?? null,
    plate: vehicle?.registrationNumber ?? '',
    distanceSource: distance.source,
    startedAt: clocks.startedAt,
    completedAt: clocks.completedAt,
    totalStops,
  });
  return finalizeRow({
    key: `assignment:${assignment.id}`,
    date,
    source: 'assignment',
    assignmentId: assignment.id,
    readingId: vehicle ? `${vehicle.id}:${date}` : null,
    routeId: assignment.routeId,
    driverId,
    driverName: driverName.trim() || 'Nepriskirtas',
    vehicleId: vehicle?.id ?? null,
    vehicleLabel: vehicle?.model?.trim() || 'Nepriskirtas',
    registrationNumber: vehicle?.registrationNumber?.trim() ?? '',
    routeLabel,
    status: assignment.status,
    statusLabel: assignmentStatusLabel(assignment.status),
    totalStops,
    totalWeightKg,
    distanceKm: distance.km,
    distanceSource: distance.source,
    startOdometer,
    endOdometer,
    startedAt: clocks.startedAt,
    completedAt: clocks.completedAt,
    issues,
  });
}

function buildSyntheticRow(sheet: MonthSummarySheet, source: 'odometer-day' | 'fuel-day' | 'sheet-only'): MonthSummaryRow {
  const parsed = parseVehicleDayAssignmentId(sheet.assignmentId);
  const distance = describeDistance(sheet.actualDistanceKm, sheet.plannedDistanceKm, sheet.startOdometer, sheet.endOdometer);
  const clocks = realClocks(sheet.startedAt, sheet.completedAt, source);
  const routeLabel = source === 'odometer-day'
    ? 'Odometro diena'
    : source === 'fuel-day'
      ? 'Kuro įrašas'
      : displayAccountingRouteLabel(sheet.routeNumbers.join(', '), sheet.routeId);
  const issues: MonthSummaryIssue[] = [];
  if (isMissingDriver(sheet.driverId, sheet.driverName)) issues.push('missing-driver');
  if (!sheet.vehicle?.id) issues.push('missing-vehicle');
  else if (!sheet.vehicle.registrationNumber.trim()) issues.push('missing-plate');
  if (distance.source === 'missing') issues.push('missing-km');
  return finalizeRow({
    key: `${source}:${sheet.assignmentId}`,
    date: sheet.date,
    source,
    assignmentId: source === 'sheet-only' ? sheet.assignmentId : null,
    readingId: parsed ? `${parsed.vehicleId}:${parsed.date}` : null,
    routeId: sheet.routeId,
    driverId: sheet.driverId || null,
    driverName: sheet.driverName.trim() || 'Nepriskirtas',
    vehicleId: sheet.vehicle?.id ?? null,
    vehicleLabel: sheet.vehicle?.model?.trim() || 'Nepriskirtas',
    registrationNumber: sheet.vehicle?.registrationNumber?.trim() ?? '',
    routeLabel,
    status: sheet.status,
    statusLabel: source === 'odometer-day' ? 'Odometro diena' : source === 'fuel-day' ? 'Kuro įrašas' : assignmentStatusLabel(sheet.status),
    totalStops: null,
    totalWeightKg: null,
    distanceKm: distance.km,
    distanceSource: distance.source,
    startOdometer: sheet.startOdometer,
    endOdometer: sheet.endOdometer,
    startedAt: clocks.startedAt,
    completedAt: clocks.completedAt,
    issues,
  });
}

function buildEmptyRow(date: string): MonthSummaryRow {
  return finalizeRow({
    key: `empty:${date}`,
    date,
    source: 'empty',
    assignmentId: null,
    readingId: null,
    routeId: null,
    driverId: null,
    driverName: '—',
    vehicleId: null,
    vehicleLabel: '—',
    registrationNumber: '',
    routeLabel: '—',
    status: 'empty',
    statusLabel: 'Reiso nėra',
    totalStops: null,
    totalWeightKg: null,
    distanceKm: null,
    distanceSource: 'missing',
    startOdometer: null,
    endOdometer: null,
    startedAt: null,
    completedAt: null,
    issues: [],
  });
}

function finalizeRow(row: Omit<MonthSummaryRow, 'issueText' | 'canEditDriver' | 'canEditVehicle' | 'canEditDate' | 'canEditMetrics' | 'canEditOdometer' | 'canEdit' | 'sharesVehicleDay' | 'lockNotes'>): MonthSummaryRow {
  const unstarted = row.status === 'assigned' || row.status === 'downloaded';
  const done = row.status === 'completed';
  const assignment = row.source === 'assignment';
  // An odometer day can be moved to another date or vehicle (server: move-reading).
  const odometerDay = row.source === 'odometer-day';
  const canEditDriver = (assignment && (unstarted || done)) || odometerDay;
  const canEditVehicle = canEditDriver;
  const canEditDate = (assignment && (unstarted || done)) || odometerDay;
  const canEditMetrics = assignment && row.status !== 'cancelled';
  const canEditOdometer = (assignment && done && Boolean(row.vehicleId)) || row.source === 'odometer-day';
  const lockNotes: string[] = [];
  if (row.status === 'cancelled') lockNotes.push('Atšauktas reisas neredaguojamas.');
  if (row.status === 'in_progress') lockNotes.push('Vykdomo maršruto vairuotojo, automobilio ir datos čia keisti negalima. Galima pataisyti tik taškų skaičių ir svorį. Pristatymai nekeičiami.');
  if (row.source === 'fuel-day') lockNotes.push('Kuro įrašas nėra reisas. Trūkstamą reisą pridėkite atskiru įrašu.');
  if (row.source === 'sheet-only') lockNotes.push('Šis kelionės lapas nesusietas su maršrutu. Jį galima tik peržiūrėti.');
  if (done && assignment) lockNotes.push('Užbaigtų pristatymų būsenos nekeičiamos. Vairuotojo, automobilio, taškų, svorio ar kilometrų pataisa pakeičia atlygio priskyrimą.');
  if (row.source === 'odometer-day') lockNotes.push('Tai odometro diena, ne pristatymų maršrutas. Galima pakeisti datą, automobilį, vairuotoją ir rodmenis.');
  return {
    ...row,
    issueText: row.issues.map((issue) => MONTH_SUMMARY_ISSUE_LABELS[issue]).join('; '),
    canEditDriver,
    canEditVehicle,
    canEditDate,
    canEditMetrics,
    canEditOdometer,
    canEdit: canEditDriver || canEditVehicle || canEditDate || canEditMetrics || canEditOdometer,
    sharesVehicleDay: false,
    lockNotes,
  };
}

function assignmentIssues(input: {
  status: string;
  driverId: string | null;
  driverName: string;
  assignmentDriverId: string;
  sheetDriverId: string | null;
  vehicleId: string | null;
  plate: string;
  distanceSource: MonthSummaryDistanceSource;
  startedAt: string | null;
  completedAt: string | null;
  totalStops: number | null;
}): MonthSummaryIssue[] {
  const issues: MonthSummaryIssue[] = [];
  if (isMissingDriver(input.driverId, input.driverName)) issues.push('missing-driver');
  if (!input.vehicleId) issues.push('missing-vehicle');
  else if (!input.plate.trim()) issues.push('missing-plate');
  if (input.status === 'completed' && input.distanceSource === 'missing') issues.push('missing-km');
  if (input.status === 'completed' && (!input.startedAt || !input.completedAt)) issues.push('missing-times');
  if (input.status === 'completed' && (input.totalStops === null || input.totalStops === 0)) issues.push('missing-stops');
  if (
    input.sheetDriverId
    && input.assignmentDriverId
    && input.sheetDriverId !== input.assignmentDriverId
    && input.sheetDriverId !== 'unassigned'
  ) issues.push('driver-mismatch');
  return issues;
}

function describeDistance(
  actual: number | null,
  planned: number | null,
  startOdometer: number | null,
  endOdometer: number | null,
): { km: number | null; source: MonthSummaryDistanceSource } {
  if (startOdometer !== null && endOdometer !== null && actual !== null) return { km: actual, source: 'odometer' };
  if (actual !== null) return { km: actual, source: 'actual' };
  if (planned !== null) return { km: planned, source: 'planned' };
  return { km: null, source: 'missing' };
}

function realClocks(
  startedAt: string | null,
  completedAt: string | null,
  source: MonthSummarySource,
): { startedAt: string | null; completedAt: string | null } {
  if (source !== 'assignment') return { startedAt: null, completedAt: null };
  return { startedAt, completedAt };
}

function saveRequests(row: MonthSummaryRow, draft: MonthSummaryDraft, flags: {
  stops: number | null;
  weight: number | null;
  odometer: { start: number | null; end: number | null } | null;
  driverChanged: boolean;
  vehicleChanged: boolean;
  dateChanged: boolean;
  stopsChanged: boolean;
  weightChanged: boolean;
  odometerChanged: boolean;
}): MonthSummarySaveRequest[] {
  const requests: MonthSummarySaveRequest[] = [];
  const unstarted = row.status === 'assigned' || row.status === 'downloaded';
  const done = row.status === 'completed';
  if (row.source === 'assignment' && row.assignmentId && unstarted) {
    const body: Record<string, string | number> = {};
    if (flags.dateChanged) body.date = draft.date;
    if (flags.driverChanged) body.driverId = draft.driverId;
    if (flags.vehicleChanged) body.vehicleId = draft.vehicleId;
    if (flags.stopsChanged && flags.stops !== null) body.totalStops = flags.stops;
    if (flags.weightChanged && flags.weight !== null) body.totalWeightKg = flags.weight;
    requests.push({ kind: 'assignment', assignmentId: row.assignmentId, body });
  }
  if (row.source === 'assignment' && row.assignmentId && done) {
    if (flags.dateChanged) requests.push({ kind: 'work-date', assignmentId: row.assignmentId, date: draft.date });
    const body: Record<string, string | number> = {};
    if (flags.driverChanged) body.driverId = draft.driverId;
    if (flags.vehicleChanged) body.vehicleId = draft.vehicleId;
    const odometer = flags.odometer;
    if (flags.odometerChanged && odometer && odometer.start !== null && odometer.end !== null) {
      body.startOdometer = odometer.start;
      body.endOdometer = odometer.end;
    }
    if (Object.keys(body).length > 0) requests.push({ kind: 'trip-sheet', assignmentId: row.assignmentId, body });
    if ((flags.stopsChanged || flags.weightChanged) && flags.stops !== null && flags.weight !== null) {
      requests.push({ kind: 'assignment', assignmentId: row.assignmentId, body: { totalStops: flags.stops, totalWeightKg: flags.weight } });
    }
  }
  if (row.source === 'assignment' && row.assignmentId && row.status === 'in_progress' && flags.stops !== null && flags.weight !== null) {
    requests.push({ kind: 'assignment', assignmentId: row.assignmentId, body: { totalStops: flags.stops, totalWeightKg: flags.weight } });
  }
  const dayOdometer = flags.odometer;
  if (row.source === 'odometer-day' && row.vehicleId && dayOdometer && dayOdometer.start !== null && dayOdometer.end !== null) {
    const driverId = draft.driverId || null;
    if (flags.vehicleChanged || flags.dateChanged) {
      requests.push({
        kind: 'move-reading',
        body: {
          fromVehicleId: row.vehicleId,
          fromDate: row.date,
          toVehicleId: draft.vehicleId,
          toDate: draft.date,
          startOdometer: dayOdometer.start,
          endOdometer: dayOdometer.end,
          driverId,
        },
      });
    } else {
      requests.push({
        kind: 'day-reading',
        body: {
          vehicleId: row.vehicleId,
          date: row.date,
          startOdometer: dayOdometer.start,
          endOdometer: dayOdometer.end,
          driverId,
        },
      });
    }
  }
  return requests;
}

function editEffects(row: MonthSummaryRow, changes: readonly MonthSummaryChange[]): string[] {
  const fields = new Set(changes.map((item) => item.field));
  const effects: string[] = [];
  const wageFields = fields.has('driver') || fields.has('vehicle') || fields.has('totalStops') || fields.has('totalWeightKg') || fields.has('startOdometer') || fields.has('endOdometer') || fields.has('date');
  if (row.status === 'completed' && wageFields) effects.push(WAGE_EFFECT);
  if (fields.has('totalStops') || fields.has('totalWeightKg')) effects.push(STOP_EFFECT);
  if (row.status === 'completed' && (fields.has('driver') || fields.has('vehicle'))) effects.push(FUEL_EFFECT);
  if ((fields.has('startOdometer') || fields.has('endOdometer')) && row.sharesVehicleDay) effects.push(SHARED_ODOMETER_EFFECT);
  if (fields.has('date') && row.status === 'completed') effects.push(DATE_EFFECT, READING_DATE_EFFECT);
  if (row.source === 'odometer-day' && fields.has('vehicle')) effects.push(ODOMETER_FUEL_EFFECT);
  if ((row.status === 'assigned' || row.status === 'downloaded') && (fields.has('driver') || fields.has('vehicle') || fields.has('date'))) {
    effects.push('Maršrutas dar nepradėtas. Pasikeis priskyrimas. Atlygis iš šio reiso dar neskaičiuojamas.');
  }
  if (row.status === 'in_progress' && (fields.has('totalStops') || fields.has('totalWeightKg'))) {
    effects.push('Taškų ir svorio suvestinė pasikeis. Pristatymai nekeičiami. Atlygis į šiuos skaičius atsižvelgs, kai reisas bus užbaigtas.');
  }
  return effects;
}

function duplicateOfEdit(
  row: MonthSummaryRow,
  draft: MonthSummaryDraft,
  rows: readonly MonthSummaryRow[],
  driverId: string | null,
  vehicleId: string | null,
): MonthSummaryRow | null {
  if (row.source === 'odometer-day' && (draft.date !== row.date || draft.vehicleId !== row.vehicleId)) {
    return rows.find((item) => item.key !== row.key && item.vehicleId === draft.vehicleId && item.date === draft.date && item.source !== 'empty' && item.status !== 'cancelled') ?? null;
  }
  if (row.source !== 'assignment' || !driverId || !vehicleId) return null;
  const candidate: AccountingIdentity = {
    id: row.assignmentId ?? row.key,
    status: row.status,
    driverId,
    vehicleId,
    date: draft.date,
    routeLabel: row.routeLabel,
  };
  const match = findAccountingDuplicate(rows.flatMap(rowIdentity), candidate);
  if (!match) return null;
  return rows.find((item) => item.assignmentId === match.id) ?? null;
}

function rowIdentity(row: MonthSummaryRow): AccountingIdentity[] {
  if (row.source !== 'assignment' || row.status === 'cancelled' || !row.assignmentId || !row.driverId || !row.vehicleId) return [];
  return [{
    id: row.assignmentId,
    status: row.status,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    date: row.date,
    routeLabel: row.routeLabel,
  }];
}

function pushChange(changes: MonthSummaryChange[], field: string, before: string, after: string): void {
  if (before === after) return;
  changes.push(change(field, before, after));
}

function change(field: string, before: string, after: string): MonthSummaryChange {
  return { field, label: FIELD_LABELS[field] ?? field, before, after };
}

function blocked(message: string): MonthSummaryReview {
  return { ok: false, errors: [message], changes: [], effects: [], requests: [] };
}

function assignmentStatusLabel(status: string): string {
  if (status === 'assigned') return 'Priskirtas';
  if (status === 'downloaded') return 'Atsisiųstas';
  if (status === 'in_progress') return 'Vykdomas';
  if (status === 'completed') return 'Užbaigtas';
  if (status === 'cancelled') return 'Atšauktas';
  return status;
}

function isMissingDriver(id: string | null, name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase('lt');
  return !id || id === 'unassigned' || normalized === '' || normalized === 'nepriskirtas' || normalized === '—';
}

function displayDriver(row: MonthSummaryRow): string {
  return isMissingDriver(row.driverId, row.driverName) ? 'Nepriskirtas' : row.driverName;
}

function displayVehicle(row: MonthSummaryRow): string {
  if (!row.vehicleId) return 'Nepriskirtas';
  return row.registrationNumber ? `${row.vehicleLabel} · ${row.registrationNumber}` : row.vehicleLabel;
}

function editableRouteLabel(label: string): string {
  if (label === 'Nenurodytas' || label === 'Odometro diena' || label === 'Kuro įrašas' || label === '—') return '';
  return label;
}

function formatDraftNumber(value: number | null): string {
  if (value === null) return '';
  return String(value).replace('.', ',');
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
