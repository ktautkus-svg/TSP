import { fuelEntryMoneyEur } from '@/application/routes/fuel-entry-money';
import { isFuelOnlyWorkSheet } from '@/domain/fuel-only-workday';
import type { ServerTripSheet } from '@/infrastructure/auth/employee-session';

export type WageColumnKey = 'date' | 'driver' | 'km' | 'kmEur' | 'kg' | 'kgEur' | 'stops' | 'stopsEur' | 'baseEur' | 'extraEur' | 'totalEur' | 'comment';
export type WageColumnFormat = 'text' | 'integer' | 'km' | 'kg' | 'eur';

export type WageColumn = {
  key: WageColumnKey;
  header: string;
  format: WageColumnFormat;
};

const WAGE_VALUE_COLUMNS: readonly WageColumn[] = [
  { key: 'km', header: 'Km', format: 'km' },
  { key: 'kmEur', header: 'Km €', format: 'eur' },
  { key: 'kg', header: 'Svoris, kg', format: 'kg' },
  { key: 'kgEur', header: 'Svoris €', format: 'eur' },
  { key: 'stops', header: 'Taškai', format: 'integer' },
  { key: 'stopsEur', header: 'Taškai €', format: 'eur' },
  { key: 'baseEur', header: 'Bazė €', format: 'eur' },
  { key: 'extraEur', header: 'Papildomai €', format: 'eur' },
  { key: 'totalEur', header: 'Dienos suma €', format: 'eur' },
  { key: 'comment', header: 'Komentaras', format: 'text' },
];

export function wageTableColumns(showDriver: boolean): WageColumn[] {
  return [
    { key: 'date', header: 'Data', format: 'text' },
    ...(showDriver ? [{ key: 'driver' as const, header: 'Vairuotojas', format: 'text' as const }] : []),
    ...WAGE_VALUE_COLUMNS,
  ];
}

export type WageDayFigures = {
  hasCompensation: boolean;
  distanceKm: number;
  distanceAmountEur: number | null;
  weightKg: number;
  weightAmountEur: number | null;
  stops: number;
  stopsAmountEur: number | null;
  fixedAmountEur: number | null;
  wageEur: number | null;
  routeCount: number;
  fuelLiters: number;
  fuelCostEur: number;
  /** Manual bonus for the day ("Papildomai"), already included in `payEur`. */
  extraEur: number;
  comment: string;
  /** Calculated wage plus the manual extra; null only when neither exists. */
  payEur: number | null;
};

/** Manual per-driver, per-day bonus and note kept next to the calculated wage. */
export type WageAdjustment = {
  driverId: string;
  driverName: string;
  date: string;
  amountEur: number;
  comment: string;
};

export type WageDayRow = {
  key: string;
  date: string;
  driverId: string;
  driverName: string;
  /** Stored day total. Zero when the server has not attached compensation yet. */
  wageEur: number;
  preliminary: boolean;
  sheets: ServerTripSheet[];
  figures: WageDayFigures;
  /**
   * The saved wage-adjustments record for this driver+date, if any.
   * Distinct from trip/legacy pay parts in `figures.wageEur` — the editor
   * must read and write only this record, never the aggregated day total.
   */
  manualAdjustment: WageAdjustment | null;
};

export type WagePeriodTotals = {
  routes: number;
  km: number;
  weightKg: number;
  stops: number;
  fuelLiters: number;
  fuelCostEur: number;
  wageEur: number;
  distanceAmountEur: number;
  weightAmountEur: number;
  stopsAmountEur: number;
  fixedAmountEur: number;
  extraEur: number;
  /** Calculated wage plus manual extras. */
  payEur: number;
  /** Fuel cost plus wage. Wage alone is `wageEur`. */
  totalEur: number;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function emptyFigures(): WageDayFigures {
  return {
    hasCompensation: false,
    distanceKm: 0,
    distanceAmountEur: null,
    weightKg: 0,
    weightAmountEur: null,
    stops: 0,
    stopsAmountEur: null,
    fixedAmountEur: null,
    wageEur: null,
    routeCount: 0,
    fuelLiters: 0,
    fuelCostEur: 0,
    extraEur: 0,
    comment: '',
    payEur: null,
  };
}

function dedupeSheets(sheets: readonly ServerTripSheet[]): ServerTripSheet[] {
  const seen = new Set<string>();
  const unique: ServerTripSheet[] = [];
  for (const sheet of sheets) {
    if (seen.has(sheet.id)) continue;
    seen.add(sheet.id);
    unique.push(sheet);
  }
  return unique.sort((left, right) => {
    const route = left.routeNumbers.join(' · ').localeCompare(right.routeNumbers.join(' · '), 'lt');
    return route || left.id.localeCompare(right.id);
  });
}

function measured(sheets: readonly ServerTripSheet[]) {
  return {
    distanceKm: sheets.reduce((sum, sheet) => sum + (sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0), 0),
    weightKg: sheets.reduce((sum, sheet) => sum + sheet.totalWeightKg, 0),
    stops: sheets.reduce((sum, sheet) => sum + sheet.totalStops, 0),
  };
}

/**
 * Compensation is calculated once per driver and workday, then attached by
 * the server to every trip sheet from that day. The report collapses those
 * sheets before rendering or summing. Euro parts are copied from that one
 * breakdown; they are not added again for each route.
 * Days are ordered by the ISO date, oldest first.
 */
export function aggregateWageDays(sheets: readonly ServerTripSheet[], adjustments: readonly WageAdjustment[] = []): WageDayRow[] {
  const days = new Map<string, WageDayRow>();
  const fuelOnlyByDay = new Map<string, ServerTripSheet[]>();
  for (const sheet of sheets) {
    const key = `${sheet.driverId}:${sheet.date}`;
    if (isFuelOnlyWorkSheet(sheet)) {
      fuelOnlyByDay.set(key, [...(fuelOnlyByDay.get(key) ?? []), sheet]);
      continue;
    }
    const current = days.get(key);
    if (current) {
      current.sheets.push(sheet);
      current.preliminary = current.preliminary || Boolean(sheet.compensation?.preliminary);
      continue;
    }
    days.set(key, {
      key,
      date: sheet.date,
      driverId: sheet.driverId,
      driverName: sheet.driverName,
      wageEur: sheet.compensation?.totalNetEur ?? 0,
      preliminary: Boolean(sheet.compensation?.preliminary),
      sheets: [sheet],
      figures: emptyFigures(),
      manualAdjustment: null,
    });
  }
  const countedFuel = new Set<string>();
  for (const day of days.values()) {
    day.sheets = dedupeSheets(day.sheets);
    const payable = day.sheets.filter((sheet) => !isFuelOnlyWorkSheet(sheet));
    const compensation = payable.find((sheet) => sheet.compensation)?.compensation ?? null;
    const fromSheets = measured(payable);
    let fuelLiters = 0;
    let fuelCostEur = 0;
    for (const sheet of [...day.sheets, ...(fuelOnlyByDay.get(day.key) ?? [])]) {
      for (const entry of sheet.fuelEntries) {
        if (countedFuel.has(entry.id)) continue;
        countedFuel.add(entry.id);
        fuelLiters += entry.liters;
        fuelCostEur += fuelEntryMoneyEur(entry) ?? 0;
      }
    }
    day.wageEur = compensation?.totalNetEur ?? 0;
    day.preliminary = day.sheets.some((sheet) => Boolean(sheet.compensation?.preliminary));
    day.figures = {
      hasCompensation: compensation !== null,
      distanceKm: compensation?.distanceKm ?? fromSheets.distanceKm,
      distanceAmountEur: compensation ? compensation.distanceAmountEur : null,
      weightKg: compensation?.weightKg ?? fromSheets.weightKg,
      weightAmountEur: compensation ? compensation.weightAmountEur : null,
      stops: compensation?.stops ?? fromSheets.stops,
      stopsAmountEur: compensation ? compensation.stopsAmountEur : null,
      fixedAmountEur: compensation ? compensation.fixedAmountEur : null,
      wageEur: compensation ? compensation.totalNetEur : null,
      routeCount: payable.length,
      fuelLiters,
      fuelCostEur,
      extraEur: 0,
      comment: '',
      payEur: compensation ? compensation.totalNetEur : null,
    };
  }
  // A bonus can exist on a day without any trip (e.g. an extra Saturday job),
  // so such a day gets its own row.
  for (const adjustment of adjustments) {
    const key = `${adjustment.driverId}:${adjustment.date}`;
    let day = days.get(key);
    if (!day) {
      day = {
        key,
        date: adjustment.date,
        driverId: adjustment.driverId,
        driverName: adjustment.driverName,
        wageEur: 0,
        preliminary: false,
        sheets: [],
        figures: emptyFigures(),
        manualAdjustment: null,
      };
      days.set(key, day);
    }
    // Only the wage-adjustments document counts as a removable manual extra.
    // Trip/legacy compensation stays in wageEur and must not open the editor.
    day.manualAdjustment = {
      driverId: adjustment.driverId,
      driverName: adjustment.driverName,
      date: adjustment.date,
      amountEur: round2(adjustment.amountEur),
      comment: adjustment.comment,
    };
    const extra = day.manualAdjustment.amountEur;
    day.figures.extraEur = extra;
    day.figures.comment = day.manualAdjustment.comment;
    if (extra !== 0 || day.figures.wageEur !== null) day.figures.payEur = round2((day.figures.wageEur ?? 0) + extra);
  }
  return [...days.values()].sort((left, right) =>
    left.date.localeCompare(right.date) || left.driverName.localeCompare(right.driverName, 'lt'));
}

export function summarizeWageDays(days: readonly WageDayRow[]): WagePeriodTotals {
  const totals = {
    routes: 0,
    km: 0,
    weightKg: 0,
    stops: 0,
    fuelLiters: 0,
    fuelCostEur: 0,
    wageEur: 0,
    distanceAmountEur: 0,
    weightAmountEur: 0,
    stopsAmountEur: 0,
    fixedAmountEur: 0,
    extraEur: 0,
  };
  for (const day of days) {
    const figures = day.figures;
    totals.routes += figures.routeCount;
    totals.km += figures.distanceKm;
    totals.weightKg += figures.weightKg;
    totals.stops += figures.stops;
    totals.fuelLiters += figures.fuelLiters;
    totals.fuelCostEur += figures.fuelCostEur;
    totals.extraEur += figures.extraEur;
    if (figures.wageEur !== null) {
      totals.wageEur += figures.wageEur;
      totals.distanceAmountEur += figures.distanceAmountEur ?? 0;
      totals.weightAmountEur += figures.weightAmountEur ?? 0;
      totals.stopsAmountEur += figures.stopsAmountEur ?? 0;
      totals.fixedAmountEur += figures.fixedAmountEur ?? 0;
    }
  }
  return {
    routes: totals.routes,
    km: round2(totals.km),
    weightKg: round2(totals.weightKg),
    stops: totals.stops,
    fuelLiters: round2(totals.fuelLiters),
    fuelCostEur: round2(totals.fuelCostEur),
    wageEur: round2(totals.wageEur),
    distanceAmountEur: round2(totals.distanceAmountEur),
    weightAmountEur: round2(totals.weightAmountEur),
    stopsAmountEur: round2(totals.stopsAmountEur),
    fixedAmountEur: round2(totals.fixedAmountEur),
    extraEur: round2(totals.extraEur),
    payEur: round2(round2(totals.wageEur) + round2(totals.extraEur)),
    totalEur: round2(round2(totals.fuelCostEur) + round2(totals.wageEur) + round2(totals.extraEur)),
  };
}

export function wageDayCell(day: WageDayRow, key: WageColumnKey): string | number | null {
  const figures = day.figures;
  switch (key) {
    case 'date': return day.date;
    case 'driver': return day.driverName;
    case 'km': return figures.distanceKm;
    case 'kmEur': return figures.distanceAmountEur;
    case 'kg': return figures.weightKg;
    case 'kgEur': return figures.weightAmountEur;
    case 'stops': return figures.stops;
    case 'stopsEur': return figures.stopsAmountEur;
    case 'baseEur': return figures.fixedAmountEur;
    case 'extraEur': return figures.extraEur === 0 ? null : figures.extraEur;
    case 'totalEur': return figures.payEur;
    case 'comment': return figures.comment;
    default: return null;
  }
}

export function wageTotalCell(totals: WagePeriodTotals, key: WageColumnKey): string | number | null {
  switch (key) {
    case 'date': return 'Iš viso';
    case 'driver': return '';
    case 'km': return totals.km;
    case 'kmEur': return totals.distanceAmountEur;
    case 'kg': return totals.weightKg;
    case 'kgEur': return totals.weightAmountEur;
    case 'stops': return totals.stops;
    case 'stopsEur': return totals.stopsAmountEur;
    case 'baseEur': return totals.fixedAmountEur;
    case 'extraEur': return totals.extraEur;
    case 'totalEur': return totals.payEur;
    case 'comment': return '';
    default: return null;
  }
}
