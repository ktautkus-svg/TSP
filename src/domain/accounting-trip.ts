import { odometerDistanceKm } from '@/domain/nll182-odometer-log';
import { normalizeRegionCode, uniqueRegionCodes, type RouteCodeSource } from '@/domain/route-code';
import { lithuanianDateTimeToIso } from '@/domain/lithuanian-time';

const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type FieldChange = {
  field: string;
  before: string;
  after: string;
};

export type CorrectionFact = {
  driver: string;
  vehicle: string;
  date: string;
  totalStops: string;
  totalWeightKg: string;
  startOdometer: string;
  endOdometer: string;
  startedAt: string;
  completedAt: string;
};

export type AccountingIdentity = {
  id: string;
  status: string;
  driverId: string;
  vehicleId: string | null;
  date: string;
  routeLabel: string;
};

const CORRECTION_FIELDS: (keyof CorrectionFact)[] = [
  'driver',
  'vehicle',
  'date',
  'totalStops',
  'totalWeightKg',
  'startOdometer',
  'endOdometer',
  'startedAt',
  'completedAt',
];

export function isIsoDate(value: string): boolean {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized;
}

export function monthDates(year: number, month: number): string[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = String(month).padStart(2, '0');
  return Array.from({ length: count }, (_, index) => `${year}-${monthText}-${String(index + 1).padStart(2, '0')}`);
}

export function parseStopCountInput(value: string): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: 'Taškų skaičius turi būti sveikas skaičius nuo 0.' };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
    return { ok: false, message: 'Taškų skaičius turi būti nuo 0 iki 100000.' };
  }
  return { ok: true, value: parsed };
}

export function parseWeightInput(value: string): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = parseDecimal(value);
  if (parsed === null) return { ok: false, message: 'Svoris turi būti skaičius nuo 0. Dešimtainį skirtuką galima rašyti kableliu.' };
  if (parsed < 0 || parsed > 1_000_000) return { ok: false, message: 'Svoris turi būti nuo 0 iki 1000000 kg.' };
  return { ok: true, value: Math.round(parsed * 10) / 10 };
}

export function parseOdometerPairInput(
  start: string,
  end: string,
): { ok: true; start: number | null; end: number | null; distanceKm: number | null } | { ok: false; message: string } {
  const startText = start.trim();
  const endText = end.trim();
  if (!startText && !endText) return { ok: true, start: null, end: null, distanceKm: null };
  if (!startText || !endText) return { ok: false, message: 'Įveskite ir pradžios, ir pabaigos odometrą, arba abu palikite tuščius.' };
  const startValue = parseDecimal(startText);
  const endValue = parseDecimal(endText);
  if (startValue === null || endValue === null) return { ok: false, message: 'Odometras turi būti skaičius. Dešimtainį skirtuką galima rašyti kableliu.' };
  if (startValue < 0 || endValue < 0 || startValue > 10_000_000 || endValue > 10_000_000) {
    return { ok: false, message: 'Odometras turi būti nuo 0 iki 10000000.' };
  }
  const startRounded = Math.round(startValue * 10) / 10;
  const endRounded = Math.round(endValue * 10) / 10;
  if (endRounded < startRounded) return { ok: false, message: 'Odometras pabaigoje negali būti mažesnis už pradžią.' };
  return { ok: true, start: startRounded, end: endRounded, distanceKm: odometerDistanceKm(startRounded, endRounded) };
}

export function validateAccountingMetrics(
  totalStops: number,
  totalWeightKg: number,
): { ok: true; totalStops: number; totalWeightKg: number } | { ok: false; message: string } {
  if (!Number.isInteger(totalStops) || totalStops < 0 || totalStops > 100_000) {
    return { ok: false, message: 'Neteisingas taškų skaičius.' };
  }
  if (!Number.isFinite(totalWeightKg) || totalWeightKg < 0 || totalWeightKg > 1_000_000) {
    return { ok: false, message: 'Neteisingas svoris.' };
  }
  return { ok: true, totalStops, totalWeightKg: Math.round(totalWeightKg * 10) / 10 };
}

export function validateAccountingOdometers(
  start: number | null,
  end: number | null,
): { ok: true; start: number | null; end: number | null; distanceKm: number | null } | { ok: false; message: string } {
  if (start === null && end === null) return { ok: true, start: null, end: null, distanceKm: null };
  if (start === null || end === null) return { ok: false, message: 'Reikia abiejų odometro rodmenų.' };
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || start > 10_000_000 || end > 10_000_000) {
    return { ok: false, message: 'Neteisingas odometro rodmuo.' };
  }
  if (end < start) return { ok: false, message: 'Odometras pabaigoje negali būti mažesnis už pradžią.' };
  const startRounded = Math.round(start * 10) / 10;
  const endRounded = Math.round(end * 10) / 10;
  return { ok: true, start: startRounded, end: endRounded, distanceKm: odometerDistanceKm(startRounded, endRounded) };
}

export function resolveAccountingClocks(input: {
  date: string;
  startedClock: string;
  completedClock: string;
  nowIso: string;
}): { ok: true; startedAt: string | null; completedAt: string | null } | { ok: false; message: string } {
  const started = input.startedClock.trim();
  const completed = input.completedClock.trim();
  if (!started && !completed) return { ok: true, startedAt: null, completedAt: null };
  if (!started || !completed) {
    return { ok: false, message: 'Nurodykite ir išvykimo, ir užbaigimo laiką, arba abu palikite tuščius.' };
  }
  const startedAt = lithuanianDateTimeToIso(input.date, started);
  const completedAt = lithuanianDateTimeToIso(input.date, completed);
  if (!startedAt || !completedAt) return { ok: false, message: 'Laikas turi būti HH:MM ir priklausyti pasirinktai datai.' };
  const nowMs = Date.parse(input.nowIso);
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (startedMs > completedMs) return { ok: false, message: 'Išvykimas negali būti vėlesnis už užbaigimą.' };
  if (completedMs > nowMs + FUTURE_TOLERANCE_MS || startedMs > nowMs + FUTURE_TOLERANCE_MS) {
    return { ok: false, message: 'Išvykimo ir užbaigimo laikas negali būti ateityje.' };
  }
  return { ok: true, startedAt, completedAt };
}

export function accountingRouteLabel(input: {
  shipmentLines?: readonly RouteCodeSource[];
  accountingRouteLabel?: unknown;
  startAddress?: string | null;
  endAddress?: string | null;
}): string {
  const codes = uniqueRegionCodes(input.shipmentLines ?? []);
  if (codes.length > 0) return codes.join(', ');
  if (typeof input.accountingRouteLabel === 'string' && input.accountingRouteLabel.trim()) {
    return input.accountingRouteLabel.trim();
  }
  if (input.startAddress === 'GPS odometras') return 'Odometro diena';
  if (input.startAddress === 'Kuro pylimas') return 'Kuro įrašas';
  const start = input.startAddress?.trim() ?? '';
  const end = input.endAddress?.trim() ?? '';
  if (start && end && start !== 'Pradžia' && end !== 'Pabaiga') return `${start} → ${end}`;
  return '';
}

export function displayAccountingRouteLabel(label: string, routeId: string | null): string {
  if (label.trim()) return label.trim();
  const readable = readableRouteId(routeId);
  return readable ?? 'Nenurodytas';
}

export function normalizeAccountingRouteLabel(value: string): string {
  return value.trim().toLocaleLowerCase('lt').replace(/\s+/g, ' ');
}

export function accountingIdentityKey(identity: Pick<AccountingIdentity, 'driverId' | 'vehicleId' | 'date' | 'routeLabel'>): string {
  return [
    identity.driverId,
    identity.vehicleId ?? '',
    identity.date,
    normalizeAccountingRouteLabel(identity.routeLabel),
  ].join('|');
}

export function findAccountingDuplicate(
  existing: readonly AccountingIdentity[],
  candidate: AccountingIdentity,
): AccountingIdentity | null {
  if (candidate.status === 'cancelled') return null;
  const key = accountingIdentityKey(candidate);
  return existing.find((item) => item.id !== candidate.id && item.status !== 'cancelled' && accountingIdentityKey(item) === key) ?? null;
}

export function assignmentCorrectionFact(assignment: {
  driverId: string;
  driverName: string;
  vehicle: { registrationNumber: string } | null;
  routeSnapshot: { route: Record<string, unknown> };
}): CorrectionFact {
  const route = assignment.routeSnapshot.route;
  return {
    driver: assignment.driverName.trim() || assignment.driverId,
    vehicle: assignment.vehicle?.registrationNumber ?? '',
    date: textFact(route.date),
    totalStops: textFact(route.total_stops),
    totalWeightKg: textFact(route.total_weight_kg),
    startOdometer: textFact(route.start_odometer),
    endOdometer: textFact(route.end_odometer),
    startedAt: textFact(route.started_at),
    completedAt: textFact(route.completed_at),
  };
}

export function correctionChanges(before: CorrectionFact, after: CorrectionFact): FieldChange[] {
  return CORRECTION_FIELDS
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

export function emptyCorrectionFact(): CorrectionFact {
  return {
    driver: '',
    vehicle: '',
    date: '',
    totalStops: '',
    totalWeightKg: '',
    startOdometer: '',
    endOdometer: '',
    startedAt: '',
    completedAt: '',
  };
}

export function buildCompletedAccountingAssignment<TVehicle extends { id: string; registrationNumber: string }>(input: {
  id: string;
  routeId: string;
  date: string;
  driverId: string;
  driverName: string;
  vehicle: TVehicle;
  routeLabel: string;
  totalStops: number;
  totalWeightKg: number;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  nowIso: string;
}): {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: 'completed';
  routeSnapshot: {
    route: Record<string, unknown>;
    stops: [];
    shipmentLines: { route_code: string }[];
  };
  progress: Record<string, unknown>;
  createdBy: string;
  assignedAt: string;
  updatedAt: string;
  vehicle: TVehicle;
} {
  const label = input.routeLabel.trim();
  const region = normalizeRegionCode(label);
  return {
    id: input.id,
    routeId: input.routeId,
    driverId: input.driverId,
    driverName: input.driverName,
    status: 'completed',
    routeSnapshot: {
      route: {
        id: input.routeId,
        date: input.date,
        status: 'completed',
        origin: 'accounting-summary',
        total_stops: input.totalStops,
        total_weight_kg: input.totalWeightKg,
        remaining_stops: 0,
        remaining_weight_kg: 0,
        estimated_distance_km: input.distanceKm,
        actual_distance_km: input.distanceKm,
        start_odometer: input.startOdometer,
        end_odometer: input.endOdometer,
        started_at: input.startedAt,
        completed_at: input.completedAt,
        ...(label ? { accounting_route_label: label } : {}),
        created_at: input.nowIso,
        updated_at: input.nowIso,
      },
      stops: [],
      shipmentLines: region ? [{ route_code: region }] : [],
    },
    progress: {
      routeStatus: 'completed',
      totalStops: input.totalStops,
      remainingStops: 0,
      remainingWeightKg: 0,
      lastSyncedAt: input.nowIso,
    },
    createdBy: input.createdBy,
    assignedAt: input.nowIso,
    updatedAt: input.nowIso,
    vehicle: input.vehicle,
  };
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function textFact(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function readableRouteId(routeId: string | null): string | null {
  if (!routeId) return null;
  if (routeId.startsWith('vehicle-day-') || routeId.startsWith('accounting-')) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeId)) return null;
  return routeId;
}
