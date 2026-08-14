import { createGatewayAuthorizationHeaders } from '@/infrastructure/gateway/device-auth';
import type { DriverPermissions } from '@/application/auth/employee-permissions';

export const EMPLOYEE_ROLES = ['admin', 'dispatcher', 'driver', 'quality'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export type EmployeeProfile = {
  id: string;
  username: string;
  displayName: string;
  role: EmployeeRole;
  disabled: boolean;
  permissions?: DriverPermissions;
};

export type EmployeeSession = {
  profile: EmployeeProfile;
  expiresAt: string;
};

export type ServerRouteAssignment = {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: 'assigned' | 'downloaded' | 'in_progress' | 'completed' | 'cancelled';
  routeSnapshot: RouteSnapshot;
  progress: Record<string, unknown> | null;
  assignedAt: string;
  updatedAt: string;
  vehicle?: ServerFleetVehicleSnapshot | null;
};

export type ServerFleetVehicle = {
  id: string;
  registrationNumber: string;
  model: string;
  maximumPayloadKg: number;
  assignedDriverId: string | null;
  fuelRemainingLiters?: number | null;
  fuelUpdatedAt?: string | null;
  assignmentRevision?: number;
  createdAt: string;
  updatedAt: string;
};

export type ServerFleetVehicleSnapshot = Pick<ServerFleetVehicle, 'id' | 'registrationNumber' | 'model' | 'maximumPayloadKg'> & {
  fuelRemainingLiters?: number | null;
  fuelUpdatedAt?: string | null;
  assignmentRevision?: number;
};

export type CompensationBreakdown = {
  rates: { fixedDailyNetEur: number; perKmEur: number; perKgEur: number; perStopEur: number };
  distanceKm: number;
  distanceSource: 'planned' | 'odometer';
  weightKg: number;
  stops: number;
  fixedAmountEur: number;
  distanceAmountEur: number;
  weightAmountEur: number;
  stopsAmountEur: number;
  totalNetEur: number;
  preliminary: boolean;
};

export type FuelReport = {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  registrationNumber: string;
  assignmentRevision: number;
  previousLiters: number | null;
  reportedLiters: number;
  status: 'approved' | 'pending' | 'rejected';
  reportedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type FuelStatus = {
  vehicle: ServerFleetVehicleSnapshot | null;
  requiresConfirmation: boolean;
  approvalPending: boolean;
  latestReport: FuelReport | null;
};

export type ServerTripSheet = {
  id: string;
  assignmentId: string;
  routeId: string;
  routeNumbers: string[];
  status: ServerRouteAssignment['status'];
  date: string;
  driverId: string;
  driverName: string;
  vehicle: ServerFleetVehicleSnapshot | null;
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
  totalStops: number;
  deliveredStops: number;
  totalWeightKg: number;
  deliveredWeightKg: number;
  startAddress: string;
  endAddress: string;
  compensation: CompensationBreakdown | null;
};

export type QualityStopMonitor = {
  sequence: number;
  recipient: string;
  address: string;
  routeNumber: string | null;
  status: 'pending' | 'delivered' | 'failed';
  weightKg: number;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  plannedArrivalAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
};

export type QualityRouteMonitor = {
  id: string;
  routeId: string;
  date: string;
  routeNumbers: string[];
  status: ServerRouteAssignment['status'];
  driverId: string;
  driverName: string;
  vehicle: ServerFleetVehicleSnapshot | null;
  totalStops: number;
  deliveredStops: number;
  failedStops: number;
  remainingStops: number;
  progressPercent: number;
  totalWeightKg: number;
  remainingWeightKg: number;
  nextStop: QualityStopMonitor | null;
  stops: QualityStopMonitor[];
  plannedStartAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type RouteSnapshot = {
  route: Record<string, unknown>;
  stops: Array<Record<string, unknown>>;
  shipmentLines: Array<Record<string, unknown>>;
};

const DATABASE_NAME = 'tsp-employee-session';
const STORE_NAME = 'session';
const SESSION_KEY = 'active';
let memorySession: EmployeeSession | null = null;

export async function getEmployeeSession(): Promise<EmployeeSession | null> {
  if (typeof indexedDB === 'undefined') {
    return memorySession;
  }
  try {
    const session = await withStore('readonly', (store) => requestValue<EmployeeSession | undefined>(store.get(SESSION_KEY)));
    if (!session) return null;
    memorySession = session;
    return session;
  } catch {
    return memorySession;
  }
}

export async function saveEmployeeSession(session: EmployeeSession): Promise<void> {
  memorySession = session;
  if (typeof indexedDB === 'undefined') return;
  await withStore('readwrite', (store) => requestValue(store.put(session, SESSION_KEY)));
}

export async function clearEmployeeSession(): Promise<void> {
  memorySession = null;
  if (typeof indexedDB === 'undefined') return;
  await withStore('readwrite', (store) => requestValue(store.delete(SESSION_KEY)));
}

export async function employeeServerInitialized(fetcher: typeof fetch = globalThis.fetch): Promise<boolean | null> {
  try {
    const response = await fetcher('/api/auth/status', { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return Boolean(((await response.json()) as { initialized?: unknown }).initialized);
  } catch {
    return null;
  }
}

export async function bootstrapEmployeeAdmin(
  input: { username: string; displayName: string; pin: string },
  fetcher: typeof fetch = globalThis.fetch,
): Promise<EmployeeSession> {
  const rawBody = JSON.stringify(input);
  const hmac = await createGatewayAuthorizationHeaders(rawBody);
  const response = await fetcher('/api/auth/bootstrap', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...hmac },
    body: rawBody,
  });
  return readSession(response);
}

export async function loginEmployee(
  username: string,
  pin: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<EmployeeSession> {
  const response = await fetcher('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  return readSession(response);
}

export async function logoutEmployee(fetcher: typeof fetch = globalThis.fetch): Promise<void> {
  const session = await getEmployeeSession();
  if (session) {
    await fetcher('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  }
  await clearEmployeeSession();
}

export async function refreshEmployeeSession(fetcher: typeof fetch = globalThis.fetch): Promise<EmployeeSession | null> {
  const session = await getEmployeeSession();
  if (!session) return null;
  const response = await fetcher('/api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!response.ok) throw await readEmployeeError(response);
  const payload = await response.json() as { profile?: EmployeeProfile };
  if (!payload.profile?.id) throw new EmployeeClientError('INVALID_SESSION_RESPONSE', 'Serveris grąžino neteisingą darbuotojo profilį.', 502);
  const refreshed = { ...session, profile: payload.profile };
  await saveEmployeeSession(refreshed);
  return refreshed;
}

export async function employeeApi<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = globalThis.fetch): Promise<T> {
  const session = await getEmployeeSession();
  if (!session) throw new EmployeeClientError('SESSION_REQUIRED', 'Reikia prisijungti.', 401);
  const response = await fetcher(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await readEmployeeError(response);
  return response.json() as Promise<T>;
}

export class EmployeeClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

async function readSession(response: Response): Promise<EmployeeSession> {
  if (!response.ok) throw await readEmployeeError(response);
  const session = await response.json() as EmployeeSession;
  if (!session.profile?.id || !session.expiresAt) {
    throw new EmployeeClientError('INVALID_SESSION_RESPONSE', 'Serveris grąžino neteisingą prisijungimo atsakymą.', 502);
  }
  await saveEmployeeSession(session);
  return session;
}

async function readEmployeeError(response: Response): Promise<EmployeeClientError> {
  try {
    const payload = await response.json() as { error?: { code?: unknown; message?: unknown } };
    return new EmployeeClientError(
      typeof payload.error?.code === 'string' ? payload.error.code : 'EMPLOYEE_API_ERROR',
      typeof payload.error?.message === 'string' ? payload.error.message : 'Darbuotojų serverio klaida.',
      response.status,
    );
  } catch {
    return new EmployeeClientError('EMPLOYEE_API_ERROR', 'Darbuotojų serverio klaida.', response.status);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Prisijungimo saugykla nepasiekiama.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  } finally {
    database.close();
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Prisijungimo saugyklos operacija nepavyko.'));
  });
}
