import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

export const EMPLOYEE_ROLES = ['admin', 'dispatcher', 'driver'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export type EmployeeProfile = {
  id: string;
  username: string;
  displayName: string;
  role: EmployeeRole;
  disabled: boolean;
  permissions: DriverPermissions;
};

export const DRIVER_PERMISSION_KEYS = [
  'canReorderAssignedRoute',
  'canCreateRoutes',
  'canAddStops',
  'canRecalculateRoute',
  'canCancelRoute',
] as const;
export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;
const DEFAULT_DRIVER_PERMISSIONS: DriverPermissions = {
  canReorderAssignedRoute: false,
  canCreateRoutes: false,
  canAddStops: false,
  canRecalculateRoute: false,
  canCancelRoute: false,
};

export type RouteAssignment = {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: 'assigned' | 'downloaded' | 'in_progress' | 'completed' | 'cancelled';
  routeSnapshot: RouteSnapshot;
  progress: Record<string, unknown> | null;
  createdBy: string;
  assignedAt: string;
  updatedAt: string;
};

export type RouteSnapshot = {
  route: Record<string, unknown>;
  stops: Array<Record<string, unknown>>;
  shipmentLines: Array<Record<string, unknown>>;
};

type StoredUser = EmployeeProfile & {
  pinSalt: string;
  pinHash: string;
  pinIterations: number;
  createdAt: string;
  updatedAt: string;
};

const PIN_ITERATIONS = 210_000;
const SESSION_DAYS = 30;

export class EmployeeAuthStore {
  private readonly db = new Firestore();
  private readonly users = this.db.collection('tsp_users');
  private readonly usernames = this.db.collection('tsp_usernames');
  private readonly sessions = this.db.collection('tsp_sessions');
  private readonly assignments = this.db.collection('tsp_assignments');

  async hasUsers(): Promise<boolean> {
    return !(await this.users.limit(1).get()).empty;
  }

  async bootstrapAdmin(input: { username: string; displayName: string; pin: string }): Promise<EmployeeProfile> {
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validatePin(input.pin);
    const stored = createStoredUser({ username, displayName, role: 'admin', pin: input.pin });
    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(this.users.limit(1));
      if (!existing.empty) throw new EmployeeApiError('ALREADY_INITIALIZED', 'Administratoriaus paskyra jau sukurta.', 409);
      transaction.create(this.users.doc(stored.id), stored);
      transaction.create(this.usernames.doc(username), { userId: stored.id });
    });
    return publicProfile(stored);
  }

  async login(usernameInput: string, pin: string): Promise<{ token: string; profile: EmployeeProfile; expiresAt: string }> {
    const username = normalizeUsername(usernameInput);
    const mapping = await this.usernames.doc(username).get();
    const userId = mapping.data()?.userId;
    const userDoc = typeof userId === 'string' ? await this.users.doc(userId).get() : null;
    const user = userDoc?.data() as StoredUser | undefined;
    if (!user || user.disabled || !verifyPin(user, pin)) {
      throw new EmployeeApiError('INVALID_CREDENTIALS', 'Neteisingas prisijungimo vardas arba PIN.', 401);
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
    await this.sessions.doc(hashToken(token)).set({
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt,
      lastSeenAt: now.toISOString(),
    });
    return { token, profile: publicProfile(user), expiresAt };
  }

  async authenticate(token: string): Promise<EmployeeProfile> {
    const sessionRef = this.sessions.doc(hashToken(token));
    const sessionDoc = await sessionRef.get();
    const session = sessionDoc.data();
    if (!session || typeof session.userId !== 'string' || typeof session.expiresAt !== 'string') {
      throw new EmployeeApiError('SESSION_INVALID', 'Prisijungimo sesija negalioja.', 401);
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await sessionRef.delete();
      throw new EmployeeApiError('SESSION_EXPIRED', 'Prisijungimo sesija pasibaigė.', 401);
    }
    const userDoc = await this.users.doc(session.userId).get();
    const user = userDoc.data() as StoredUser | undefined;
    if (!user || user.disabled) throw new EmployeeApiError('ACCOUNT_DISABLED', 'Darbuotojo paskyra išjungta.', 403);
    void sessionRef.update({ lastSeenAt: new Date().toISOString() }).catch(() => undefined);
    return publicProfile(user);
  }

  async logout(token: string): Promise<void> {
    await this.sessions.doc(hashToken(token)).delete();
  }

  async listUsers(): Promise<EmployeeProfile[]> {
    const snapshot = await this.users.get();
    return snapshot.docs
      .map((doc) => publicProfile(doc.data() as StoredUser))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'lt'));
  }

  async createUser(input: { username: string; displayName: string; pin: string; role: EmployeeRole }): Promise<EmployeeProfile> {
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validatePin(input.pin);
    if (!EMPLOYEE_ROLES.includes(input.role)) throw new EmployeeApiError('INVALID_ROLE', 'Neleistina darbuotojo rolė.', 400);
    const stored = createStoredUser({ username, displayName, role: input.role, pin: input.pin });
    await this.db.runTransaction(async (transaction) => {
      const usernameRef = this.usernames.doc(username);
      if ((await transaction.get(usernameRef)).exists) {
        throw new EmployeeApiError('USERNAME_EXISTS', 'Toks prisijungimo vardas jau naudojamas.', 409);
      }
      transaction.create(this.users.doc(stored.id), stored);
      transaction.create(usernameRef, { userId: stored.id });
    });
    return publicProfile(stored);
  }

  async updateUser(userId: string, input: { displayName?: string; role?: EmployeeRole; disabled?: boolean; pin?: string; permissions?: Partial<DriverPermissions> }): Promise<EmployeeProfile> {
    const reference = this.users.doc(safeId(userId));
    const document = await reference.get();
    const current = document.data() as StoredUser | undefined;
    if (!current) throw new EmployeeApiError('USER_NOT_FOUND', 'Darbuotojas nerastas.', 404);
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (input.displayName !== undefined) patch.displayName = validateDisplayName(input.displayName);
    if (input.role !== undefined) {
      if (!EMPLOYEE_ROLES.includes(input.role)) throw new EmployeeApiError('INVALID_ROLE', 'Neleistina darbuotojo rolė.', 400);
      patch.role = input.role;
    }
    if (input.disabled !== undefined) patch.disabled = Boolean(input.disabled);
    if (input.permissions !== undefined) patch.permissions = validatePermissions(input.permissions);
    if (input.pin !== undefined) {
      validatePin(input.pin);
      const credentials = pinCredentials(current.username, input.pin);
      Object.assign(patch, credentials);
      const sessions = await this.sessions.where('userId', '==', current.id).get();
      for (const session of sessions.docs) patch[`_revoke_${session.id}`] = true;
      const batch = this.db.batch();
      batch.update(reference, withoutRevokeMarkers(patch));
      sessions.docs.forEach((session) => batch.delete(session.ref));
      await batch.commit();
    } else {
      await reference.update(patch);
    }
    return publicProfile({ ...current, ...withoutRevokeMarkers(patch) } as StoredUser);
  }

  async createAssignment(input: {
    driverId: string;
    routeSnapshot: RouteSnapshot;
    createdBy: string;
  }): Promise<RouteAssignment> {
    validateSnapshot(input.routeSnapshot);
    const driverDoc = await this.users.doc(safeId(input.driverId)).get();
    const driver = driverDoc.data() as StoredUser | undefined;
    if (!driver || driver.disabled || driver.role !== 'driver') {
      throw new EmployeeApiError('DRIVER_NOT_FOUND', 'Aktyvus vairuotojas nerastas.', 404);
    }
    const routeId = String(input.routeSnapshot.route.id ?? '');
    if (!routeId) throw new EmployeeApiError('INVALID_ROUTE', 'Maršruto ID nenurodytas.', 400);
    const existing = await this.assignments.where('driverId', '==', driver.id).get();
    if (existing.docs.some((doc) => {
      const assignment = doc.data() as RouteAssignment;
      return assignment.routeId === routeId && !['completed', 'cancelled'].includes(assignment.status);
    })) {
      throw new EmployeeApiError('ROUTE_ALREADY_ASSIGNED', 'Šis maršrutas vairuotojui jau priskirtas.', 409);
    }
    const now = new Date().toISOString();
    const assignment: RouteAssignment = {
      id: randomUUID(),
      routeId,
      driverId: driver.id,
      driverName: driver.displayName,
      status: 'assigned',
      routeSnapshot: input.routeSnapshot,
      progress: null,
      createdBy: input.createdBy,
      assignedAt: now,
      updatedAt: now,
    };
    await this.assignments.doc(assignment.id).create(assignment);
    return assignment;
  }

  async listAssignments(profile: EmployeeProfile): Promise<RouteAssignment[]> {
    const snapshot = profile.role === 'driver'
      ? await this.assignments.where('driverId', '==', profile.id).get()
      : await this.assignments.get();
    return snapshot.docs
      .map((doc) => doc.data() as RouteAssignment)
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  }

  async updateAssignmentProgress(profile: EmployeeProfile, assignmentId: string, snapshot: RouteSnapshot): Promise<RouteAssignment> {
    validateSnapshot(snapshot);
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment) throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    if (profile.role === 'driver' && assignment.driverId !== profile.id) {
      throw new EmployeeApiError('FORBIDDEN', 'Šis maršrutas nepriskirtas prisijungusiam vairuotojui.', 403);
    }
    const routeStatus = String(snapshot.route.status ?? '');
    const status: RouteAssignment['status'] = routeStatus === 'completed'
      ? 'completed'
      : routeStatus === 'cancelled'
        ? 'cancelled'
        : routeStatus === 'in_progress'
          ? 'in_progress'
          : 'downloaded';
    const updatedAt = new Date().toISOString();
    const progress = {
      routeStatus,
      totalStops: Number(snapshot.route.total_stops ?? 0),
      remainingStops: Number(snapshot.route.remaining_stops ?? 0),
      remainingWeightKg: Number(snapshot.route.remaining_weight_kg ?? 0),
      lastSyncedAt: updatedAt,
    };
    await reference.update({ status, routeSnapshot: snapshot, progress, updatedAt });
    return { ...assignment, status, routeSnapshot: snapshot, progress, updatedAt };
  }

  async markAssignmentDownloaded(profile: EmployeeProfile, assignmentId: string): Promise<void> {
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment || assignment.driverId !== profile.id) {
      throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    }
    if (assignment.status === 'assigned') {
      await reference.update({ status: 'downloaded', updatedAt: new Date().toISOString() });
    }
  }
}

export class EmployeeApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

function createStoredUser(input: { username: string; displayName: string; role: EmployeeRole; pin: string }): StoredUser {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    disabled: false,
    permissions: { ...DEFAULT_DRIVER_PERMISSIONS },
    ...pinCredentials(input.username, input.pin),
    createdAt: now,
    updatedAt: now,
  };
}

function pinCredentials(username: string, pin: string): Pick<StoredUser, 'pinSalt' | 'pinHash' | 'pinIterations'> {
  const pinSalt = randomBytes(24).toString('base64url');
  return {
    pinSalt,
    pinHash: derivePinHash(username, pin, pinSalt, PIN_ITERATIONS),
    pinIterations: PIN_ITERATIONS,
  };
}

function derivePinHash(username: string, pin: string, salt: string, iterations: number): string {
  return pbkdf2Sync(`${normalizeUsername(username)}:${pin}`, salt, iterations, 32, 'sha256').toString('base64url');
}

function verifyPin(user: StoredUser, pin: string): boolean {
  const expected = Buffer.from(user.pinHash, 'base64url');
  const actual = Buffer.from(derivePinHash(user.username, pin, user.pinSalt, user.pinIterations), 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicProfile(user: StoredUser): EmployeeProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    disabled: user.disabled,
    permissions: validatePermissions(user.permissions),
  };
}

function validatePermissions(value: Partial<DriverPermissions> | undefined): DriverPermissions {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    DRIVER_PERMISSION_KEYS.map((key) => [key, source[key] === true]),
  ) as DriverPermissions;
}

function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase('lt-LT');
}

function validateUsername(value: string): string {
  const normalized = normalizeUsername(value);
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(normalized)) {
    throw new EmployeeApiError('INVALID_USERNAME', 'Prisijungimo vardas turi būti 3–32 raidžių arba skaitmenų.', 400);
  }
  return normalized;
}

function validateDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) {
    throw new EmployeeApiError('INVALID_DISPLAY_NAME', 'Darbuotojo vardas turi būti 2–80 simbolių.', 400);
  }
  return normalized;
}

function validatePin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) throw new EmployeeApiError('INVALID_PIN', 'Serverio PIN turi būti 4–8 skaitmenų.', 400);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new EmployeeApiError('INVALID_ID', 'Neteisingas identifikatorius.', 400);
  return value;
}

export function validateSnapshot(snapshot: RouteSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.route || !Array.isArray(snapshot.stops) || !Array.isArray(snapshot.shipmentLines)) {
    throw new EmployeeApiError('INVALID_ROUTE_SNAPSHOT', 'Maršruto duomenys nepilni.', 400);
  }
  if (snapshot.stops.length < 1 || snapshot.stops.length > 500) {
    throw new EmployeeApiError('INVALID_ROUTE_SNAPSHOT', 'Maršrutas turi turėti 1–500 taškų.', 400);
  }
}

function withoutRevokeMarkers(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_revoke_')));
}
