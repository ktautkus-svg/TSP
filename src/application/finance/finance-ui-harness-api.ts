/**
 * In-memory employee API for the __DEV__ finance UI harness.
 * Production network / Firestore / credentials are never touched — every
 * response is served from this process-local store.
 */

import type { WageAdjustment } from '@/application/finance/wage-report';
import { DEFAULT_ROUTE_PRICE_SETTINGS, normalizeRoutePriceSettings } from '@/application/routes/route-price';
import type {
  EmployeeApiTestTransport,
  EmployeeProfile,
  ServerFleetVehicle,
  ServerRouteAssignment,
  ServerTripSheet,
} from '@/infrastructure/auth/employee-session';

const NOW = '2026-10-07T08:00:00.000Z';

/** Synthetic saved litre prices: 1,93 €/l from September 2026, like the real entry. */
const HARNESS_ROUTE_PRICE_SETTINGS = normalizeRoutePriceSettings({
  ...DEFAULT_ROUTE_PRICE_SETTINGS,
  fuelPriceByYearMonth: {
    ...DEFAULT_ROUTE_PRICE_SETTINGS.fuelPriceByYearMonth,
    '2026-09': 1.93, '2026-10': 1.93, '2026-11': 1.93, '2026-12': 1.93,
  },
});

const HARNESS_ADMIN: EmployeeProfile = {
  id: 'harness-admin',
  username: 'harness.admin',
  displayName: 'Harness Admin',
  role: 'admin',
  disabled: false,
};

const DRIVERS: EmployeeProfile[] = [
  {
    id: 'driver-1',
    username: 'jonas',
    displayName: 'Jonas',
    role: 'driver',
    disabled: false,
  },
  {
    id: 'driver-2',
    username: 'petras',
    displayName: 'Petras',
    role: 'driver',
    disabled: false,
  },
];

const VEHICLES: ServerFleetVehicle[] = [
  {
    id: 'veh-1',
    registrationNumber: 'DEF456',
    model: 'Crafter',
    maximumPayloadKg: 1200,
    assignedDriverId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'veh-2',
    registrationNumber: 'GHI789',
    model: 'Sprinter',
    maximumPayloadKg: 1400,
    assignedDriverId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

function compensation(totalNetEur: number, distanceKm: number, weightKg: number, stops: number) {
  return {
    rates: { type: 'variable' as const, fixedDailyNetEur: 23, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 },
    distanceKm,
    distanceSource: 'odometer' as const,
    weightKg,
    stops,
    fixedAmountEur: 23,
    distanceAmountEur: Math.round(distanceKm * 0.05 * 100) / 100,
    weightAmountEur: Math.round(weightKg * 0.006 * 100) / 100,
    stopsAmountEur: Math.round(stops * 0.65 * 100) / 100,
    totalNetEur,
    preliminary: false,
  };
}

function sheet(partial: Partial<ServerTripSheet> & Pick<ServerTripSheet, 'id' | 'assignmentId' | 'routeId' | 'date' | 'driverId' | 'driverName'>): ServerTripSheet {
  return {
    routeNumbers: ['R1'],
    status: 'completed',
    vehicle: { id: 'veh-1', registrationNumber: 'DEF456', model: 'Crafter', maximumPayloadKg: 1200 },
    fuelNormLitersPer100Km: 9.5,
    startOdometer: 10_000,
    endOdometer: 10_120,
    actualDistanceKm: 120,
    plannedDistanceKm: null,
    startedAt: `${partial.date}T05:00:00.000Z`,
    completedAt: `${partial.date}T14:00:00.000Z`,
    durationMinutes: 540,
    totalStops: 4,
    deliveredStops: 4,
    totalWeightKg: 200,
    deliveredWeightKg: 200,
    startAddress: 'Sandėlis',
    endAddress: 'Klientas',
    compensation: compensation(32.8, 120, 200, 4),
    fuelEntries: [],
    ...partial,
  };
}

function assignment(partial: {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  date: string;
  routeLabel: string;
  vehicleId?: string;
  stops?: number;
  weightKg?: number;
  distanceKm?: number;
}): ServerRouteAssignment {
  const vehicle = VEHICLES.find((item) => item.id === (partial.vehicleId ?? 'veh-1')) ?? VEHICLES[0]!;
  return {
    id: partial.id,
    routeId: partial.routeId,
    driverId: partial.driverId,
    driverName: partial.driverName,
    status: 'completed',
    assignedAt: `${partial.date}T06:00:00.000Z`,
    updatedAt: NOW,
    progress: null,
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      model: vehicle.model,
      maximumPayloadKg: vehicle.maximumPayloadKg,
    },
    routeSnapshot: {
      route: {
        id: partial.routeId,
        date: partial.date,
        total_stops: partial.stops ?? 1,
        total_weight_kg: partial.weightKg ?? 10,
        actual_distance_km: partial.distanceKm ?? 5,
        started_at: `${partial.date}T05:00:00.000Z`,
        completed_at: `${partial.date}T14:00:00.000Z`,
      },
      stops: partial.routeId.startsWith('accounting-')
        ? []
        : [{ id: `stop-${partial.id}`, delivery_status: 'delivered', weight_kg: partial.weightKg ?? 10 }],
      shipmentLines: [{ route_code: partial.routeLabel }],
    },
  };
}

export type FinanceUiHarnessSnapshot = {
  assignments: ServerRouteAssignment[];
  tripSheets: ServerTripSheet[];
  adjustments: WageAdjustment[];
  fuelEntryIds: string[];
};

export type FinanceUiHarnessApi = {
  handle: EmployeeApiTestTransport;
  armNextFailure: () => void;
  reset: () => void;
  snapshot: () => FinanceUiHarnessSnapshot;
};

type Store = {
  assignments: Map<string, ServerRouteAssignment>;
  tripSheets: Map<string, ServerTripSheet>;
  adjustments: Map<string, WageAdjustment>;
  failNext: boolean;
};

function seedStore(): Store {
  const store: Store = {
    assignments: new Map(),
    tripSheets: new Map(),
    adjustments: new Map(),
    failNext: false,
  };

  // Same-day multi-route wage uses one shared day total (server behaviour).
  const day1002Pay = compensation(37.4, 120, 200, 5);

  const rows: ServerRouteAssignment[] = [
    assignment({
      id: 'acct-jonas-1004',
      routeId: 'accounting-manual-1004',
      driverId: 'driver-1',
      driverName: 'Jonas',
      date: '2026-10-04',
      routeLabel: 'Servisas',
      stops: 1,
      weightKg: 10,
      distanceKm: 5,
    }),
    assignment({
      id: 'live-jonas-1003',
      routeId: 'route-live-1003',
      driverId: 'driver-1',
      driverName: 'Jonas',
      date: '2026-10-03',
      routeLabel: 'Gyvas pristatymas',
      stops: 4,
      weightKg: 200,
      distanceKm: 120,
    }),
    assignment({
      id: 'live-jonas-1002-a',
      routeId: 'route-live-1002-a',
      driverId: 'driver-1',
      driverName: 'Jonas',
      date: '2026-10-02',
      routeLabel: 'Rytinis',
      stops: 3,
      weightKg: 150,
      distanceKm: 80,
    }),
    assignment({
      id: 'live-jonas-1002-b',
      routeId: 'route-live-1002-b',
      driverId: 'driver-1',
      driverName: 'Jonas',
      date: '2026-10-02',
      routeLabel: 'Vakarinis',
      stops: 2,
      weightKg: 50,
      distanceKm: 40,
    }),
    assignment({
      id: 'live-petras-1003',
      routeId: 'route-live-petras-1003',
      driverId: 'driver-2',
      driverName: 'Petras',
      date: '2026-10-03',
      routeLabel: 'Petro reisas',
      vehicleId: 'veh-2',
      stops: 5,
      weightKg: 300,
      distanceKm: 90,
    }),
  ];

  for (const row of rows) store.assignments.set(row.id, row);

  const sheets: ServerTripSheet[] = [
    sheet({
      id: 'sheet-acct-1004',
      assignmentId: 'acct-jonas-1004',
      routeId: 'accounting-manual-1004',
      date: '2026-10-04',
      driverId: 'driver-1',
      driverName: 'Jonas',
      actualDistanceKm: 5,
      totalStops: 1,
      deliveredStops: 1,
      totalWeightKg: 10,
      deliveredWeightKg: 10,
      startOdometer: 9_000,
      endOdometer: 9_005,
      compensation: compensation(24.15, 5, 10, 1),
      startAddress: 'Servisas',
      endAddress: 'Servisas',
      fuelEntries: [{
        id: 'fuel-acct-1004',
        tripSheetId: 'sheet-acct-1004',
        assignmentId: 'acct-jonas-1004',
        routeId: 'accounting-manual-1004',
        driverId: 'driver-1',
        driverName: 'Jonas',
        vehicleId: 'veh-1',
        registrationNumber: 'DEF456',
        filledAt: '2026-10-04T10:00:00.000Z',
        odometer: 9_002,
        liters: 20,
        pricePerLiter: 1.5,
        totalCost: 30,
        station: 'Sintetinė',
        receiptNumber: 'SYN-1',
        notes: null,
        createdAt: NOW,
        createdBy: HARNESS_ADMIN.id,
      }],
    }),
    sheet({
      id: 'sheet-live-1002-a',
      assignmentId: 'live-jonas-1002-a',
      routeId: 'route-live-1002-a',
      date: '2026-10-02',
      driverId: 'driver-1',
      driverName: 'Jonas',
      actualDistanceKm: 80,
      totalStops: 3,
      deliveredStops: 3,
      totalWeightKg: 150,
      deliveredWeightKg: 150,
      compensation: day1002Pay,
      startAddress: 'Sandėlis',
      endAddress: 'Vilnius',
    }),
    sheet({
      id: 'sheet-live-1002-b',
      assignmentId: 'live-jonas-1002-b',
      routeId: 'route-live-1002-b',
      date: '2026-10-02',
      driverId: 'driver-1',
      driverName: 'Jonas',
      actualDistanceKm: 40,
      totalStops: 2,
      deliveredStops: 2,
      totalWeightKg: 50,
      deliveredWeightKg: 50,
      compensation: day1002Pay,
      // Same calendar day as sheet-live-1002-a → two-trip aggregation.
      startAddress: 'Vilnius',
      endAddress: 'Kaunas',
    }),
    sheet({
      id: 'sheet-live-1003',
      assignmentId: 'live-jonas-1003',
      routeId: 'route-live-1003',
      date: '2026-10-03',
      driverId: 'driver-1',
      driverName: 'Jonas',
      fuelEntries: [],
    }),
    sheet({
      id: 'sheet-petras-1003',
      assignmentId: 'live-petras-1003',
      routeId: 'route-live-petras-1003',
      date: '2026-10-03',
      driverId: 'driver-2',
      driverName: 'Petras',
      vehicle: { id: 'veh-2', registrationNumber: 'GHI789', model: 'Sprinter', maximumPayloadKg: 1400 },
      actualDistanceKm: 90,
      totalStops: 5,
      deliveredStops: 5,
      totalWeightKg: 300,
      deliveredWeightKg: 300,
      compensation: compensation(36.3, 90, 300, 5),
    }),
  ];

  for (const item of sheets) store.tripSheets.set(item.id, item);

  const adjustments: WageAdjustment[] = [
    { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-02', amountEur: 30, comment: 'Priedas' },
    { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-05', amountEur: 0, comment: 'Sirgau' },
    { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-06', amountEur: -12.5, comment: 'Korekcija' },
    { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-07', amountEur: 0, comment: 'Tik komentaras be reiso' },
  ];
  for (const item of adjustments) store.adjustments.set(`${item.driverId}:${item.date}`, item);

  return store;
}

function json(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function parseBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string' || !init.body) return null;
  try {
    return JSON.parse(init.body) as unknown;
  } catch {
    return null;
  }
}

function queryParam(path: string, key: string): string | null {
  const queryIndex = path.indexOf('?');
  if (queryIndex < 0) return null;
  return new URLSearchParams(path.slice(queryIndex)).get(key);
}

function pathnameOf(path: string): string {
  const queryIndex = path.indexOf('?');
  return queryIndex < 0 ? path : path.slice(0, queryIndex);
}

/**
 * Builds a fresh synthetic employee API. Mutating calls update the same
 * in-memory maps the product screens re-fetch after save/delete.
 */
export function createFinanceUiHarnessApi(): FinanceUiHarnessApi {
  let store = seedStore();

  const handle: EmployeeApiTestTransport = async (path, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const pathname = pathnameOf(path);

    if (store.failNext && method !== 'GET') {
      store.failNext = false;
      return error(500, 'HARNESS_SYNTHETIC_ERROR', 'Sintetinė klaida — bandykite dar kartą.');
    }

    if (pathname === '/api/trip-sheets' && method === 'GET') {
      return json(200, { tripSheets: [...store.tripSheets.values()] });
    }

    if (pathname === '/api/admin/assignments' && method === 'GET') {
      return json(200, { assignments: [...store.assignments.values()] });
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      return json(200, { users: [HARNESS_ADMIN, ...DRIVERS] });
    }

    if (pathname === '/api/admin/vehicles' && method === 'GET') {
      return json(200, { vehicles: VEHICLES });
    }

    if (pathname === '/api/admin/route-price-settings' && method === 'GET') {
      return json(200, { settings: HARNESS_ROUTE_PRICE_SETTINGS });
    }

    if (pathname === '/api/admin/accounting-corrections' && method === 'GET') {
      return json(200, { corrections: [] });
    }

    if (pathname === '/api/admin/wage-adjustments' && method === 'GET') {
      const from = queryParam(path, 'from') ?? '2000-01-01';
      const to = queryParam(path, 'to') ?? '2100-12-31';
      const adjustments = [...store.adjustments.values()].filter((item) => item.date >= from && item.date <= to);
      return json(200, { adjustments });
    }

    if (pathname === '/api/admin/wage-adjustments' && method === 'PUT') {
      const body = parseBody(init) as {
        driverId?: string;
        date?: string;
        amountEur?: number;
        comment?: string;
      } | null;
      if (!body?.driverId || !body.date || typeof body.amountEur !== 'number') {
        return error(400, 'INVALID_BODY', 'Neteisingas rankinio koregavimo užklausos turinys.');
      }
      const key = `${body.driverId}:${body.date}`;
      const comment = (body.comment ?? '').trim();
      if (body.amountEur === 0 && !comment) {
        store.adjustments.delete(key);
        return json(200, { adjustment: null });
      }
      const driver = DRIVERS.find((item) => item.id === body.driverId);
      const next: WageAdjustment = {
        driverId: body.driverId,
        driverName: driver?.displayName ?? body.driverId,
        date: body.date,
        amountEur: body.amountEur,
        comment,
      };
      store.adjustments.set(key, next);
      return json(200, { adjustment: next });
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/accounting-trips\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const id = decodeURIComponent(deleteMatch[1]!);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
        return error(400, 'INVALID_ID', 'Neteisingas apskaitos įrašo identifikatorius.');
      }
      const row = store.assignments.get(id);
      if (!row) return error(404, 'ASSIGNMENT_NOT_FOUND', 'Apskaitos įrašas nerastas.');
      if (!row.routeId.startsWith('accounting-')) {
        return error(400, 'NOT_ACCOUNTING_TRIP', 'Šalinti galima tik rankinį apskaitos įrašą. Pristatymų reisai, kuras ir odometrai čia nešalinami.');
      }

      // Collect fuel before removing the trip sheet so it survives as a fuel-only day.
      const removedSheets = [...store.tripSheets.values()].filter((item) => item.assignmentId === id);
      const survivingFuel = removedSheets.flatMap((item) => item.fuelEntries ?? []);
      store.assignments.delete(id);
      for (const item of removedSheets) store.tripSheets.delete(item.id);

      if (survivingFuel.length > 0) {
        const sample = removedSheets[0]!;
        const fuelOnlyId = `fuel-day-${sample.date}-${sample.vehicle?.id ?? 'veh'}`;
        store.tripSheets.set(fuelOnlyId, {
          ...sample,
          id: fuelOnlyId,
          assignmentId: fuelOnlyId,
          routeId: `fuel-day-${sample.date}`,
          routeNumbers: [],
          totalStops: 0,
          deliveredStops: 0,
          totalWeightKg: 0,
          deliveredWeightKg: 0,
          actualDistanceKm: null,
          startOdometer: null,
          endOdometer: null,
          compensation: null,
          startAddress: '',
          endAddress: '',
          fuelEntries: survivingFuel,
        });
      }
      return json(204, null);
    }

    // Month-summary create/edit seams used by the real screen — keep them as
    // no-op success so accidental clicks do not hit the network.
    if (pathname === '/api/admin/accounting-trips' && method === 'POST') {
      return error(501, 'HARNESS_READ_WRITE_LIMITED', 'Harness leidžia šalinti ir redaguoti atlygio priedus; naujų apskaitos reisų kūrimas šiame fixture išjungtas.');
    }

    if (
      pathname.startsWith('/api/admin/assignments/')
      || pathname.startsWith('/api/trip-sheets/')
      || pathname === '/api/trip-sheets/day-readings'
      || pathname === '/api/admin/vehicle-day-readings/move'
    ) {
      return error(501, 'HARNESS_READ_WRITE_LIMITED', 'Šis harness veiksmas sintetiniame režime neįjungtas.');
    }

    return error(404, 'HARNESS_UNKNOWN_PATH', `Sintetinis API nežino kelio ${method} ${pathname}`);
  };

  return {
    handle,
    armNextFailure: () => { store.failNext = true; },
    reset: () => { store = seedStore(); },
    snapshot: () => ({
      assignments: [...store.assignments.values()],
      tripSheets: [...store.tripSheets.values()],
      adjustments: [...store.adjustments.values()],
      fuelEntryIds: [...store.tripSheets.values()].flatMap((item) => (item.fuelEntries ?? []).map((entry) => entry.id)),
    }),
  };
}

export const FINANCE_UI_HARNESS_PROFILE: EmployeeProfile = HARNESS_ADMIN;
