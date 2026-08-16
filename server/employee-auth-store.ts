import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { normalizeRegionCode, uniqueRegionCodes } from '../src/domain/route-code.js';
import { calculateCompositeRouteProgress } from '../src/application/routes/composite-route-progress.js';
import {
  DEFAULT_ROUTE_PRICE_SETTINGS,
  normalizeRoutePriceSettings,
  type RoutePriceSettings,
} from '../src/application/routes/route-price.js';

export const EMPLOYEE_ROLES = ['admin', 'dispatcher', 'driver', 'quality'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export type EmployeeProfile = {
  id: string;
  username: string;
  displayName: string;
  role: EmployeeRole;
  disabled: boolean;
  permissions: EmployeePermissions;
  email: string | null;
  phone: string | null;
};

export const DRIVER_PERMISSION_KEYS = [
  'canReorderAssignedRoute',
  'canCreateRoutes',
  'canAddStops',
  'canRecalculateRoute',
  'canCancelRoute',
  'canViewCompensation',
] as const;
export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;
export const MANAGEMENT_PERMISSION_KEYS = [
  'canManageEmployees',
  'canManageVehicles',
  'canManageFinancials',
] as const;
export type ManagementPermissionKey = (typeof MANAGEMENT_PERMISSION_KEYS)[number];
export type ManagementPermissions = Record<ManagementPermissionKey, boolean>;
export type EmployeePermissionKey = DriverPermissionKey | ManagementPermissionKey;
export type EmployeePermissions = DriverPermissions & ManagementPermissions;
const DEFAULT_DRIVER_PERMISSIONS: DriverPermissions = {
  canReorderAssignedRoute: false,
  canCreateRoutes: false,
  canAddStops: false,
  canRecalculateRoute: false,
  canCancelRoute: false,
  canViewCompensation: false,
};
const DEFAULT_MANAGEMENT_PERMISSIONS: ManagementPermissions = {
  canManageEmployees: false,
  canManageVehicles: false,
  canManageFinancials: false,
};

export const DEFAULT_COMPENSATION_RATES = {
  fixedDailyNetEur: 23,
  perKmEur: 0.05,
  perKgEur: 0.006,
  perStopEur: 0.65,
} as const;

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
  vehicle: FleetVehicleSnapshot | null;
};

export type FleetVehicle = {
  id: string;
  registrationNumber: string;
  model: string;
  maximumPayloadKg: number;
  assignedDriverId: string | null;
  fuelRemainingLiters: number | null;
  fuelUpdatedAt: string | null;
  assignmentRevision: number;
  createdAt: string;
  updatedAt: string;
};

export type FleetVehicleSnapshot = Pick<FleetVehicle,
  'id' | 'registrationNumber' | 'model' | 'maximumPayloadKg'
> & Partial<Pick<FleetVehicle, 'fuelRemainingLiters' | 'fuelUpdatedAt' | 'assignmentRevision'>>;

export type CompensationBreakdown = {
  rates: typeof DEFAULT_COMPENSATION_RATES;
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
  vehicle: FleetVehicleSnapshot | null;
  requiresConfirmation: boolean;
  approvalPending: boolean;
  latestReport: FuelReport | null;
};

export type ServerTripSheet = {
  id: string;
  assignmentId: string;
  routeId: string;
  routeNumbers: string[];
  status: RouteAssignment['status'];
  date: string;
  driverId: string;
  driverName: string;
  vehicle: FleetVehicleSnapshot | null;
  fuelNormLitersPer100Km: number | null;
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
  status: RouteAssignment['status'];
  driverId: string;
  driverName: string;
  vehicle: FleetVehicleSnapshot | null;
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
  private readonly vehicles = this.db.collection('tsp_vehicles');
  private readonly fuelReports = this.db.collection('tsp_fuel_reports');
  private readonly settings = this.db.collection('tsp_settings');

  async hasUsers(): Promise<boolean> {
    return !(await this.users.limit(1).get()).empty;
  }

  async getRoutePriceSettings(): Promise<RoutePriceSettings> {
    const document = await this.settings.doc('route-pricing').get();
    return document.exists
      ? normalizeRoutePriceSettings(document.data())
      : normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS);
  }

  async updateRoutePriceSettings(input: unknown, updatedBy: string): Promise<RoutePriceSettings> {
    const settings = normalizeRoutePriceSettings(input);
    await this.settings.doc('route-pricing').set({
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy,
    });
    return settings;
  }

  async migrateLegacyAdmin(input: {
    fromUsername: string;
    username: string;
    displayName: string;
    pin: string;
  }): Promise<void> {
    const fromUsername = normalizeUsername(input.fromUsername);
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validatePin(input.pin);
    if (fromUsername === username) return;

    let migratedUserId: string | null = null;
    await this.db.runTransaction(async (transaction) => {
      const legacyUsernameRef = this.usernames.doc(fromUsername);
      const targetUsernameRef = this.usernames.doc(username);
      const targetMapping = await transaction.get(targetUsernameRef);
      if (targetMapping.exists) return;

      const legacyMapping = await transaction.get(legacyUsernameRef);
      const legacyUserId = legacyMapping.data()?.userId;
      if (typeof legacyUserId !== 'string') return;

      const userRef = this.users.doc(legacyUserId);
      const userDocument = await transaction.get(userRef);
      const current = userDocument.data() as StoredUser | undefined;
      if (!current || current.role !== 'admin') return;

      transaction.update(userRef, {
        username,
        displayName,
        ...pinCredentials(username, input.pin),
        updatedAt: new Date().toISOString(),
      });
      transaction.create(targetUsernameRef, { userId: current.id });
      transaction.delete(legacyUsernameRef);
      migratedUserId = current.id;
    });

    if (!migratedUserId) return;
    const sessions = await this.sessions.where('userId', '==', migratedUserId).get();
    if (sessions.empty) return;
    const batch = this.db.batch();
    sessions.docs.forEach((session) => batch.delete(session.ref));
    await batch.commit();
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

  async listVehicles(): Promise<FleetVehicle[]> {
    const snapshot = await this.vehicles.get();
    return snapshot.docs
      .map((document) => normalizeVehicle(document.data() as FleetVehicle))
      .sort((left, right) => left.registrationNumber.localeCompare(right.registrationNumber, 'lt'));
  }

  async createVehicle(input: {
    registrationNumber: string;
    model: string;
    maximumPayloadKg: number;
  }): Promise<FleetVehicle> {
    const registrationNumber = validateRegistrationNumber(input.registrationNumber);
    const model = validateVehicleModel(input.model);
    const maximumPayloadKg = validateMaximumPayload(input.maximumPayloadKg);
    const reference = this.vehicles.doc(registrationNumber);
    const now = new Date().toISOString();
    const vehicle: FleetVehicle = {
      id: registrationNumber,
      registrationNumber,
      model,
      maximumPayloadKg,
      assignedDriverId: null,
      fuelRemainingLiters: null,
      fuelUpdatedAt: null,
      assignmentRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.runTransaction(async (transaction) => {
      if ((await transaction.get(reference)).exists) {
        throw new EmployeeApiError('VEHICLE_EXISTS', 'Automobilis tokiu numeriu jau sukurtas.', 409);
      }
      transaction.create(reference, vehicle);
    });
    return vehicle;
  }

  async assignVehicle(vehicleIdInput: string, driverIdInput: string | null): Promise<FleetVehicle> {
    const vehicleId = validateVehicleId(vehicleIdInput);
    const driverId = driverIdInput === null ? null : safeId(driverIdInput);
    const vehicleRef = this.vehicles.doc(vehicleId);
    let updated: FleetVehicle | null = null;

    await this.db.runTransaction(async (transaction) => {
      const vehicleDocument = await transaction.get(vehicleRef);
      const stored = vehicleDocument.data() as FleetVehicle | undefined;
      const current = stored ? normalizeVehicle(stored) : undefined;
      if (!current) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);

      let previousAssignmentDocs: Array<{ id: string; ref: FirebaseFirestore.DocumentReference }> = [];
      if (driverId) {
        const driverDocument = await transaction.get(this.users.doc(driverId));
        const driver = driverDocument.data() as StoredUser | undefined;
        if (!driver || driver.disabled || driver.role !== 'driver') {
          throw new EmployeeApiError('DRIVER_NOT_FOUND', 'Aktyvus vairuotojas nerastas.', 404);
        }
        previousAssignmentDocs = (await transaction.get(this.vehicles.where('assignedDriverId', '==', driverId))).docs;
      }

      const updatedAt = new Date().toISOString();
      previousAssignmentDocs.forEach((document) => {
        if (document.id !== vehicleId) transaction.update(document.ref, {
          assignedDriverId: null,
          updatedAt,
        });
      });
      const assignmentRevision = current.assignedDriverId === driverId
        ? finiteNumber(current.assignmentRevision, 0)
        : finiteNumber(current.assignmentRevision, 0) + 1;
      transaction.update(vehicleRef, { assignedDriverId: driverId, assignmentRevision, updatedAt });
      updated = { ...current, assignedDriverId: driverId, assignmentRevision, updatedAt };
    });

    return updated!;
  }

  async updateVehicle(vehicleIdInput: string, input: {
    registrationNumber?: string;
    model?: string;
    maximumPayloadKg?: number;
  }): Promise<FleetVehicle> {
    const vehicleId = validateVehicleId(vehicleIdInput);
    const currentRef = this.vehicles.doc(vehicleId);
    let updated: FleetVehicle | null = null;

    await this.db.runTransaction(async (transaction) => {
      const document = await transaction.get(currentRef);
      const stored = document.data() as FleetVehicle | undefined;
      const current = stored ? normalizeVehicle(stored) : undefined;
      if (!current) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);

      const registrationNumber = input.registrationNumber === undefined
        ? current.registrationNumber
        : validateRegistrationNumber(input.registrationNumber);
      const model = input.model === undefined ? current.model : validateVehicleModel(input.model);
      const maximumPayloadKg = input.maximumPayloadKg === undefined
        ? current.maximumPayloadKg
        : validateMaximumPayload(input.maximumPayloadKg);
      const updatedAt = new Date().toISOString();
      updated = {
        ...current,
        id: registrationNumber,
        registrationNumber,
        model,
        maximumPayloadKg,
        updatedAt,
      };

      if (registrationNumber === vehicleId) {
        transaction.update(currentRef, updated);
        return;
      }

      const nextRef = this.vehicles.doc(registrationNumber);
      if ((await transaction.get(nextRef)).exists) {
        throw new EmployeeApiError('VEHICLE_EXISTS', 'Automobilis tokiu numeriu jau sukurtas.', 409);
      }
      transaction.create(nextRef, updated);
      transaction.delete(currentRef);
    });

    return updated!;
  }

  async getFuelStatus(profile: EmployeeProfile): Promise<FuelStatus> {
    const vehicleQuery = await this.vehicles.where('assignedDriverId', '==', profile.id).limit(1).get();
    const stored = vehicleQuery.docs[0]?.data() as FleetVehicle | undefined;
    const vehicle = stored ? normalizeVehicle(stored) : null;
    if (!vehicle) return { vehicle: null, requiresConfirmation: false, approvalPending: false, latestReport: null };
    const reports = await this.fuelReports.where('driverId', '==', profile.id).get();
    const latestReport = reports.docs
      .map((document) => document.data() as FuelReport)
      .filter((report) => report.vehicleId === vehicle.id && report.assignmentRevision === vehicle.assignmentRevision)
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt))[0] ?? null;
    const accepted = latestReport?.status === 'approved' || latestReport?.status === 'pending';
    return {
      vehicle: vehicleSnapshot(vehicle),
      requiresConfirmation: !accepted,
      approvalPending: latestReport?.status === 'pending',
      latestReport,
    };
  }

  async reportFuel(profile: EmployeeProfile, litersInput: number): Promise<FuelStatus> {
    const liters = validateFuelLiters(litersInput);
    const vehicleQuery = await this.vehicles.where('assignedDriverId', '==', profile.id).limit(1).get();
    const vehicleDocument = vehicleQuery.docs[0];
    const stored = vehicleDocument?.data() as FleetVehicle | undefined;
    const vehicle = stored ? normalizeVehicle(stored) : null;
    if (!vehicle || !vehicleDocument) throw new EmployeeApiError('VEHICLE_NOT_ASSIGNED', 'Vairuotojui nepriskirtas automobilis.', 409);
    const previousLiters = vehicle.fuelRemainingLiters;
    const status: FuelReport['status'] = previousLiters === null || Math.abs(previousLiters - liters) <= 0.1
      ? 'approved'
      : 'pending';
    const now = new Date().toISOString();
    const report: FuelReport = {
      id: randomUUID(),
      driverId: profile.id,
      driverName: profile.displayName,
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      assignmentRevision: vehicle.assignmentRevision,
      previousLiters,
      reportedLiters: liters,
      status,
      reportedAt: now,
      reviewedAt: status === 'approved' ? now : null,
      reviewedBy: status === 'approved' ? profile.id : null,
    };
    const batch = this.db.batch();
    batch.create(this.fuelReports.doc(report.id), report);
    if (status === 'approved') batch.update(vehicleDocument.ref, { fuelRemainingLiters: liters, fuelUpdatedAt: now, updatedAt: now });
    await batch.commit();
    return this.getFuelStatus(profile);
  }

  async listFuelReports(): Promise<FuelReport[]> {
    const snapshot = await this.fuelReports.get();
    return snapshot.docs
      .map((document) => document.data() as FuelReport)
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt));
  }

  async reviewFuelReport(reportIdInput: string, reviewer: EmployeeProfile, approve: boolean): Promise<FuelReport> {
    const reportRef = this.fuelReports.doc(safeId(reportIdInput));
    const reportDocument = await reportRef.get();
    const report = reportDocument.data() as FuelReport | undefined;
    if (!report) throw new EmployeeApiError('FUEL_REPORT_NOT_FOUND', 'Kuro likučio pakeitimas nerastas.', 404);
    if (report.status !== 'pending') return report;
    const vehicleDocument = await this.vehicles.doc(report.vehicleId).get();
    const storedVehicle = vehicleDocument.data() as FleetVehicle | undefined;
    const vehicle = storedVehicle ? normalizeVehicle(storedVehicle) : null;
    if (approve && (!vehicle
      || vehicle.assignedDriverId !== report.driverId
      || vehicle.assignmentRevision !== report.assignmentRevision)) {
      throw new EmployeeApiError('FUEL_REPORT_STALE', 'Automobilio priskyrimas jau pasikeitė. Šio seno kuro rodmens patvirtinti nebegalima.', 409);
    }
    const now = new Date().toISOString();
    const updated: FuelReport = { ...report, status: approve ? 'approved' : 'rejected', reviewedAt: now, reviewedBy: reviewer.id };
    const batch = this.db.batch();
    batch.set(reportRef, updated);
    if (approve) {
      batch.update(this.vehicles.doc(report.vehicleId), {
        fuelRemainingLiters: report.reportedLiters,
        fuelUpdatedAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    return updated;
  }

  async createUser(input: { username: string; displayName: string; pin: string; role: EmployeeRole; email?: string; phone?: string }): Promise<EmployeeProfile> {
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validatePin(input.pin);
    if (!EMPLOYEE_ROLES.includes(input.role)) throw new EmployeeApiError('INVALID_ROLE', 'Neleistina darbuotojo rolė.', 400);
    const stored = createStoredUser({
      username,
      displayName,
      role: input.role,
      pin: input.pin,
      email: validateEmail(input.email),
      phone: validatePhone(input.phone),
    });
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

  async updateUser(userId: string, input: { username?: string; displayName?: string; role?: EmployeeRole; disabled?: boolean; pin?: string; permissions?: Partial<EmployeePermissions>; email?: string; phone?: string }): Promise<EmployeeProfile> {
    const reference = this.users.doc(safeId(userId));
    const document = await reference.get();
    const current = document.data() as StoredUser | undefined;
    if (!current) throw new EmployeeApiError('USER_NOT_FOUND', 'Darbuotojas nerastas.', 404);
    const nextUsername = input.username === undefined ? current.username : validateUsername(input.username);
    const usernameChanged = nextUsername !== current.username;
    if (usernameChanged && input.pin === undefined) {
      throw new EmployeeApiError('USERNAME_CHANGE_REQUIRES_PIN', 'Keičiant prisijungimo vardą įveskite dabartinį arba naują PIN.', 400);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (usernameChanged) patch.username = nextUsername;
    if (input.displayName !== undefined) patch.displayName = validateDisplayName(input.displayName);
    if (input.role !== undefined) {
      if (!EMPLOYEE_ROLES.includes(input.role)) throw new EmployeeApiError('INVALID_ROLE', 'Neleistina darbuotojo rolė.', 400);
      patch.role = input.role;
    }
    if (input.disabled !== undefined) patch.disabled = Boolean(input.disabled);
    if (input.permissions !== undefined) patch.permissions = validatePermissions(input.permissions);
    if (input.email !== undefined) patch.email = validateEmail(input.email);
    if (input.phone !== undefined) patch.phone = validatePhone(input.phone);
    if (input.pin !== undefined) {
      validatePin(input.pin);
      const credentials = pinCredentials(nextUsername, input.pin);
      Object.assign(patch, credentials);
    }
    const sessions = input.pin !== undefined || usernameChanged
      ? await this.sessions.where('userId', '==', current.id).get()
      : null;
    if (usernameChanged) {
      const previousUsernameRef = this.usernames.doc(current.username);
      const nextUsernameRef = this.usernames.doc(nextUsername);
      await this.db.runTransaction(async (transaction) => {
        const target = await transaction.get(nextUsernameRef);
        if (target.exists && target.data()?.userId !== current.id) {
          throw new EmployeeApiError('USERNAME_EXISTS', 'Toks prisijungimo vardas jau naudojamas.', 409);
        }
        transaction.update(reference, patch);
        transaction.set(nextUsernameRef, { userId: current.id });
        transaction.delete(previousUsernameRef);
      });
    } else if (sessions) {
      const batch = this.db.batch();
      batch.update(reference, patch);
      sessions.docs.forEach((session) => batch.delete(session.ref));
      await batch.commit();
    } else {
      await reference.update(patch);
    }
    if (usernameChanged && sessions && !sessions.empty) {
      const batch = this.db.batch();
      sessions.docs.forEach((session) => batch.delete(session.ref));
      await batch.commit();
    }
    return publicProfile({ ...current, ...patch } as StoredUser);
  }

  async createAssignment(input: {
    driverId: string;
    routeSnapshot: RouteSnapshot;
    createdBy: string;
    vehicleId?: string;
  }): Promise<RouteAssignment> {
    validateSnapshot(input.routeSnapshot);
    const driverDoc = await this.users.doc(safeId(input.driverId)).get();
    const driver = driverDoc.data() as StoredUser | undefined;
    if (!driver || driver.disabled || driver.role !== 'driver') {
      throw new EmployeeApiError('DRIVER_NOT_FOUND', 'Aktyvus vairuotojas nerastas.', 404);
    }
    const routeId = String(input.routeSnapshot.route.id ?? '');
    if (!routeId) throw new EmployeeApiError('INVALID_ROUTE', 'Maršruto ID nenurodytas.', 400);
    if (String(input.routeSnapshot.route.status ?? '') !== 'planned') {
      throw new EmployeeApiError('ROUTE_NOT_PLANNED', 'Vairuotojui galima priskirti tik suplanuotą maršrutą.', 409);
    }
    const existing = await this.assignments.where('routeId', '==', routeId).get();
    if (existing.docs.some((doc) => {
      const assignment = doc.data() as RouteAssignment;
      return !['completed', 'cancelled'].includes(assignment.status);
    })) {
      throw new EmployeeApiError('ROUTE_ALREADY_ASSIGNED', 'Šis maršrutas jau priskirtas vairuotojui.', 409);
    }
    const now = new Date().toISOString();
    const vehicle = input.vehicleId
      ? vehicleSnapshot(await this.assignVehicle(input.vehicleId, driver.id))
      : await this.findAssignedVehicleSnapshot(driver.id);
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
      vehicle,
    };
    await this.assignments.doc(assignment.id).create(assignment);
    return assignment;
  }

  async cancelAssignment(assignmentId: string): Promise<RouteAssignment> {
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment) throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    if (assignment.status === 'completed') {
      throw new EmployeeApiError('ASSIGNMENT_COMPLETED', 'Užbaigto maršruto atšaukti negalima.', 409);
    }
    if (assignment.status === 'cancelled') return assignment;
    const updatedAt = new Date().toISOString();
    const routeSnapshot: RouteSnapshot = {
      ...assignment.routeSnapshot,
      route: {
        ...assignment.routeSnapshot.route,
        status: 'cancelled',
        cancelled_at: updatedAt,
        updated_at: updatedAt,
      },
    };
    const updated = { ...assignment, status: 'cancelled' as const, routeSnapshot, updatedAt };
    await reference.set(updated);
    return updated;
  }

  async deleteAssignment(assignmentId: string): Promise<RouteAssignment> {
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment) throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    await reference.delete();
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

  async listTripSheets(profile: EmployeeProfile): Promise<ServerTripSheet[]> {
    const assignments = (await this.listAssignments(profile)).filter((assignment) => assignment.status === 'completed');
    const vehicles = await this.listVehicles();
    const currentVehicles = new Map(
      vehicles.filter((vehicle) => vehicle.assignedDriverId).map((vehicle) => [vehicle.assignedDriverId!, vehicleSnapshot(vehicle)]),
    );
    const priceSettings = await this.getRoutePriceSettings();
    const sheets = assignments
      .map((assignment) => buildServerTripSheet(assignment, assignment.vehicle ?? currentVehicles.get(assignment.driverId) ?? null))
      .map((sheet) => ({ ...sheet, fuelNormLitersPer100Km: tripSheetFuelNorm(sheet.vehicle, priceSettings) }))
      .sort((left, right) => (right.completedAt ?? right.date).localeCompare(left.completedAt ?? left.date));
    const canViewCompensation = profile.role !== 'driver' || profile.permissions.canViewCompensation;
    return canViewCompensation ? attachDailyCompensation(sheets) : sheets;
  }

  async listQualityRoutes(): Promise<QualityRouteMonitor[]> {
    const snapshot = await this.assignments.get();
    const assignments = snapshot.docs.map((document) => document.data() as RouteAssignment);
    const vehicles = await this.listVehicles();
    const currentVehicles = new Map(
      vehicles.filter((vehicle) => vehicle.assignedDriverId).map((vehicle) => [vehicle.assignedDriverId!, vehicleSnapshot(vehicle)]),
    );
    return assignments
      .filter((assignment) => assignment.status !== 'cancelled')
      .map((assignment) => buildQualityRouteMonitor(assignment, assignment.vehicle ?? currentVehicles.get(assignment.driverId) ?? null))
      .sort((left, right) => qualityStatusRank(left.status) - qualityStatusRank(right.status) || right.updatedAt.localeCompare(left.updatedAt));
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
    const currentVehicle = ['in_progress', 'completed'].includes(routeStatus)
      ? await this.findAssignedVehicleSnapshot(assignment.driverId)
      : null;
    const vehicle = currentVehicle ?? assignment.vehicle ?? null;
    await reference.update({ status, routeSnapshot: snapshot, progress, updatedAt, vehicle });
    return { ...assignment, status, routeSnapshot: snapshot, progress, updatedAt, vehicle };
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

  private async findAssignedVehicleSnapshot(driverId: string): Promise<FleetVehicleSnapshot | null> {
    const snapshot = await this.vehicles.where('assignedDriverId', '==', driverId).limit(1).get();
    const stored = snapshot.docs[0]?.data() as FleetVehicle | undefined;
    const vehicle = stored ? normalizeVehicle(stored) : undefined;
    return vehicle ? vehicleSnapshot(vehicle) : null;
  }
}

export class EmployeeApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

function createStoredUser(input: { username: string; displayName: string; role: EmployeeRole; pin: string; email?: string | null; phone?: string | null }): StoredUser {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    disabled: false,
    permissions: { ...DEFAULT_DRIVER_PERMISSIONS, ...DEFAULT_MANAGEMENT_PERMISSIONS },
    email: input.email ?? null,
    phone: input.phone ?? null,
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
    email: optionalText(user.email),
    phone: optionalText(user.phone),
  };
}

function validatePermissions(value: Partial<EmployeePermissions> | undefined): EmployeePermissions {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    [...DRIVER_PERMISSION_KEYS, ...MANAGEMENT_PERMISSION_KEYS].map((key) => [key, source[key] === true]),
  ) as EmployeePermissions;
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

function validateEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase('lt-LT') ?? '';
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new EmployeeApiError('INVALID_EMAIL', 'Neteisingas darbuotojo el. pašto adresas.', 400);
  }
  return normalized;
}

function validatePhone(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/[\s()-]+/g, '') ?? '';
  if (!normalized) return null;
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) {
    throw new EmployeeApiError('INVALID_PHONE', 'Neteisingas darbuotojo telefono numeris.', 400);
  }
  return normalized;
}

function validateFuelLiters(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000) {
    throw new EmployeeApiError('INVALID_FUEL_READING', 'Kuro likutis turi būti nuo 0 iki 1000 litrų.', 400);
  }
  return Math.round(value * 10) / 10;
}

function vehicleSnapshot(vehicle: FleetVehicle): FleetVehicleSnapshot {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    model: vehicle.model,
    maximumPayloadKg: vehicle.maximumPayloadKg,
    fuelRemainingLiters: vehicle.fuelRemainingLiters,
    fuelUpdatedAt: vehicle.fuelUpdatedAt,
    assignmentRevision: vehicle.assignmentRevision,
  };
}

function normalizeVehicle(vehicle: FleetVehicle): FleetVehicle {
  return {
    ...vehicle,
    fuelRemainingLiters: nullableNumber(vehicle.fuelRemainingLiters),
    fuelUpdatedAt: optionalText(vehicle.fuelUpdatedAt),
    assignmentRevision: finiteNumber(vehicle.assignmentRevision, 0),
  };
}

export function buildServerTripSheet(assignment: RouteAssignment, vehicle: FleetVehicleSnapshot | null): ServerTripSheet {
  const route = assignment.routeSnapshot.route;
  const stops = assignment.routeSnapshot.stops;
  const startedAt = optionalText(route.started_at);
  const completedAt = optionalText(route.completed_at);
  const durationMinutes = startedAt && completedAt
    ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 60_000))
    : nullableNumber(route.actual_duration_minutes);
  const deliveredStops = stops.filter((stop) => stop.delivery_status === 'delivered');
  const routeNumbers = uniqueRegionCodes(assignment.routeSnapshot.shipmentLines);
  return {
    id: `trip-sheet-${assignment.id}`,
    assignmentId: assignment.id,
    routeId: assignment.routeId,
    routeNumbers,
    status: assignment.status,
    date: optionalText(route.date) ?? assignment.assignedAt.slice(0, 10),
    driverId: assignment.driverId,
    driverName: assignment.driverName,
    vehicle,
    fuelNormLitersPer100Km: null,
    startOdometer: nullableNumber(route.start_odometer),
    endOdometer: nullableNumber(route.end_odometer),
    actualDistanceKm: nullableNumber(route.actual_distance_km),
    plannedDistanceKm: nullableNumber(route.estimated_distance_km),
    startedAt,
    completedAt,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
    totalStops: finiteNumber(route.total_stops, stops.length),
    deliveredStops: deliveredStops.length,
    totalWeightKg: finiteNumber(route.total_weight_kg, 0),
    deliveredWeightKg: deliveredStops.reduce((sum, stop) => sum + finiteNumber(stop.weight_kg, 0), 0),
    startAddress: locationAddress(route.start_location_json, 'Pradžia'),
    endAddress: locationAddress(route.end_location_json, 'Pabaiga'),
    compensation: null,
  };
}

export function tripSheetFuelNorm(vehicle: FleetVehicleSnapshot | null, settings: RoutePriceSettings): number | null {
  if (!vehicle) return null;
  const exact = settings.vehicleCosts[vehicle.registrationNumber.trim().toUpperCase()];
  if (exact) return exact.fuelNormLitersPer100Km;
  const size = vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.mediumMax
    ? 'large'
    : vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.smallMax ? 'medium' : 'small';
  return settings.fallbackVehicleCosts[size].fuelNormLitersPer100Km;
}

export function attachDailyCompensation(sheets: ServerTripSheet[]): ServerTripSheet[] {
  const byDriverAndDate = new Map<string, ServerTripSheet[]>();
  for (const sheet of sheets) {
    const key = `${sheet.driverId}:${sheet.date}`;
    byDriverAndDate.set(key, [...(byDriverAndDate.get(key) ?? []), sheet]);
  }
  const compensationByKey = new Map<string, CompensationBreakdown>();
  for (const [key, daySheets] of byDriverAndDate) {
    const allActual = daySheets.every((sheet) => sheet.actualDistanceKm !== null);
    const distanceKm = daySheets.reduce((sum, sheet) => sum + (sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0), 0);
    const weightKg = daySheets.reduce((sum, sheet) => sum + sheet.totalWeightKg, 0);
    const stops = daySheets.reduce((sum, sheet) => sum + sheet.totalStops, 0);
    const fixedAmountEur = DEFAULT_COMPENSATION_RATES.fixedDailyNetEur;
    const distanceAmountEur = money(distanceKm * DEFAULT_COMPENSATION_RATES.perKmEur);
    const weightAmountEur = money(weightKg * DEFAULT_COMPENSATION_RATES.perKgEur);
    const stopsAmountEur = money(stops * DEFAULT_COMPENSATION_RATES.perStopEur);
    compensationByKey.set(key, {
      rates: DEFAULT_COMPENSATION_RATES,
      distanceKm,
      distanceSource: allActual ? 'odometer' : 'planned',
      weightKg,
      stops,
      fixedAmountEur,
      distanceAmountEur,
      weightAmountEur,
      stopsAmountEur,
      totalNetEur: money(fixedAmountEur + distanceAmountEur + weightAmountEur + stopsAmountEur),
      preliminary: !allActual || daySheets.some((sheet) => sheet.status !== 'completed'),
    });
  }
  return sheets.map((sheet) => ({
    ...sheet,
    compensation: compensationByKey.get(`${sheet.driverId}:${sheet.date}`) ?? null,
  }));
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildQualityRouteMonitor(assignment: RouteAssignment, vehicle: FleetVehicleSnapshot | null): QualityRouteMonitor {
  const route = assignment.routeSnapshot.route;
  const stops = [...assignment.routeSnapshot.stops].sort((left, right) => stopSequence(left) - stopSequence(right));
  const shipmentLines = assignment.routeSnapshot.shipmentLines;
  const deliveredStops = stops.filter((stop) => stop.delivery_status === 'delivered').length;
  const failedStops = stops.filter((stop) => stop.delivery_status === 'failed').length;
  const totalStops = finiteNumber(route.total_stops, stops.length);
  const remainingStops = Math.max(0, finiteNumber(route.remaining_stops, totalStops - deliveredStops - failedStops));
  const nextIndex = stops.findIndex((stop) => !['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')));
  const next = nextIndex >= 0 ? stops[nextIndex] : null;
  const routeNumbers = uniqueRegionCodes(shipmentLines);
  const stopRegions = new Map<string, string>();
  for (const line of shipmentLines) {
    const stopId = optionalText(line.delivery_stop_id);
    const region = normalizeRegionCode(line.route_code);
    if (stopId && region && !stopRegions.has(stopId)) stopRegions.set(stopId, region);
  }
  const monitorStops: QualityStopMonitor[] = stops.map((stop, index) => {
    const rawStatus = optionalText(stop.delivery_status);
    const status: QualityStopMonitor['status'] = rawStatus === 'delivered' || rawStatus === 'failed' ? rawStatus : 'pending';
    return {
      sequence: index + 1,
      recipient: optionalText(stop.recipient) ?? 'Gavėjas nenurodytas',
      address: stopAddress(stop),
      routeNumber: stopRegions.get(optionalText(stop.id) ?? '') ?? null,
      status,
      weightKg: finiteNumber(stop.weight_kg, 0),
      deliveryTimeFrom: optionalText(stop.delivery_time_from),
      deliveryTimeTo: optionalText(stop.delivery_time_to),
      plannedArrivalAt: optionalText(stop.latest_estimated_arrival_at) ?? optionalText(stop.planned_arrival_at),
      deliveredAt: optionalText(stop.delivered_at),
      failedAt: optionalText(stop.failed_at),
    };
  });
  const totalWeightKg = finiteNumber(route.total_weight_kg, 0);
  const remainingWeightKg = nullableNumber(route.remaining_weight_kg) ?? stops
    .filter((stop) => !['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')))
    .reduce((total, stop) => total + finiteNumber(stop.weight_kg, 0), 0);
  const hasPlannedLegDistances = stops.some((stop) => nullableNumber(stop.leg_distance_km) !== null);
  const completedPlannedDistanceKm = stops
    .filter((stop) => ['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')))
    .reduce((total, stop) => total + finiteNumber(stop.leg_distance_km, 0), 0);
  const compositeProgress = calculateCompositeRouteProgress({
    completedStops: totalStops - remainingStops,
    totalStops,
    processedWeightKg: totalWeightKg - remainingWeightKg,
    totalWeightKg,
    completedDistanceKm: hasPlannedLegDistances ? completedPlannedDistanceKm : null,
    totalDistanceKm: hasPlannedLegDistances ? nullableNumber(route.estimated_distance_km) : null,
    completed: assignment.status === 'completed',
  });
  return {
    id: assignment.id,
    routeId: assignment.routeId,
    date: optionalText(route.date) ?? assignment.assignedAt.slice(0, 10),
    routeNumbers,
    status: assignment.status,
    driverId: assignment.driverId,
    driverName: assignment.driverName,
    vehicle,
    totalStops,
    deliveredStops,
    failedStops,
    remainingStops,
    progressPercent: Math.round(compositeProgress.fraction * 100),
    totalWeightKg,
    remainingWeightKg,
    nextStop: next ? monitorStops[nextIndex] : null,
    stops: monitorStops,
    plannedStartAt: optionalText(route.planned_departure_at),
    startedAt: optionalText(route.started_at),
    completedAt: optionalText(route.completed_at),
    updatedAt: assignment.updatedAt,
  };
}

function stopSequence(stop: Record<string, unknown>): number {
  return finiteNumber(stop.active_order, finiteNumber(stop.optimized_order, finiteNumber(stop.original_order, Number.MAX_SAFE_INTEGER)));
}

function stopAddress(stop: Record<string, unknown>): string {
  return optionalText(stop.normalized_address)
    ?? optionalText(stop.address)
    ?? optionalText(stop.original_address)
    ?? 'Adresas nenurodytas';
}

function qualityStatusRank(status: RouteAssignment['status']): number {
  return ({ in_progress: 0, downloaded: 1, assigned: 2, completed: 3, cancelled: 4 } as Record<RouteAssignment['status'], number>)[status];
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return nullableNumber(value) ?? fallback;
}

function locationAddress(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try {
    const location = JSON.parse(value) as Record<string, unknown>;
    return optionalText(location.normalizedAddress)
      ?? optionalText(location.originalAddress)
      ?? optionalText(location.address)
      ?? optionalText(location.label)
      ?? fallback;
  } catch {
    return fallback;
  }
}

function validateRegistrationNumber(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{3,12}$/.test(normalized)) {
    throw new EmployeeApiError('INVALID_REGISTRATION_NUMBER', 'Neteisingas automobilio valstybinis numeris.', 400);
  }
  return normalized;
}

function validateVehicleId(value: string): string {
  return validateRegistrationNumber(decodeURIComponent(value));
}

function validateVehicleModel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) {
    throw new EmployeeApiError('INVALID_VEHICLE_MODEL', 'Automobilio modelis turi būti 2–80 simbolių.', 400);
  }
  return normalized;
}

function validateMaximumPayload(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new EmployeeApiError('INVALID_MAXIMUM_PAYLOAD', 'Maksimalus krovinio svoris turi būti teigiamas skaičius.', 400);
  }
  return Math.round(value);
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
