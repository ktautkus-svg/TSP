import { Firestore } from '@google-cloud/firestore';
import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { calculateCompositeRouteProgress } from '../src/application/routes/composite-route-progress.js';
import {
    DEFAULT_ROUTE_PRICE_SETTINGS,
    normalizeRoutePriceSettings,
    type RoutePriceSettings,
} from '../src/application/routes/route-price.js';
import {
    EXCEL_FUEL_LOG,
    FUEL_AUGUST_2026_MIGRATION_ID,
    FUEL_AUGUST_2026_NORMS,
    FUEL_AUGUST_2026_V3_MIGRATION_ID,
    FUEL_AUGUST_2026_V4_MIGRATION_ID,
    MET630_AUGUST_03_2026_DATE,
    MET630_AUGUST_03_2026_DISTANCE_KM,
    MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM,
    MET630_AUGUST_31_2026_ASSIGNMENT_ID,
    MET630_AUGUST_31_2026_DATE,
    MET630_AUGUST_31_2026_MANUAL_FILL,
    MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM,
    MET630_OPENING_FUEL_EFFECTIVE_AT,
    MET630_OPENING_FUEL_LITERS,
    MET630_OPENING_FUEL_NOTE,
    MET630_OPENING_FUEL_REPORT_ID,
    NLL182_OPENING_FUEL_EFFECTIVE_AT,
    NLL182_OPENING_FUEL_LITERS,
    NLL182_OPENING_FUEL_NOTE,
    NLL182_OPENING_FUEL_REPORT_ID,
    alreadyHasExcelFuelEntry,
    alreadyHasOpeningFuel,
    correctedMet630August03Odometers,
    excelFuelDocumentId,
    excelFuelOdometer,
    extraDistanceKmOf,
    isFuelAugust2026V3RemovedEntry,
    isFuelAugust2026V4ManualFillEntry,
    isStaleAugust2026FuelEntry,
    isStaleAugustOpeningReport,
    lithuaniaLocalToIso,
    met630August31AssignedOdometers,
    parseVehicleDateKey,
    shouldRestoreMet630August31AssignedDistance,
    uncoveredFuelDayKeys,
} from '../src/domain/excel-fuel-log.js';
import {
    bodyKindFromPalletCapacity,
    fleetCargoSpec,
    fleetTankCapacity,
    isFuelTankCapacity,
    isPalletCapacity,
    resolveFuelTankCapacity,
    resolveVehicleCargo,
    type PalletCapacity,
} from '../src/domain/fleet-cargo-specs.js';
import { isVanBodyKind, type VanBodyKind } from '../src/domain/loading-schema.js';
import {
    applyAdminAssignmentComplete,
    HistoricalCompleteError,
    type AdminCompleteAssignmentInput,
} from '../src/domain/historical-assignment-complete.js';
import { lithuanianDateKey } from '../src/domain/lithuanian-time.js';
import {
    AUGUST_2026_EXCEL_BACKFILL_ID,
    AUGUST_2026_EXCEL_BACKFILL_V2_ID,
    AUGUST_2026_EXCEL_BACKFILL_V3_ID,
    AUGUST_2026_EXCEL_BACKFILL_V4_ID,
    AUGUST_2026_ENSURE_FLEET_PLATES,
    AUGUST_2026_LRI740_OPENING_DATE,
    AUGUST_2026_LRI740_OPENING_LITERS,
    AUGUST_2026_LRI740_OPENING_NOTE,
    AUGUST_2026_LRI740_OPENING_REPORT_ID,
    AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
    AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
    assignmentNeedsStubStopRewrite,
    august2026EnsureFleetPlateSpecs,
    august2026EnsureFleetVehicleCreateInput,
    buildAugustBackfillRouteSnapshot,
    decideAugustBackfillDayAction,
    decideAugustBackfillV2GapAction,
    decideAugustBackfillV3GapAction,
    decideAugustBackfillV4DriverSync,
    geocodeQueriesCached,
    historicalWorkdayTimestamps,
    isAleksandras0819Met630RouteSet,
    isAleksandras0819Met630Target,
    isAugust2026ExcelBackfillV2GapDay,
    isAugust2026ExcelBackfillV3GapDay,
    isAugust2026ProtectedR56StubAssignment,
    isErikas0831Nll182Assignment,
    isKarolis0809Lri740Assignment,
    isKarolis0819R54R11Assignment,
    karolis0819NeedsNll182Move,
    liteAssignmentFromSnapshot,
    loadAugust2026ExcelBackfillCatalog,
    matchAleksandrasDriver,
    matchDriverByName,
    matchErikasDriver,
    matchVehicleByPlate,
    normalizePersonName,
    needsAleksandras0819DriverPatch,
    needsTripSheetListedDriverSync,
    replaceLiteAssignment,
    resolveAugustBackfillVehicle,
    shouldEnsureAugustBackfillFleetPlate,
    uniqueGeocodeQueries,
    type AugustAssignmentLite,
    type AugustBackfillGeocodeFn,
    type AugustBackfillVehicleRef,
    type AugustExcelDay,
} from '../src/domain/august-2026-excel-backfill.js';
import { GoogleGeocodingAdapter } from '../gateway/providers/google-geocoding-adapter.js';
import {
    NLL182_ODOMETER_DRIVER_NAME,
    NLL182_ODOMETER_LOG,
    odometerDistanceKm,
    parseVehicleDayAssignmentId,
    vehicleDayAssignmentId,
} from '../src/domain/nll182-odometer-log.js';
import { regionCodeFromSource, uniqueRegionCodes } from '../src/domain/route-code.js';
import {
    AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES,
    ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
    ERIKAS_ASKELOVICIUS_DRIVER_ID,
    KAROLIS_TAUTKUS_DRIVER_ID,
    NLL182_AUGUST_2026_ODOMETER_CORRECTIONS,
    TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID,
    canUpdateAssignmentScheduleDate,
    nll182FactDriverIdForDate,
    shouldRenameErikasPlaceholder,
    vehicleDayReadingDocId,
} from '../src/domain/trip-sheet-august-2026-vehicle-fix.js';
import {
    normalizeIsoDate as isoDateOrThrow,
    validateFuelLiters,
    validateFuelAmount as validateLiters,
    validateOdometerInput as validateOdometer,
    validateFuelPrice as validatePricePerLiter,
} from '../src/domain/shared-validation';

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
  /** null means this driver has no agreed rates yet and the defaults apply. */
  compensation: DriverCompensationRates | null;
};

export const DRIVER_PERMISSION_KEYS = [
  'canReorderAssignedRoute',
  'canCreateRoutes',
  'canAddStops',
  'canRecalculateRoute',
  'canCancelRoute',
  'canViewCompensation',
  'canEnterTripReadings',
] as const;
export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;
export const MANAGEMENT_PERMISSION_KEYS = [
  'canManageEmployees',
  'canManageVehicles',
  'canManageFinancials',
  'canEnterTripReadings',
  'canViewAllStatistics',
  'canEditTripSheets',
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
  canEnterTripReadings: false,
};
const DEFAULT_MANAGEMENT_PERMISSIONS: ManagementPermissions = {
  canManageEmployees: false,
  canManageVehicles: false,
  canManageFinancials: false,
  canEnterTripReadings: false,
  canViewAllStatistics: false,
  canEditTripSheets: false,
};

export const DEFAULT_COMPENSATION_RATES = {
  fixedDailyNetEur: 23,
  perKmEur: 0.05,
  perKgEur: 0.006,
  perStopEur: 0.65,
} as const;

/**
 * What one driver is paid, net, for a day's work. Entered per driver, because
 * the arrangement differs: some are on a flat daily figure, others on a base
 * plus piece rates. Every driver used to be scored on DEFAULT_COMPENSATION_RATES
 * regardless of what was actually agreed with them.
 *
 * 'fixed' pays fixedDailyNetEur and ignores the piece rates entirely.
 */
export type DriverCompensationRates = {
  type: 'fixed' | 'variable';
  fixedDailyNetEur: number;
  perKmEur: number;
  perKgEur: number;
  perStopEur: number;
};

export const DEFAULT_DRIVER_COMPENSATION: DriverCompensationRates = {
  type: 'variable',
  ...DEFAULT_COMPENSATION_RATES,
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
  vehicle: FleetVehicleSnapshot | null;
};

export type FleetVehicle = {
  id: string;
  registrationNumber: string;
  model: string;
  maximumPayloadKg: number;
  /**
   * Litres per 100 km for this specific vehicle, entered when editing it.
   * null means it was never set, and the norm falls back to the registration
   * table in route-price.ts and then to a payload-based estimate.
   */
  fuelNormLPer100Km: number | null;
  /** Physical tank size in litres. Not the current remaining fuel. */
  fuelTankCapacityLiters: number | null;
  cargoBodyKind: VanBodyKind;
  palletCapacity: PalletCapacity;
  hasSideDoor: boolean;
  /**
   * Real cargo floor, in millimetres. Without both of these the pallet drawing
   * cannot be produced and the screen falls back to the older bay diagram.
   */
  cargoLengthMm: number | null;
  cargoWidthMm: number | null;
  /** 'box' has a flat floor end to end; 'van' has wheel arches. */
  cargoBodyType: 'van' | 'box';
  wheelArchStartMm: number | null;
  wheelArchEndMm: number | null;
  /** Width one arch takes off each side. */
  wheelArchIntrusionMm: number | null;
  assignedDriverId: string | null;
  fuelRemainingLiters: number | null;
  fuelUpdatedAt: string | null;
  assignmentRevision: number;
  createdAt: string;
  updatedAt: string;
};

export type FleetVehicleSnapshot = Pick<FleetVehicle,
  'id' | 'registrationNumber' | 'model' | 'maximumPayloadKg'
> & Partial<Pick<FleetVehicle, 'fuelNormLPer100Km' | 'fuelTankCapacityLiters' | 'fuelRemainingLiters' | 'fuelUpdatedAt' | 'assignmentRevision' | 'cargoBodyKind' | 'hasSideDoor' | 'palletCapacity'
  | 'cargoLengthMm' | 'cargoWidthMm' | 'cargoBodyType' | 'wheelArchStartMm' | 'wheelArchEndMm' | 'wheelArchIntrusionMm'>>;

export type CompensationBreakdown = {
  rates: DriverCompensationRates;
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
  /**
   * The day the tank actually held this much — not when it was typed in. This
   * is what lets a correction act as the opening balance of a period: the trip
   * sheet anchors each month on the newest approved figure dated on or before
   * its first day.
   */
  effectiveAt: string;
  /** 'admin_correction' is entered by an administrator and approved on the spot. */
  kind: 'driver_report' | 'admin_correction';
  note: string | null;
};

export type VehicleFaultReport = {
  id: string;
  localId: string | null;
  vehicleId: string;
  registrationNumber: string;
  comment: string;
  reportedBy: string;
  reportedByName: string;
  reportedAt: string;
};

export type DepartureOverrideRecord = {
  id: string;
  localId: string | null;
  vehicleId: string;
  registrationNumber: string;
  fingerprint: string;
  summary: string;
  status: 'pending' | 'approved';
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
};

/** The approved balance a period starts from. */
export type FuelAnchor = {
  liters: number;
  effectiveAt: string;
};

export type FuelStatus = {
  vehicle: FleetVehicleSnapshot | null;
  requiresConfirmation: boolean;
  approvalPending: boolean;
  latestReport: FuelReport | null;
};

export type ServerFuelEntry = {
  id: string;
  tripSheetId: string;
  assignmentId: string;
  routeId: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  registrationNumber: string;
  filledAt: string;
  odometer: number;
  liters: number;
  pricePerLiter: number | null;
  totalCost: number | null;
  station: string | null;
  receiptNumber: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
};

export type VehicleDayReading = {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  date: string;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  /**
   * Kilometres driven on this vehicle-day that are not part of any completed
   * driver assignment. Used only in fuel/ledger consumption. Never added to
   * driver trip-sheet `actualDistanceKm` or wage distance.
   */
  extraDistanceKm?: number;
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
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
  /** Approved balance this day's period opens on; null when none is confirmed yet. */
  fuelAnchor?: FuelAnchor | null;
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  /** Fuel-only remainder km (other/unassigned). Not wage distance. */
  extraDistanceKm?: number | null;
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
  fuelEntries: ServerFuelEntry[];
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
  failureReason: string | null;
  failureComment: string | null;
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
  stops: Record<string, unknown>[];
  shipmentLines: Record<string, unknown>[];
};

export type ClientDirectoryEntry = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
  visitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastDeliveredAt: string | null;
};

type StoredClientDirectoryEntry = ClientDirectoryEntry & {
  updatedAt: string;
  updatedBy: string | null;
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
  private readonly vehicleFaults = this.db.collection('tsp_vehicle_faults');
  private readonly departureOverrides = this.db.collection('tsp_departure_overrides');
  private readonly fuelEntries = this.db.collection('tsp_fuel_entries');
  private readonly vehicleDayReadings = this.db.collection('tsp_vehicle_day_readings');
  private readonly settings = this.db.collection('tsp_settings');
  private readonly clients = this.db.collection('tsp_clients');

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
    validateNewPin(input.pin);
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
    validateNewPin(input.pin);
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
    let seeded = false;
    for (const document of snapshot.docs) {
      const raw = document.data() as FleetVehicle;
      const knownCargo = fleetCargoSpec(raw.registrationNumber);
      const knownTank = fleetTankCapacity(raw.registrationNumber);
      const needsCargo = Boolean(knownCargo) && !isPalletCapacity(raw.palletCapacity);
      const needsTank = knownTank !== null && raw.fuelTankCapacityLiters === undefined;
      if (!needsCargo && !needsTank) continue;
      await this.updateVehicle(String(raw.id ?? raw.registrationNumber), {
        ...(needsCargo && knownCargo ? {
          palletCapacity: knownCargo.palletCapacity,
          hasSideDoor: knownCargo.hasSideDoor,
          cargoBodyKind: bodyKindFromPalletCapacity(knownCargo.palletCapacity),
        } : {}),
        ...(needsTank ? { fuelTankCapacityLiters: knownTank } : {}),
      });
      seeded = true;
    }
    const docs = seeded ? (await this.vehicles.get()).docs : snapshot.docs;
    return docs
      .map((document) => normalizeVehicle(document.data() as FleetVehicle))
      .sort((left, right) => left.registrationNumber.localeCompare(right.registrationNumber, 'lt'));
  }

  async listClients(): Promise<ClientDirectoryEntry[]> {
    const [assignmentSnapshot, storedSnapshot] = await Promise.all([
      this.assignments.get(),
      this.clients.get(),
    ]);
    const storedEntries = storedSnapshot.docs.map((document) => document.data() as StoredClientDirectoryEntry);
    const storedByClient = new Map<string, StoredClientDirectoryEntry[]>();
    for (const entry of storedEntries) {
      const key = clientDirectoryKey(entry.name, entry.address);
      storedByClient.set(key, [...(storedByClient.get(key) ?? []), entry]);
    }
    const observed = new Map<string, {
      id: string;
      name: string;
      address: string;
      phone: string | null;
      visits: Set<string>;
      firstSeenAt: string;
      lastSeenAt: string;
      lastDeliveredAt: string | null;
    }>();

    for (const document of assignmentSnapshot.docs) {
      const assignment = document.data() as RouteAssignment;
      if (assignment.status === 'cancelled') continue;
      for (const stop of assignment.routeSnapshot.stops) {
        const name = optionalText(stop.recipient);
        const address = optionalText(stop.normalized_address)
          ?? optionalText(stop.address)
          ?? optionalText(stop.original_address);
        if (!name && !address) continue;
        const id = clientDirectoryId(name ?? 'Klientas', address ?? 'Adresas nenurodytas');
        const deliveredAt = optionalText(stop.delivered_at);
        const seenAt = deliveredAt ?? assignment.updatedAt ?? assignment.assignedAt;
        const current = observed.get(id);
        if (current) {
          if (name) current.name = preferredClientName(current.name, name);
          current.visits.add(assignment.routeId);
          if (seenAt < current.firstSeenAt) current.firstSeenAt = seenAt;
          if (seenAt > current.lastSeenAt) current.lastSeenAt = seenAt;
          if (deliveredAt && (!current.lastDeliveredAt || deliveredAt > current.lastDeliveredAt)) current.lastDeliveredAt = deliveredAt;
          if (!current.phone) current.phone = optionalText(stop.phone);
        } else {
          observed.set(id, {
            id,
            name: name ?? 'Klientas nenurodytas',
            address: address ?? 'Adresas nenurodytas',
            phone: optionalText(stop.phone),
            visits: new Set([assignment.routeId]),
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
            lastDeliveredAt: deliveredAt,
          });
        }
      }
    }

    const now = new Date().toISOString();
    let batch = this.db.batch();
    let pendingWrites = 0;
    const result: ClientDirectoryEntry[] = [];
    const consumedStoredKeys = new Set<string>();
    const flushBatch = async () => {
      if (pendingWrites === 0) return;
      await batch.commit();
      batch = this.db.batch();
      pendingWrites = 0;
    };
    const queueSet = async (entry: StoredClientDirectoryEntry) => {
      batch.set(this.clients.doc(entry.id), entry, { merge: true });
      pendingWrites += 1;
      if (pendingWrites >= 400) await flushBatch();
    };
    const queueDelete = async (id: string) => {
      batch.delete(this.clients.doc(id));
      pendingWrites += 1;
      if (pendingWrites >= 400) await flushBatch();
    };
    for (const client of observed.values()) {
      const storedKey = clientDirectoryKey(client.name, client.address);
      const savedEntries = storedByClient.get(storedKey) ?? [];
      const saved = mergeStoredClientEntries(savedEntries);
      consumedStoredKeys.add(storedKey);
      const merged: StoredClientDirectoryEntry = {
        id: client.id,
        name: saved ? preferredClientName(client.name, saved.name) : client.name,
        address: preferredClientAddress(client.address, saved?.address),
        phone: saved?.phone ?? client.phone,
        email: saved?.email ?? null,
        contactPerson: saved?.contactPerson ?? null,
        visitCount: Math.max(client.visits.size, saved?.visitCount ?? 0),
        firstSeenAt: saved && saved.firstSeenAt < client.firstSeenAt ? saved.firstSeenAt : client.firstSeenAt,
        lastSeenAt: saved && saved.lastSeenAt > client.lastSeenAt ? saved.lastSeenAt : client.lastSeenAt,
        lastDeliveredAt: latestOptionalDate(saved?.lastDeliveredAt ?? null, client.lastDeliveredAt),
        updatedAt: saved?.updatedAt ?? now,
        updatedBy: saved?.updatedBy ?? null,
      };
      await queueSet(merged);
      for (const legacy of savedEntries) {
        if (legacy.id !== merged.id) await queueDelete(legacy.id);
      }
      result.push(merged);
    }
    for (const [key, entries] of storedByClient) {
      if (consumedStoredKeys.has(key)) continue;
      const saved = mergeStoredClientEntries(entries);
      if (!saved) continue;
      const canonical: StoredClientDirectoryEntry = {
        ...saved,
        id: clientDirectoryId(saved.name, saved.address),
      };
      await queueSet(canonical);
      for (const legacy of entries) {
        if (legacy.id !== canonical.id) await queueDelete(legacy.id);
      }
      result.push(canonical);
    }
    await flushBatch();
    return result.sort((left, right) => {
      const leftMissing = left.phone || left.email ? 1 : 0;
      const rightMissing = right.phone || right.email ? 1 : 0;
      return leftMissing - rightMissing || left.name.localeCompare(right.name, 'lt') || left.address.localeCompare(right.address, 'lt');
    });
  }

  async updateClient(profile: EmployeeProfile, clientIdInput: string, input: {
    phone?: string | null;
    email?: string | null;
    contactPerson?: string | null;
  }): Promise<ClientDirectoryEntry> {
    const clientId = safeId(clientIdInput);
    await this.listClients();
    const reference = this.clients.doc(clientId);
    const document = await reference.get();
    const current = document.data() as StoredClientDirectoryEntry | undefined;
    if (!current) throw new EmployeeApiError('CLIENT_NOT_FOUND', 'Klientas nerastas.', 404);
    const updated: StoredClientDirectoryEntry = {
      ...current,
      phone: input.phone === undefined ? current.phone : optionalText(input.phone),
      email: input.email === undefined ? current.email : optionalText(input.email),
      contactPerson: input.contactPerson === undefined ? current.contactPerson : optionalText(input.contactPerson),
      updatedAt: new Date().toISOString(),
      updatedBy: profile.id,
    };
    await reference.set(updated);
    return updated;
  }

  async createVehicle(input: {
    registrationNumber: string;
    model: string;
    maximumPayloadKg: number;
    fuelNormLPer100Km?: number | null;
    fuelTankCapacityLiters?: number | null;
    cargoBodyKind?: string | null;
    palletCapacity?: number | null;
    hasSideDoor?: boolean;
    cargoLengthMm?: number | null;
    cargoWidthMm?: number | null;
    cargoBodyType?: string | null;
    wheelArchStartMm?: number | null;
    wheelArchEndMm?: number | null;
    wheelArchIntrusionMm?: number | null;
  }): Promise<FleetVehicle> {
    const registrationNumber = validateRegistrationNumber(input.registrationNumber);
    const model = validateVehicleModel(input.model);
    const maximumPayloadKg = validateMaximumPayload(input.maximumPayloadKg);
    const fuelNormLPer100Km = validateFuelNorm(input.fuelNormLPer100Km);
    const fuelTankCapacityLiters = validateFuelTankCapacity(
      input.fuelTankCapacityLiters ?? fleetTankCapacity(registrationNumber),
    );
    const cargo = resolveVehicleCargo({
      registrationNumber,
      palletCapacity: input.palletCapacity,
      cargoBodyKind: input.cargoBodyKind,
      hasSideDoor: input.hasSideDoor,
    });
    const palletCapacity = cargo.palletCapacity;
    const cargoBodyKind = bodyKindFromPalletCapacity(palletCapacity);
    const hasSideDoor = cargo.hasSideDoor;
    const reference = this.vehicles.doc(registrationNumber);
    const now = new Date().toISOString();
    const vehicle: FleetVehicle = {
      id: registrationNumber,
      registrationNumber,
      model,
      maximumPayloadKg,
      fuelNormLPer100Km,
      fuelTankCapacityLiters,
      cargoBodyKind,
      palletCapacity,
      hasSideDoor,
      cargoLengthMm: validateMillimetres(input.cargoLengthMm, 'ilgis'),
      cargoWidthMm: validateMillimetres(input.cargoWidthMm, 'plotis'),
      cargoBodyType: input.cargoBodyType === 'box' ? 'box' : 'van',
      wheelArchStartMm: validateMillimetres(input.wheelArchStartMm, 'arkos pradžia'),
      wheelArchEndMm: validateMillimetres(input.wheelArchEndMm, 'arkos pabaiga'),
      wheelArchIntrusionMm: validateMillimetres(input.wheelArchIntrusionMm, 'arkos plotis'),
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

      let previousAssignmentDocs: { id: string; ref: FirebaseFirestore.DocumentReference }[] = [];
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
    fuelNormLPer100Km?: number | null;
    fuelTankCapacityLiters?: number | null;
    cargoBodyKind?: string | null;
    palletCapacity?: number | null;
    hasSideDoor?: boolean;
    cargoLengthMm?: number | null;
    cargoWidthMm?: number | null;
    cargoBodyType?: string | null;
    wheelArchStartMm?: number | null;
    wheelArchEndMm?: number | null;
    wheelArchIntrusionMm?: number | null;
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
      const fuelNormLPer100Km = input.fuelNormLPer100Km === undefined
        ? current.fuelNormLPer100Km
        : validateFuelNorm(input.fuelNormLPer100Km);
      const fuelTankCapacityLiters = input.fuelTankCapacityLiters === undefined
        ? resolveFuelTankCapacity({
          registrationNumber,
          fuelTankCapacityLiters: current.fuelTankCapacityLiters,
        })
        : validateFuelTankCapacity(input.fuelTankCapacityLiters ?? fleetTankCapacity(registrationNumber));
      const cargo = resolveVehicleCargo({
        registrationNumber,
        palletCapacity: input.palletCapacity !== undefined
          ? validatePalletCapacity(input.palletCapacity)
          : current.palletCapacity,
        cargoBodyKind: input.cargoBodyKind === undefined
          ? current.cargoBodyKind
          : validateCargoBodyKind(input.cargoBodyKind),
        hasSideDoor: input.hasSideDoor === undefined ? current.hasSideDoor : input.hasSideDoor === true,
      });
      const palletCapacity = cargo.palletCapacity;
      const cargoBodyKind = bodyKindFromPalletCapacity(palletCapacity);
      const hasSideDoor = cargo.hasSideDoor;
      const cargoFloor = {
        cargoLengthMm: input.cargoLengthMm === undefined
          ? current.cargoLengthMm : validateMillimetres(input.cargoLengthMm, 'ilgis'),
        cargoWidthMm: input.cargoWidthMm === undefined
          ? current.cargoWidthMm : validateMillimetres(input.cargoWidthMm, 'plotis'),
        cargoBodyType: input.cargoBodyType === undefined
          ? current.cargoBodyType : (input.cargoBodyType === 'box' ? 'box' as const : 'van' as const),
        wheelArchStartMm: input.wheelArchStartMm === undefined
          ? current.wheelArchStartMm : validateMillimetres(input.wheelArchStartMm, 'arkos pradžia'),
        wheelArchEndMm: input.wheelArchEndMm === undefined
          ? current.wheelArchEndMm : validateMillimetres(input.wheelArchEndMm, 'arkos pabaiga'),
        wheelArchIntrusionMm: input.wheelArchIntrusionMm === undefined
          ? current.wheelArchIntrusionMm : validateMillimetres(input.wheelArchIntrusionMm, 'arkos plotis'),
      };
      const updatedAt = new Date().toISOString();
      updated = {
        ...current,
        id: registrationNumber,
        registrationNumber,
        model,
        maximumPayloadKg,
        fuelNormLPer100Km,
        fuelTankCapacityLiters,
        ...cargoFloor,
        cargoBodyKind,
        palletCapacity,
        hasSideDoor,
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

  async deleteVehicle(vehicleIdInput: string): Promise<FleetVehicle> {
    const vehicleId = validateVehicleId(vehicleIdInput);
    const reference = this.vehicles.doc(vehicleId);
    const document = await reference.get();
    const stored = document.data() as FleetVehicle | undefined;
    const vehicle = stored ? normalizeVehicle(stored) : undefined;
    if (!vehicle) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);

    const assignments = await this.assignments.get();
    const activeAssignment = assignments.docs
      .map((item) => item.data() as RouteAssignment)
      .find((assignment) => !['completed', 'cancelled'].includes(assignment.status) && assignment.vehicle?.id === vehicleId);
    if (activeAssignment) {
      throw new EmployeeApiError('VEHICLE_IN_USE', 'Automobilis naudojamas aktyviame maršrute. Pirmiausia užbaikite arba pašalinkite priskyrimą.', 409);
    }
    await reference.delete();
    return vehicle;
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
      effectiveAt: now,
      kind: 'driver_report',
      note: null,
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
      .map((document) => normalizeFuelReport(document.data() as FuelReport))
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt));
  }

  async reportVehicleFault(profile: EmployeeProfile, input: {
    localId?: string | null;
    vehicleId?: string | null;
    registrationNumber?: string | null;
    comment: string;
    reportedAt?: string | null;
  }): Promise<VehicleFaultReport> {
    const comment = optionalText(input.comment);
    if (!comment) throw new EmployeeApiError('INVALID_FAULT', 'Įveskite gedimo aprašymą.', 400);
    const report: VehicleFaultReport = {
      id: randomUUID(),
      localId: optionalText(input.localId ?? null),
      vehicleId: optionalText(input.vehicleId ?? null) ?? '',
      registrationNumber: optionalText(input.registrationNumber ?? null) ?? '',
      comment,
      reportedBy: profile.id,
      reportedByName: profile.displayName,
      reportedAt: input.reportedAt?.trim() || new Date().toISOString(),
    };
    await this.vehicleFaults.doc(report.id).set(report);
    return report;
  }

  async listVehicleFaults(): Promise<VehicleFaultReport[]> {
    const snapshot = await this.vehicleFaults.get();
    return snapshot.docs
      .map((document) => document.data() as VehicleFaultReport)
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt));
  }

  async requestDepartureOverride(profile: EmployeeProfile, input: {
    localId?: string | null;
    vehicleId?: string | null;
    registrationNumber?: string | null;
    fingerprint: string;
    summary: string;
    requestedAt?: string | null;
  }): Promise<DepartureOverrideRecord> {
    const fingerprint = optionalText(input.fingerprint);
    const summary = optionalText(input.summary);
    if (!fingerprint || !summary) {
      throw new EmployeeApiError('INVALID_OVERRIDE', 'Nenurodyti pasibaigę terminai.', 400);
    }
    const existing = await this.findDepartureOverride(fingerprint, {
      localId: input.localId,
      vehicleId: input.vehicleId,
      registrationNumber: input.registrationNumber,
    });
    if (existing) return existing;
    const now = new Date().toISOString();
    const record: DepartureOverrideRecord = {
      id: randomUUID(),
      localId: optionalText(input.localId ?? null),
      vehicleId: optionalText(input.vehicleId ?? null) ?? '',
      registrationNumber: optionalText(input.registrationNumber ?? null) ?? '',
      fingerprint,
      summary,
      status: 'pending',
      requestedBy: profile.id,
      requestedByName: profile.displayName,
      requestedAt: input.requestedAt?.trim() || now,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      note: null,
    };
    await this.departureOverrides.doc(record.id).set(record);
    return record;
  }

  async approveDepartureOverride(profile: EmployeeProfile, input: {
    id?: string | null;
    localId?: string | null;
    vehicleId?: string | null;
    registrationNumber?: string | null;
    fingerprint: string;
    summary: string;
    note?: string | null;
  }): Promise<DepartureOverrideRecord> {
    const fingerprint = optionalText(input.fingerprint);
    const summary = optionalText(input.summary);
    if (!fingerprint || !summary) {
      throw new EmployeeApiError('INVALID_OVERRIDE', 'Nenurodyti pasibaigę terminai.', 400);
    }
    const existing = input.id
      ? await this.getDepartureOverride(input.id)
      : await this.findDepartureOverride(fingerprint, {
        localId: input.localId,
        vehicleId: input.vehicleId,
        registrationNumber: input.registrationNumber,
      });
    const now = new Date().toISOString();
    if (existing) {
      if (existing.status === 'approved') return existing;
      const updated: DepartureOverrideRecord = {
        ...existing,
        fingerprint,
        summary,
        status: 'approved',
        approvedBy: profile.id,
        approvedByName: profile.displayName,
        approvedAt: now,
        note: optionalText(input.note ?? existing.note),
      };
      await this.departureOverrides.doc(existing.id).set(updated);
      return updated;
    }
    const record: DepartureOverrideRecord = {
      id: randomUUID(),
      localId: optionalText(input.localId ?? null),
      vehicleId: optionalText(input.vehicleId ?? null) ?? '',
      registrationNumber: optionalText(input.registrationNumber ?? null) ?? '',
      fingerprint,
      summary,
      status: 'approved',
      requestedBy: profile.id,
      requestedByName: profile.displayName,
      requestedAt: now,
      approvedBy: profile.id,
      approvedByName: profile.displayName,
      approvedAt: now,
      note: optionalText(input.note ?? null),
    };
    await this.departureOverrides.doc(record.id).set(record);
    return record;
  }

  async reviewDepartureOverride(id: string, profile: EmployeeProfile, note?: string | null): Promise<DepartureOverrideRecord> {
    const existing = await this.getDepartureOverride(id);
    if (!existing) throw new EmployeeApiError('OVERRIDE_NOT_FOUND', 'Išvykimo patvirtinimas nerastas.', 404);
    return this.approveDepartureOverride(profile, {
      id: existing.id,
      fingerprint: existing.fingerprint,
      summary: existing.summary,
      note,
    });
  }

  async getDepartureOverride(id: string): Promise<DepartureOverrideRecord | null> {
    const document = await this.departureOverrides.doc(id).get();
    return document.exists ? document.data() as DepartureOverrideRecord : null;
  }

  async findDepartureOverride(fingerprint: string, match: {
    localId?: string | null;
    vehicleId?: string | null;
    registrationNumber?: string | null;
  }): Promise<DepartureOverrideRecord | null> {
    const snapshot = await this.departureOverrides.get();
    const records = snapshot.docs.map((document) => document.data() as DepartureOverrideRecord);
    const localId = optionalText(match.localId ?? null);
    const vehicleId = optionalText(match.vehicleId ?? null);
    const registrationNumber = optionalText(match.registrationNumber ?? null)?.toUpperCase();
    const matching = records.filter((record) => {
      if (record.fingerprint !== fingerprint) return false;
      if (localId && record.localId === localId) return true;
      if (vehicleId && record.vehicleId === vehicleId) return true;
      if (registrationNumber && record.registrationNumber.toUpperCase() === registrationNumber) return true;
      return false;
    });
    matching.sort((left, right) => {
      const rank = (record: DepartureOverrideRecord) => record.status === 'approved' ? 0 : 1;
      return rank(left) - rank(right) || right.requestedAt.localeCompare(left.requestedAt);
    });
    return matching[0] ?? null;
  }

  async getLatestDepartureOverride(match: {
    vehicleId?: string | null;
    registrationNumber?: string | null;
  }): Promise<DepartureOverrideRecord | null> {
    const snapshot = await this.departureOverrides.get();
    const vehicleId = optionalText(match.vehicleId ?? null);
    const registrationNumber = optionalText(match.registrationNumber ?? null)?.toUpperCase();
    const matching = snapshot.docs
      .map((document) => document.data() as DepartureOverrideRecord)
      .filter((record) => {
        if (vehicleId && record.vehicleId === vehicleId) return true;
        if (registrationNumber && record.registrationNumber.toUpperCase() === registrationNumber) return true;
        return false;
      })
      .sort((left, right) => {
        const leftAt = left.approvedAt ?? left.requestedAt;
        const rightAt = right.approvedAt ?? right.requestedAt;
        return rightAt.localeCompare(leftAt);
      });
    return matching[0] ?? null;
  }

  async listDepartureOverrides(): Promise<DepartureOverrideRecord[]> {
    const snapshot = await this.departureOverrides.get();
    return snapshot.docs
      .map((document) => document.data() as DepartureOverrideRecord)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  /**
   * An administrator writing down what the tank really held on a given day.
   * The driver-side flow can only report the balance right now, which leaves no
   * way to open a month on a known figure or to fix a reading after the fact.
   *
   * It is recorded as already approved: the administrator entering it IS the
   * approval, and it stays in the same log as the driver reports so the trail
   * shows who changed the balance, when, and why.
   */
  async correctFuelBalance(reviewer: EmployeeProfile, input: {
    vehicleId: string;
    liters: number;
    effectiveAt: string;
    note?: string | null;
  }): Promise<FuelReport> {
    const liters = validateFuelLiters(input.liters);
    const effectiveAt = validateEffectiveDate(input.effectiveAt);
    const vehicleRef = this.vehicles.doc(validateVehicleId(input.vehicleId));
    const vehicleDocument = await vehicleRef.get();
    const storedVehicle = vehicleDocument.data() as FleetVehicle | undefined;
    const vehicle = storedVehicle ? normalizeVehicle(storedVehicle) : null;
    if (!vehicle) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);

    const now = new Date().toISOString();
    const report: FuelReport = {
      id: randomUUID(),
      driverId: vehicle.assignedDriverId ?? reviewer.id,
      driverName: reviewer.displayName,
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      assignmentRevision: vehicle.assignmentRevision,
      previousLiters: vehicle.fuelRemainingLiters,
      reportedLiters: liters,
      status: 'approved',
      reportedAt: now,
      reviewedAt: now,
      reviewedBy: reviewer.id,
      effectiveAt,
      kind: 'admin_correction',
      note: optionalText(input.note ?? null),
    };

    const batch = this.db.batch();
    batch.create(this.fuelReports.doc(report.id), report);
    // Only move the vehicle's current balance when the correction is not
    // back-dated behind a newer reading; otherwise it stays purely historical
    // and just anchors the older period.
    if (!vehicle.fuelUpdatedAt || effectiveAt >= vehicle.fuelUpdatedAt.slice(0, 10)) {
      batch.update(vehicleRef, { fuelRemainingLiters: liters, fuelUpdatedAt: now, updatedAt: now });
    }
    await batch.commit();
    return report;
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
    validateNewPin(input.pin);
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

  async updateUser(userId: string, input: { username?: string; displayName?: string; role?: EmployeeRole; disabled?: boolean; pin?: string; permissions?: Partial<EmployeePermissions>; email?: string; phone?: string; compensation?: DriverCompensationRates | null }): Promise<EmployeeProfile> {
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
    if (input.compensation !== undefined) patch.compensation = validateCompensationInput(input.compensation);
    if (input.pin !== undefined) {
      validateNewPin(input.pin);
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

  async deleteUser(userIdInput: string): Promise<EmployeeProfile> {
    const userId = safeId(userIdInput);
    const reference = this.users.doc(userId);
    const document = await reference.get();
    const current = document.data() as StoredUser | undefined;
    if (!current) throw new EmployeeApiError('USER_NOT_FOUND', 'Darbuotojas nerastas.', 404);

    const assignments = await this.assignments.where('driverId', '==', userId).get();
    const activeAssignment = assignments.docs
      .map((item) => item.data() as RouteAssignment)
      .find((assignment) => !['completed', 'cancelled'].includes(assignment.status));
    if (activeAssignment) {
      throw new EmployeeApiError('USER_HAS_ACTIVE_ROUTE', 'Darbuotojas turi aktyvų maršrutą. Pirmiausia užbaikite arba pašalinkite priskyrimą.', 409);
    }

    const [sessions, assignedVehicles] = await Promise.all([
      this.sessions.where('userId', '==', userId).get(),
      this.vehicles.where('assignedDriverId', '==', userId).get(),
    ]);
    const batch = this.db.batch();
    sessions.docs.forEach((session) => batch.delete(session.ref));
    assignedVehicles.docs.forEach((vehicle) => batch.update(vehicle.ref, {
      assignedDriverId: null,
      updatedAt: new Date().toISOString(),
    }));
    batch.delete(this.usernames.doc(current.username));
    batch.delete(reference);
    await batch.commit();
    return publicProfile(current);
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

  /**
   * Closes an assignment. Optional startedAt/completedAt are for admin
   * historical backfill so tripSheetWorkDate stays on that Lithuanian day.
   * Omitted timestamps keep the live same-day stamp (completed_at = now).
   */
  async completeAssignment(
    assignmentId: string,
    input: AdminCompleteAssignmentInput = {},
    options: { rewriteCompleted?: boolean } = {},
  ): Promise<RouteAssignment> {
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment) throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    if (assignment.status === 'completed' && !options.rewriteCompleted) return assignment;
    if (assignment.status === 'cancelled') {
      throw new EmployeeApiError('ASSIGNMENT_CANCELLED', 'Atšaukto maršruto užbaigti negalima.', 409);
    }
    let completed;
    try {
      completed = applyAdminAssignmentComplete(assignment.routeSnapshot, input, new Date().toISOString());
    } catch (error) {
      if (error instanceof HistoricalCompleteError) {
        throw new EmployeeApiError(error.code, error.message, 400);
      }
      throw error;
    }
    const routeSnapshot: RouteSnapshot = {
      ...assignment.routeSnapshot,
      route: completed.route,
      stops: completed.stops,
    };
    const updated = {
      ...assignment,
      status: 'completed' as const,
      routeSnapshot,
      progress: completed.progress,
      updatedAt: completed.updatedAt,
    };
    await reference.set(updated);
    return updated;
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

  async updateAssignmentSchedule(assignmentId: string, dateInput: string): Promise<RouteAssignment> {
    const reference = this.assignments.doc(safeId(assignmentId));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment) throw new EmployeeApiError('ASSIGNMENT_NOT_FOUND', 'Maršruto priskyrimas nerastas.', 404);
    if (['in_progress', 'completed', 'cancelled'].includes(assignment.status)) {
      throw new EmployeeApiError('ASSIGNMENT_ALREADY_STARTED', 'Pradėto arba užbaigto maršruto datos keisti nebegalima.', 409);
    }
    const date = validateRouteDate(dateInput);
    const currentDeparture = optionalText(assignment.routeSnapshot.route.planned_departure_at);
    const plannedDepartureAt = currentDeparture && /^\d{4}-\d{2}-\d{2}T/.test(currentDeparture)
      ? `${date}${currentDeparture.slice(10)}`
      : currentDeparture;
    const updatedAt = new Date().toISOString();
    const routeSnapshot: RouteSnapshot = {
      ...assignment.routeSnapshot,
      route: {
        ...assignment.routeSnapshot.route,
        date,
        ...(plannedDepartureAt ? { planned_departure_at: plannedDepartureAt } : {}),
        updated_at: updatedAt,
      },
    };
    const updated = { ...assignment, routeSnapshot, updatedAt };
    await reference.set(updated);
    return updated;
  }

  async listAssignments(profile: EmployeeProfile): Promise<RouteAssignment[]> {
    const snapshot = profile.role === 'driver'
      ? await this.assignments.where('driverId', '==', profile.id).get()
      : await this.assignments.get();
    const vehicles = await this.listVehicles();
    const liveById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicleSnapshot(vehicle)]));
    return snapshot.docs
      .map((doc) => withLiveVehicleCargo(doc.data() as RouteAssignment, liveById))
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  }

  async listTripSheets(profile: EmployeeProfile): Promise<ServerTripSheet[]> {
    const assignments = (await this.listAssignments(profile)).filter((assignment) => assignment.status === 'completed');
    const vehicles = await this.listVehicles();
    // Fixture data is created explicitly during database initialization. It
    // must not be reseeded while reading reports, otherwise a deleted day
    // reappears in the odometer history.
    const currentVehicles = new Map(
      vehicles.filter((vehicle) => vehicle.assignedDriverId).map((vehicle) => [vehicle.assignedDriverId!, vehicleSnapshot(vehicle)]),
    );
    const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const priceSettings = await this.getRoutePriceSettings();
    const [fuelSnapshot, readingSnapshot, fuelReportSnapshot] = await Promise.all([
      this.fuelEntries.get(),
      this.vehicleDayReadings.get(),
      this.fuelReports.get(),
    ]);
    const readings = readingSnapshot.docs.map((document) => document.data() as VehicleDayReading);
    const visibleReadings = readings.filter((reading) => isReadingVisibleTo(profile, reading, vehiclesById.get(reading.vehicleId) ?? null));
    const visibleAssignmentIds = new Set(assignments.map((assignment) => assignment.id));
    const allEntries = fuelSnapshot.docs.map((document) => document.data() as ServerFuelEntry);
    const entriesByAssignment = new Map<string, ServerFuelEntry[]>();
    const entriesByVehicleDate = new Map<string, ServerFuelEntry[]>();
    for (const entry of allEntries) {
      const vehicleDay = parseVehicleDayAssignmentId(entry.assignmentId);
      const date = vehicleDay?.date ?? entry.filledAt.slice(0, 10);
      const vehicleDateKey = `${entry.vehicleId}:${date}`;
      entriesByVehicleDate.set(vehicleDateKey, [...(entriesByVehicleDate.get(vehicleDateKey) ?? []), entry]);
      if (visibleAssignmentIds.has(entry.assignmentId) || parseVehicleDayAssignmentId(entry.assignmentId)) {
        entriesByAssignment.set(entry.assignmentId, [...(entriesByAssignment.get(entry.assignmentId) ?? []), entry]);
      }
    }
    const fuelReports = fuelReportSnapshot.docs.map((document) => normalizeFuelReport(document.data() as FuelReport));
    const sheets = assignments
      .map((assignment) => buildServerTripSheet(assignment, assignment.vehicle ?? currentVehicles.get(assignment.driverId) ?? null))
      .map((sheet) => applyDayReading(sheet, visibleReadings))
      .map((sheet) => ({
        ...sheet,
        fuelNormLitersPer100Km: tripSheetFuelNorm(sheet.vehicle, priceSettings),
        fuelAnchor: sheet.vehicle ? fuelAnchorFor(fuelReports, sheet.vehicle.id, sheet.date) : null,
        fuelEntries: fuelEntriesForSheet(sheet, entriesByAssignment, entriesByVehicleDate),
      }));
    const covered = new Set(sheets.map((sheet) => `${sheet.vehicle?.id ?? ''}:${sheet.date}`));
    const synthetic = visibleReadings
      .filter((reading) => !covered.has(`${reading.vehicleId}:${reading.date}`)
        && !odometerReadingCoveredBySheet(reading, sheets))
      .map((reading) => {
        const vehicle = vehiclesById.get(reading.vehicleId) ?? null;
        const sheet = buildVehicleDayTripSheet(reading, vehicle ? vehicleSnapshot(vehicle) : null);
        return {
          ...sheet,
          fuelNormLitersPer100Km: tripSheetFuelNorm(sheet.vehicle, priceSettings),
          fuelAnchor: sheet.vehicle ? fuelAnchorFor(fuelReports, sheet.vehicle.id, sheet.date) : null,
          fuelEntries: fuelEntriesForSheet(sheet, entriesByAssignment, entriesByVehicleDate),
        };
      });
    const coveredAfterReadings = new Set([
      ...covered,
      ...synthetic.map((sheet) => `${sheet.vehicle?.id ?? ''}:${sheet.date}`),
    ]);
    const fuelOnly = uncoveredFuelDayKeys(entriesByVehicleDate, coveredAfterReadings).flatMap((key) => {
      const parsed = parseVehicleDateKey(key);
      if (!parsed) return [];
      const vehicle = vehiclesById.get(parsed.vehicleId) ?? null;
      const dayEntries = entriesByVehicleDate.get(key) ?? [];
      const driverId = vehicle?.assignedDriverId ?? dayEntries[0]?.driverId ?? null;
      if (!isOwnedByDriver(profile, driverId, vehicle)) return [];
      const sheet = buildFuelDayTripSheet({
        vehicleId: parsed.vehicleId,
        date: parsed.date,
        vehicle: vehicle ? vehicleSnapshot(vehicle) : null,
        driverId,
        driverName: dayEntries[0]?.driverName ?? null,
      });
      return [{
        ...sheet,
        fuelNormLitersPer100Km: tripSheetFuelNorm(sheet.vehicle, priceSettings),
        fuelAnchor: sheet.vehicle ? fuelAnchorFor(fuelReports, sheet.vehicle.id, sheet.date) : null,
        fuelEntries: fuelEntriesForSheet(sheet, entriesByAssignment, entriesByVehicleDate),
      }];
    });
    const combined = [...sheets, ...synthetic, ...fuelOnly]
      .sort((left, right) => (right.completedAt ?? right.date).localeCompare(left.completedAt ?? left.date));
    const canViewCompensation = profile.role !== 'driver' || profile.permissions.canViewCompensation;
    if (!canViewCompensation) return combined;
    const driverIds = new Set(combined.map((sheet) => sheet.driverId));
    const rates = new Map<string, DriverCompensationRates | null>();
    for (const document of (await this.users.get()).docs) {
      const user = document.data() as StoredUser;
      if (driverIds.has(user.id)) rates.set(user.id, normalizeCompensation(user.compensation));
    }
    return attachDailyCompensation(combined, rates);
  }

  async upsertVehicleDayReading(profile: EmployeeProfile, input: {
    vehicleId: string;
    date: string;
    startOdometer: number;
    endOdometer: number;
    driverId?: string | null;
  }): Promise<VehicleDayReading> {
    const date = validateRouteDate(input.date);
    const startOdometer = validateDayOdometer(input.startOdometer);
    const endOdometer = validateDayOdometer(input.endOdometer);
    if (endOdometer < startOdometer) {
      throw new EmployeeApiError('INVALID_ODOMETER', 'Odometro pabaiga negali būti mažesnė už pradžią.', 400);
    }
    const vehicleDocument = await this.vehicles.doc(validateVehicleId(input.vehicleId)).get();
    const stored = vehicleDocument.data() as FleetVehicle | undefined;
    const vehicle = stored ? normalizeVehicle(stored) : undefined;
    if (!vehicle) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);
    const driver = await this.resolveReadingDriver(vehicle, input.driverId);
    assertCanEditTripReadings(profile, vehicle, driver.id);
    const now = new Date().toISOString();
    const id = `${vehicle.id}:${date}`;
    const existing = (await this.vehicleDayReadings.doc(id).get()).data() as VehicleDayReading | undefined;
    const reading: VehicleDayReading = {
      id,
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      date,
      startOdometer,
      endOdometer,
      distanceKm: odometerDistanceKm(startOdometer, endOdometer),
      ...(extraDistanceKmOf(existing) > 0 ? { extraDistanceKm: extraDistanceKmOf(existing) } : {}),
      driverId: driver.id,
      driverName: driver.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: existing?.createdBy ?? profile.id,
    };
    await this.vehicleDayReadings.doc(id).set(reading);
    return reading;
  }

  /**
   * Removes a synthetic trip-sheet day that was never a real assigned route —
   * an odometer/fuel log entry with no resolvable driver (shown as
   * "Nepriskirtas" in reports). Deletes both the day reading and any fuel
   * entries recorded for that vehicle on that date, so the day stops
   * reappearing in /api/trip-sheets once the seed calls that created it are
   * no longer re-run.
   */
  async deleteUnassignedTripDay(vehicleId: string, dateInput: string): Promise<void> {
    const date = validateRouteDate(dateInput);
    const id = `${validateVehicleId(vehicleId)}:${date}`;
    await this.vehicleDayReadings.doc(id).delete();
    const fuelSnapshot = await this.fuelEntries.where('vehicleId', '==', vehicleId).get();
    const staleEntries = fuelSnapshot.docs
      .map((document) => document.data() as ServerFuelEntry)
      .filter((entry) => entry.filledAt.slice(0, 10) === date);
    await Promise.all(staleEntries.map((entry) => this.fuelEntries.doc(entry.id).delete()));
  }

  async addFuelEntry(profile: EmployeeProfile, assignmentIdInput: string, input: {
    filledAt: string;
    odometer?: number;
    liters: number;
    pricePerLiter?: number;
    station?: string;
    receiptNumber?: string;
    notes?: string;
  }): Promise<ServerFuelEntry> {
    const filledAt = new Date(input.filledAt);
    if (Number.isNaN(filledAt.getTime())) throw new EmployeeApiError('INVALID_FUEL_DATE', 'Neteisinga kuro pylimo data.', 400);
    if (!Number.isFinite(input.liters) || input.liters <= 0 || input.liters > 1_000) throw new EmployeeApiError('INVALID_FUEL_AMOUNT', 'Įpilto kuro kiekis turi būti nuo 0,1 iki 1000 litrų.', 400);
    if (input.pricePerLiter !== undefined && (!Number.isFinite(input.pricePerLiter) || input.pricePerLiter < 0 || input.pricePerLiter > 100)) throw new EmployeeApiError('INVALID_FUEL_PRICE', 'Neteisinga litro kaina.', 400);
    if (input.odometer !== undefined) validateDayOdometer(input.odometer);

    const assignmentId = String(assignmentIdInput ?? '').trim();
    const vehicleDay = parseVehicleDayAssignmentId(assignmentId);
    let vehicle: FleetVehicleSnapshot | null = null;
    let driverId = '';
    let driverName = '';
    let routeId = assignmentId;
    let resolvedAssignmentId = assignmentId;
    let odometer = input.odometer;

    if (vehicleDay) {
      const storedVehicle = (await this.vehicles.doc(vehicleDay.vehicleId).get()).data() as FleetVehicle | undefined;
      const live = storedVehicle ? normalizeVehicle(storedVehicle) : undefined;
      if (!live) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);
      vehicle = vehicleSnapshot(live);
      const readingDoc = await this.vehicleDayReadings.doc(`${live.id}:${vehicleDay.date}`).get();
      const storedReading = readingDoc.data() as VehicleDayReading | undefined;
      driverId = storedReading?.driverId ?? live.assignedDriverId ?? profile.id;
      driverName = storedReading?.driverName ?? profile.displayName;
      odometer = odometer ?? storedReading?.endOdometer ?? storedReading?.startOdometer ?? 0;
      assertCanEditTripReadings(profile, live, driverId);
    } else {
      resolvedAssignmentId = safeId(assignmentIdInput);
      const assignmentDocument = await this.assignments.doc(resolvedAssignmentId).get();
      const assignment = assignmentDocument.data() as RouteAssignment | undefined;
      if (!assignment || assignment.status !== 'completed') throw new EmployeeApiError('TRIP_SHEET_NOT_FOUND', 'Užbaigtas kelionės lapas nerastas.', 404);
      driverId = assignment.driverId;
      driverName = assignment.driverName;
      routeId = assignment.routeId;
      const assigned = assignment.vehicle ?? await this.findAssignedVehicleSnapshot(assignment.driverId);
      if (!assigned) throw new EmployeeApiError('VEHICLE_NOT_ASSIGNED', 'Kelionės lapui nepriskirtas automobilis.', 409);
      vehicle = assigned;
      const storedVehicle = (await this.vehicles.doc(assigned.id).get()).data() as FleetVehicle | undefined;
      assertCanEditTripReadings(profile, storedVehicle ? normalizeVehicle(storedVehicle) : {
        assignedDriverId: driverId,
      }, driverId);
      if (odometer === undefined) {
        const date = filledAt.toISOString().slice(0, 10);
        const readingDoc = await this.vehicleDayReadings.doc(`${assigned.id}:${date}`).get();
        const storedReading = readingDoc.data() as VehicleDayReading | undefined;
        odometer = storedReading?.endOdometer
          ?? nullableNumber(assignment.routeSnapshot.route.end_odometer)
          ?? nullableNumber(assignment.routeSnapshot.route.start_odometer)
          ?? 0;
      }
    }
    if (!vehicle) throw new EmployeeApiError('VEHICLE_NOT_ASSIGNED', 'Kelionės lapui nepriskirtas automobilis.', 409);

    const liters = Math.round(input.liters * 100) / 100;
    const pricePerLiter = input.pricePerLiter === undefined ? null : Math.round(input.pricePerLiter * 1000) / 1000;
    const now = new Date().toISOString();
    const entry: ServerFuelEntry = {
      id: randomUUID(),
      tripSheetId: `trip-sheet-${resolvedAssignmentId}`,
      assignmentId: resolvedAssignmentId,
      routeId,
      driverId,
      driverName,
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      filledAt: filledAt.toISOString(),
      odometer: Math.round((odometer ?? 0) * 10) / 10,
      liters,
      pricePerLiter,
      totalCost: pricePerLiter === null ? null : Math.round(liters * pricePerLiter * 100) / 100,
      station: optionalText(input.station),
      receiptNumber: optionalText(input.receiptNumber),
      notes: optionalText(input.notes),
      createdAt: now,
      createdBy: profile.id,
    };
    await this.fuelEntries.doc(entry.id).create(entry);
    return entry;
  }

  private async seedNll182OdometerLog(vehicles: FleetVehicle[]): Promise<void> {
    const vehicle = vehicles.find((item) => item.registrationNumber.toUpperCase() === 'NLL182');
    if (!vehicle) return;
    const existing = await this.vehicleDayReadings.where('vehicleId', '==', vehicle.id).get();
    const have = new Set(existing.docs.map((document) => (document.data() as VehicleDayReading).date));
    const driver = await this.resolveReadingDriver(vehicle, vehicle.assignedDriverId);
    const now = new Date().toISOString();
    for (const day of NLL182_ODOMETER_LOG) {
      if (have.has(day.date)) continue;
      const id = `${vehicle.id}:${day.date}`;
      const reading: VehicleDayReading = {
        id,
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        date: day.date,
        startOdometer: day.startOdometer,
        endOdometer: day.endOdometer,
        distanceKm: odometerDistanceKm(day.startOdometer, day.endOdometer),
        driverId: driver.id,
        driverName: driver.name === 'Nepriskirtas' ? NLL182_ODOMETER_DRIVER_NAME : driver.name,
        createdAt: now,
        updatedAt: now,
        createdBy: 'gps-import',
      };
      await this.vehicleDayReadings.doc(id).set(reading);
    }
  }

  /**
   * One-shot production reset for August 2026 MET630/NLL182 fuel.
   * Clears stale August fills + openings, inserts the authoritative receipt
   * table, sets opening balances and fuel norms. Gated by tsp_settings
   * `fuel-august-2026-v2` so merge+deploy fixes Firestore without re-enabling
   * seedExcelFuelLog on every listTripSheets call.
   */
  async applyFuelAugust2026V2Migration(): Promise<{ applied: boolean; reason: string }> {
    const flagRef = this.settings.doc(FUEL_AUGUST_2026_MIGRATION_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return { applied: false, reason: 'already_applied' };
    }

    const vehiclesSnapshot = await this.vehicles.get();
    const vehicles = vehiclesSnapshot.docs.map((document) => normalizeVehicle(document.data() as FleetVehicle));
    const byPlate = new Map(
      vehicles.map((vehicle) => [vehicle.registrationNumber.toUpperCase(), vehicle] as const),
    );
    const met = byPlate.get('MET630');
    const nll = byPlate.get('NLL182');
    if (!met && !nll) {
      return { applied: false, reason: 'target_vehicles_missing' };
    }

    const vehicleIds = new Set<string>([met?.id, nll?.id].filter((id): id is string => Boolean(id)));
    const now = new Date().toISOString();

    const fuelSnapshot = await this.fuelEntries.get();
    const staleEntries = fuelSnapshot.docs.filter((document) => {
      const entry = document.data() as ServerFuelEntry;
      return isStaleAugust2026FuelEntry({
        id: entry.id ?? document.id,
        registrationNumber: entry.registrationNumber,
        vehicleId: entry.vehicleId,
        filledAt: entry.filledAt,
      }, vehicleIds);
    });
    for (const document of staleEntries) {
      await document.ref.delete();
    }

    const reportSnapshot = await this.fuelReports.get();
    const staleReports = reportSnapshot.docs.filter((document) => {
      const report = normalizeFuelReport(document.data() as FuelReport);
      return isStaleAugustOpeningReport({
        id: report.id ?? document.id,
        vehicleId: report.vehicleId,
        registrationNumber: report.registrationNumber,
        effectiveAt: report.effectiveAt,
        kind: report.kind,
      }, vehicleIds);
    });
    for (const document of staleReports) {
      await document.ref.delete();
    }

    const drivers = new Map<string, { id: string | null; name: string }>();
    const resolveDriver = async (vehicle: FleetVehicle) => {
      let driver = drivers.get(vehicle.id);
      if (!driver) {
        driver = await this.resolveReadingDriver(vehicle, vehicle.assignedDriverId);
        drivers.set(vehicle.id, driver);
      }
      return driver;
    };

    if (met) {
      const driver = await resolveDriver(met);
      const report: FuelReport = {
        id: MET630_OPENING_FUEL_REPORT_ID,
        driverId: driver.id ?? 'opening-seed',
        driverName: driver.name,
        vehicleId: met.id,
        registrationNumber: met.registrationNumber,
        assignmentRevision: met.assignmentRevision,
        previousLiters: met.fuelRemainingLiters,
        reportedLiters: MET630_OPENING_FUEL_LITERS,
        status: 'approved',
        reportedAt: now,
        reviewedAt: now,
        reviewedBy: 'fuel-august-2026-v2',
        effectiveAt: MET630_OPENING_FUEL_EFFECTIVE_AT,
        kind: 'admin_correction',
        note: MET630_OPENING_FUEL_NOTE,
      };
      await this.fuelReports.doc(report.id).set(report);
      if (met.fuelNormLPer100Km !== FUEL_AUGUST_2026_NORMS.MET630) {
        await this.vehicles.doc(met.id).update({
          fuelNormLPer100Km: FUEL_AUGUST_2026_NORMS.MET630,
          updatedAt: now,
        });
      }
    }

    if (nll) {
      const driver = await resolveDriver(nll);
      const report: FuelReport = {
        id: NLL182_OPENING_FUEL_REPORT_ID,
        driverId: driver.id ?? 'opening-seed',
        driverName: driver.name === 'Nepriskirtas' ? NLL182_ODOMETER_DRIVER_NAME : driver.name,
        vehicleId: nll.id,
        registrationNumber: nll.registrationNumber,
        assignmentRevision: nll.assignmentRevision,
        previousLiters: nll.fuelRemainingLiters,
        reportedLiters: NLL182_OPENING_FUEL_LITERS,
        status: 'approved',
        reportedAt: now,
        reviewedAt: now,
        reviewedBy: 'fuel-august-2026-v2',
        effectiveAt: NLL182_OPENING_FUEL_EFFECTIVE_AT,
        kind: 'admin_correction',
        note: NLL182_OPENING_FUEL_NOTE,
      };
      await this.fuelReports.doc(report.id).set(report);
      if (nll.fuelNormLPer100Km !== FUEL_AUGUST_2026_NORMS.NLL182) {
        await this.vehicles.doc(nll.id).update({
          fuelNormLPer100Km: FUEL_AUGUST_2026_NORMS.NLL182,
          updatedAt: now,
        });
      }
    }

    for (const fill of EXCEL_FUEL_LOG) {
      const vehicle = byPlate.get(fill.registrationNumber);
      if (!vehicle) continue;
      const driver = await resolveDriver(vehicle);
      const assignmentId = vehicleDayAssignmentId(vehicle.id, fill.localDate);
      const id = excelFuelDocumentId(fill);
      const entry: ServerFuelEntry = {
        id,
        tripSheetId: `trip-sheet-${assignmentId}`,
        assignmentId,
        routeId: assignmentId,
        driverId: driver.id ?? '',
        driverName: driver.name,
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        filledAt: lithuaniaLocalToIso(fill.localDate, fill.localTime),
        odometer: excelFuelOdometer(fill.registrationNumber, fill.localDate),
        liters: fill.liters,
        pricePerLiter: null,
        totalCost: null,
        station: null,
        receiptNumber: fill.receiptNumber,
        notes: null,
        createdAt: now,
        createdBy: 'fuel-august-2026-v2',
      };
      await this.fuelEntries.doc(id).set(entry);
    }

    await flagRef.set({
      id: FUEL_AUGUST_2026_MIGRATION_ID,
      status: 'applied',
      appliedAt: now,
      deletedFuelEntries: staleEntries.length,
      deletedOpeningReports: staleReports.length,
      insertedFills: EXCEL_FUEL_LOG.length,
      norms: FUEL_AUGUST_2026_NORMS,
    });
    return { applied: true, reason: 'applied' };
  }

  /**
   * One-shot follow-up after fuel-august-2026-v2:
   * - Deletes two erroneous MET630 fills (trn 42655388 / 42959044).
   * - Upserts MET630 2026-08-03 vehicle-day reading so day km = 617.
   * Gated by tsp_settings `fuel-august-2026-v3`. Does not reseed the catalog
   * and does not touch openings, norms, or on-time/late stats.
   */
  async applyFuelAugust2026V3Migration(): Promise<{ applied: boolean; reason: string }> {
    const flagRef = this.settings.doc(FUEL_AUGUST_2026_V3_MIGRATION_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return { applied: false, reason: 'already_applied' };
    }

    const vehiclesSnapshot = await this.vehicles.get();
    const vehicles = vehiclesSnapshot.docs.map((document) => normalizeVehicle(document.data() as FleetVehicle));
    const met = vehicles.find((vehicle) => vehicle.registrationNumber.toUpperCase() === 'MET630');
    if (!met) {
      return { applied: false, reason: 'target_vehicle_missing' };
    }

    const now = new Date().toISOString();
    const fuelSnapshot = await this.fuelEntries.get();
    const removedEntries = fuelSnapshot.docs.filter((document) => {
      const entry = document.data() as ServerFuelEntry;
      return isFuelAugust2026V3RemovedEntry({
        id: entry.id ?? document.id,
        registrationNumber: entry.registrationNumber,
        receiptNumber: entry.receiptNumber,
        notes: entry.notes,
        filledAt: entry.filledAt,
      });
    });
    for (const document of removedEntries) {
      await document.ref.delete();
    }

    const readingId = vehicleDayReadingDocId(met.id, MET630_AUGUST_03_2026_DATE);
    const existingReading = (await this.vehicleDayReadings.doc(readingId).get()).data() as VehicleDayReading | undefined;
    let startHint: number | null = existingReading?.startOdometer ?? null;
    if (startHint === null) {
      const assignmentSnapshot = await this.assignments.get();
      for (const document of assignmentSnapshot.docs) {
        const assignment = document.data() as RouteAssignment;
        if (assignment.status !== 'completed') continue;
        const snapshotVehicleId = String(assignment.routeSnapshot.route.vehicle_id ?? '');
        const vehicleId = assignment.vehicle?.id ?? (snapshotVehicleId || null);
        const plate = String(assignment.vehicle?.registrationNumber ?? '').trim().toUpperCase();
        const matchesVehicle = vehicleId === met.id || plate === 'MET630';
        if (!matchesVehicle) continue;
        if (tripSheetWorkDate(assignment) !== MET630_AUGUST_03_2026_DATE) continue;
        const start = nullableNumber(assignment.routeSnapshot.route.start_odometer);
        if (start !== null) {
          startHint = start;
          break;
        }
      }
    }

    const odometers = correctedMet630August03Odometers(
      startHint === null ? null : { startOdometer: startHint },
    );
    const driver = existingReading
      ? { id: existingReading.driverId, name: existingReading.driverName }
      : await this.resolveReadingDriver(met, met.assignedDriverId);
    const reading: VehicleDayReading = {
      id: readingId,
      vehicleId: met.id,
      registrationNumber: met.registrationNumber,
      date: MET630_AUGUST_03_2026_DATE,
      startOdometer: odometers.startOdometer,
      endOdometer: odometers.endOdometer,
      distanceKm: odometers.distanceKm,
      driverId: driver.id,
      driverName: driver.name,
      createdAt: existingReading?.createdAt ?? now,
      updatedAt: now,
      createdBy: existingReading?.createdBy ?? 'fuel-august-2026-v3',
    };
    await this.vehicleDayReadings.doc(readingId).set(reading);

    await flagRef.set({
      id: FUEL_AUGUST_2026_V3_MIGRATION_ID,
      status: 'applied',
      appliedAt: now,
      deletedFuelEntries: removedEntries.length,
      deletedEntryIds: removedEntries.map((document) => document.id),
      met630August03DistanceKm: MET630_AUGUST_03_2026_DISTANCE_KM,
      met630August03ReadingId: readingId,
    });
    return { applied: true, reason: 'applied' };
  }

  /**
   * One-shot follow-up after fuel-august-2026-v3:
   * - Upserts MET630 2026-08-31 fill čekis 08/52 (95.07 L) under a stable
   *   synthetic document id (`xlsx-manual-08-52`).
   * - Records 615.50 km as vehicle-day `extraDistanceKm` so fuel/ledger uses
   *   915.50 while Karolis’s assignment `actualDistanceKm` stays 300.
   * Gated by tsp_settings `fuel-august-2026-v4`. Does not reseed the catalog,
   * openings, norms, NLL fills, or stop punctuality.
   */
  async applyFuelAugust2026V4Migration(): Promise<{ applied: boolean; reason: string }> {
    const flagRef = this.settings.doc(FUEL_AUGUST_2026_V4_MIGRATION_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return { applied: false, reason: 'already_applied' };
    }

    const vehiclesSnapshot = await this.vehicles.get();
    const vehicles = vehiclesSnapshot.docs.map((document) => normalizeVehicle(document.data() as FleetVehicle));
    const met = vehicles.find((vehicle) => vehicle.registrationNumber.toUpperCase() === 'MET630');
    if (!met) {
      return { applied: false, reason: 'target_vehicle_missing' };
    }

    const now = new Date().toISOString();
    const fill = MET630_AUGUST_31_2026_MANUAL_FILL;
    const fuelSnapshot = await this.fuelEntries.get();
    const matchingEntries = fuelSnapshot.docs.filter((document) => {
      const entry = document.data() as ServerFuelEntry;
      return isFuelAugust2026V4ManualFillEntry({
        id: entry.id ?? document.id,
        registrationNumber: entry.registrationNumber,
        receiptNumber: entry.receiptNumber,
        notes: entry.notes,
      });
    });
    for (const document of matchingEntries) {
      await document.ref.delete();
    }

    const karolisDocument = await this.users.doc(KAROLIS_TAUTKUS_DRIVER_ID).get();
    const karolis = karolisDocument.data() as StoredUser | undefined;
    const driver = karolis && !karolis.disabled
      ? { id: karolis.id, name: karolis.displayName }
      : await this.resolveReadingDriver(met, met.assignedDriverId);
    const fillDriverId = driver.id ?? '';
    const fillDriverName = driver.name && driver.name !== 'Nepriskirtas' ? driver.name : 'K.Tautkus';
    const assignmentId = vehicleDayAssignmentId(met.id, fill.localDate);
    const fillId = excelFuelDocumentId(fill);
    const entry: ServerFuelEntry = {
      id: fillId,
      tripSheetId: `trip-sheet-${assignmentId}`,
      assignmentId,
      routeId: assignmentId,
      driverId: fillDriverId,
      driverName: fillDriverName,
      vehicleId: met.id,
      registrationNumber: met.registrationNumber,
      filledAt: lithuaniaLocalToIso(fill.localDate, fill.localTime),
      odometer: excelFuelOdometer(fill.registrationNumber, fill.localDate),
      liters: fill.liters,
      pricePerLiter: null,
      totalCost: null,
      station: null,
      receiptNumber: fill.receiptNumber,
      notes: null,
      createdAt: now,
      createdBy: 'fuel-august-2026-v4',
    };
    await this.fuelEntries.doc(fillId).set(entry);

    const readingId = vehicleDayReadingDocId(met.id, MET630_AUGUST_31_2026_DATE);
    const existingReading = (await this.vehicleDayReadings.doc(readingId).get()).data() as VehicleDayReading | undefined;
    let startHint: number | null = existingReading?.startOdometer ?? null;
    const assignmentDocument = await this.assignments.doc(MET630_AUGUST_31_2026_ASSIGNMENT_ID).get();
    const assignment = assignmentDocument.data() as RouteAssignment | undefined;
    let assignmentActualRestored = false;
    if (assignment && assignment.status === 'completed') {
      const route = assignment.routeSnapshot.route;
      const assignmentStart = nullableNumber(route.start_odometer);
      if (startHint === null) startHint = assignmentStart;
      const restore = shouldRestoreMet630August31AssignedDistance({
        actualDistanceKm: nullableNumber(route.actual_distance_km),
        startOdometer: assignmentStart,
        endOdometer: nullableNumber(route.end_odometer),
      });
      if (restore.restoreActual || restore.restoreOdometerSpan) {
        const assignedOdometers = met630August31AssignedOdometers(
          assignmentStart === null ? null : { startOdometer: assignmentStart },
        );
        const updatedAt = now;
        const updated: RouteAssignment = {
          ...assignment,
          updatedAt,
          routeSnapshot: {
            ...assignment.routeSnapshot,
            route: {
              ...route,
              actual_distance_km: assignedOdometers.distanceKm,
              ...(restore.restoreOdometerSpan
                ? { start_odometer: assignedOdometers.startOdometer, end_odometer: assignedOdometers.endOdometer }
                : {}),
              updated_at: updatedAt,
            },
          },
        };
        await this.assignments.doc(MET630_AUGUST_31_2026_ASSIGNMENT_ID).set(updated);
        assignmentActualRestored = true;
      }
    }

    const odometers = met630August31AssignedOdometers(
      startHint === null ? null : { startOdometer: startHint },
    );
    const readingDriver = existingReading
      ? { id: existingReading.driverId, name: existingReading.driverName }
      : assignment
        ? { id: assignment.driverId, name: assignment.driverName }
        : { id: driver.id, name: fillDriverName };
    const reading: VehicleDayReading = {
      id: readingId,
      vehicleId: met.id,
      registrationNumber: met.registrationNumber,
      date: MET630_AUGUST_31_2026_DATE,
      startOdometer: odometers.startOdometer,
      endOdometer: odometers.endOdometer,
      distanceKm: odometers.distanceKm,
      extraDistanceKm: odometers.extraDistanceKm,
      driverId: readingDriver.id,
      driverName: readingDriver.name,
      createdAt: existingReading?.createdAt ?? now,
      updatedAt: now,
      createdBy: existingReading?.createdBy ?? 'fuel-august-2026-v4',
    };
    await this.vehicleDayReadings.doc(readingId).set(reading);

    await flagRef.set({
      id: FUEL_AUGUST_2026_V4_MIGRATION_ID,
      status: 'applied',
      appliedAt: now,
      deletedFuelEntries: matchingEntries.length,
      deletedEntryIds: matchingEntries.map((document) => document.id),
      insertedFillId: fillId,
      insertedLiters: fill.liters,
      met630August31AssignedDistanceKm: MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM,
      met630August31ExtraDistanceKm: odometers.extraDistanceKm,
      met630August31VehicleDistanceKm: MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM,
      met630August31ReadingId: readingId,
      assignmentActualRestored,
    });
    return { applied: true, reason: 'applied' };
  }

  /**
   * One-shot correction of completed August 2026 trip-sheet vehicle+driver
   * against the photo day log. Gated by tsp_settings
   * `trip-sheet-august-2026-vehicle-fix-v1`. Never rewrites stop delivered_at
   * or delivery_status — quality on-time/late stays as recorded.
   */
  async applyTripSheetAugust2026VehicleFix(): Promise<{
    applied: boolean;
    reason: string;
    corrected: number;
    skipped: number;
    erikasRenamed: boolean;
    nll182DaysUpserted: number;
  }> {
    const flagRef = this.settings.doc(TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return {
        applied: false, reason: 'already_applied', corrected: 0, skipped: 0, erikasRenamed: false, nll182DaysUpserted: 0,
      };
    }

    const vehiclesSnapshot = await this.vehicles.get();
    const vehicles = vehiclesSnapshot.docs.map((document) => normalizeVehicle(document.data() as FleetVehicle));
    const byPlate = new Map(
      vehicles.map((vehicle) => [vehicle.registrationNumber.toUpperCase(), vehicle] as const),
    );
    const met = byPlate.get('MET630');
    const nll = byPlate.get('NLL182');
    if (!met && !nll) {
      return {
        applied: false, reason: 'target_vehicles_missing', corrected: 0, skipped: 0, erikasRenamed: false, nll182DaysUpserted: 0,
      };
    }

    let erikasRenamed = false;
    const erikasDocument = await this.users.doc(ERIKAS_ASKELOVICIUS_DRIVER_ID).get();
    const erikas = erikasDocument.data() as StoredUser | undefined;
    if (erikas && shouldRenameErikasPlaceholder(erikas.displayName)) {
      await this.updateUser(ERIKAS_ASKELOVICIUS_DRIVER_ID, { displayName: ERIKAS_ASKELOVICIUS_DISPLAY_NAME });
      erikasRenamed = true;
    }

    const outcomes: { assignmentId: string; status: string }[] = [];
    for (const fix of AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES) {
      const vehicle = byPlate.get(fix.registrationNumber);
      if (!vehicle) {
        outcomes.push({ assignmentId: fix.assignmentId, status: 'skipped_vehicle_missing' });
        continue;
      }
      const assignmentDocument = await this.assignments.doc(fix.assignmentId).get();
      const assignment = assignmentDocument.data() as RouteAssignment | undefined;
      if (!assignment) {
        outcomes.push({ assignmentId: fix.assignmentId, status: 'skipped_missing' });
        continue;
      }
      if (assignment.status !== 'completed') {
        outcomes.push({ assignmentId: fix.assignmentId, status: 'skipped_not_completed' });
        continue;
      }
      if (fix.scheduleDate && canUpdateAssignmentScheduleDate(assignment.status)) {
        await this.updateAssignmentSchedule(fix.assignmentId, fix.scheduleDate);
      }
      await this.updateTripSheet(fix.assignmentId, {
        vehicleId: vehicle.id,
        driverId: fix.driverId,
      });
      outcomes.push({ assignmentId: fix.assignmentId, status: 'corrected' });
    }

    // After vehicle moves (NLL182 → MET630), restore/correct the NLL182
    // vehicle-day chain so fuel/odometer uses absolute start/end, not the
    // route sheet's kilometres. Same write path as POST /api/trip-sheets/day-readings.
    let nll182DaysUpserted = 0;
    if (nll) {
      const migrationProfile: EmployeeProfile = {
        id: 'migration-august-2026-vehicle-fix',
        username: 'migration-august-2026-vehicle-fix',
        displayName: 'August 2026 vehicle fix',
        role: 'admin',
        disabled: false,
        permissions: { ...DEFAULT_DRIVER_PERMISSIONS, ...DEFAULT_MANAGEMENT_PERMISSIONS },
        email: null,
        phone: null,
        compensation: null,
      };
      for (const day of NLL182_AUGUST_2026_ODOMETER_CORRECTIONS) {
        const existing = (await this.vehicleDayReadings.doc(vehicleDayReadingDocId(nll.id, day.date)).get())
          .data() as VehicleDayReading | undefined;
        await this.upsertVehicleDayReading(migrationProfile, {
          vehicleId: nll.id,
          date: day.date,
          startOdometer: day.startOdometer,
          endOdometer: day.endOdometer,
          driverId: nll182FactDriverIdForDate(day.date) ?? existing?.driverId ?? undefined,
        });
        nll182DaysUpserted += 1;
      }
    }

    const corrected = outcomes.filter((item) => item.status === 'corrected').length;
    const skipped = outcomes.length - corrected;
    await flagRef.set({
      id: TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      corrected,
      skipped,
      erikasRenamed,
      nll182DaysUpserted,
      outcomes,
    });
    return { applied: true, reason: 'applied', corrected, skipped, erikasRenamed, nll182DaysUpserted };
  }

  /**
   * One-shot August 2026 Excel trip-sheet backfill. Creates completed
   * assignments from scripts/august-2026-backfill per-day JSON (Excel stop
   * order, no provider matrix or route alternatives). Snapshots the vehicle onto
   * the assignment without assignVehicle so today's live fleet is not
   * rewritten. Gated by tsp_settings `august-2026-excel-backfill-v1`.
   */
  async applyAugust2026ExcelBackfill(input: {
    geocode?: AugustBackfillGeocodeFn;
    nowIso?: string;
  } = {}): Promise<{
    applied: boolean;
    reason: string;
    created: number;
    completedExistingUi: number;
    skipped: number;
    geocoded: number;
    outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[];
  }> {
    const flagRef = this.settings.doc(AUGUST_2026_EXCEL_BACKFILL_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return {
        applied: false, reason: 'already_applied', created: 0, completedExistingUi: 0, skipped: 0, geocoded: 0, outcomes: [],
      };
    }

    const catalog = loadAugust2026ExcelBackfillCatalog();
    const users = await this.listUsers();
    const vehicles = await this.listVehicles();
    const assignmentSnapshot = await this.assignments.get();
    const assignments: AugustAssignmentLite[] = assignmentSnapshot.docs.map((document) => {
      const assignment = document.data() as RouteAssignment;
      return liteAssignmentFromSnapshot({
        id: assignment.id,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        status: assignment.status,
        vehicle: assignment.vehicle,
        route: assignment.routeSnapshot.route,
        stops: assignment.routeSnapshot.stops,
        shipmentLines: assignment.routeSnapshot.shipmentLines,
      });
    });

    const nowIso = input.nowIso ?? new Date().toISOString();
    const hasTargetDriver = Boolean(
      matchDriverByName(users, 'Karolis Tautkus') || matchDriverByName(users, 'Aleksandras Arsenij'),
    );
    const geocode = input.geocode ?? createAugustBackfillProductionGeocoder();
    const daysToMaterialize = hasTargetDriver
      ? catalog.days
      : catalog.days.filter((day) => (
        day.date === catalog.existingUiRoute.date
        && day.kind === 'excel'
        && day.driver === catalog.existingUiRoute.driver
      ));
    const queries = uniqueGeocodeQueries(hasTargetDriver ? catalog.days : []);
    const geocodes = queries.length > 0 ? await geocodeQueriesCached(queries, geocode) : new Map();
    const geocoded = [...geocodes.values()].filter(Boolean).length;

    const outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[] = [];
    let created = 0;
    let completedExistingUi = 0;
    let skipped = 0;

    for (const day of daysToMaterialize) {
      const driver = matchDriverByName(users, day.driver);
      const vehicle = this.resolveAugustBackfillVehicleRef(vehicles, day.vehicle, nowIso);
      const decision = decideAugustBackfillDayAction({
        day,
        skips: catalog.skips,
        existingUiRoute: catalog.existingUiRoute,
        driverId: driver?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        assignments,
      });

      if (decision.action === 'skip') {
        skipped += 1;
        outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: decision.action, reason: decision.reason });
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_skip',
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          reason: decision.reason,
        })}\n`);
        continue;
      }

      if (decision.action === 'complete_existing_ui' || decision.action === 'rewrite_existing_ui') {
        const timestamps = historicalWorkdayTimestamps(day.date);
        const updated = await this.completeAssignment(decision.assignmentId, {
          startedAt: timestamps.startedAt,
          completedAt: timestamps.completedAt,
          markAllDelivered: true,
        }, { rewriteCompleted: decision.action === 'rewrite_existing_ui' });
        replaceLiteAssignment(assignments, liteAssignmentFromSnapshot({
          id: updated.id,
          routeId: updated.routeId,
          driverId: updated.driverId,
          driverName: updated.driverName,
          status: updated.status,
          vehicle: updated.vehicle,
          route: updated.routeSnapshot.route,
          stops: updated.routeSnapshot.stops,
          shipmentLines: updated.routeSnapshot.shipmentLines,
        }));
        completedExistingUi += 1;
        outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: decision.action, reason: decision.reason });
        continue;
      }

      if (!driver || !vehicle) {
        skipped += 1;
        outcomes.push({
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          action: 'skip',
          reason: !driver ? 'driver_missing' : 'vehicle_missing',
        });
        continue;
      }

      const snapshot = buildAugustBackfillRouteSnapshot(day, geocodes, decision.routeId, nowIso);
      validateSnapshot(snapshot);
      const timestamps = historicalWorkdayTimestamps(day.date);
      const completed = applyAdminAssignmentComplete(snapshot, {
        startedAt: timestamps.startedAt,
        completedAt: timestamps.completedAt,
        markAllDelivered: true,
      }, nowIso);
      const assignment: RouteAssignment = {
        id: randomUUID(),
        routeId: decision.routeId,
        driverId: driver.id,
        driverName: driver.displayName,
        status: 'completed',
        routeSnapshot: {
          route: completed.route,
          stops: completed.stops,
          shipmentLines: snapshot.shipmentLines,
        },
        progress: completed.progress,
        createdBy: AUGUST_2026_EXCEL_BACKFILL_ID,
        assignedAt: timestamps.startedAt,
        updatedAt: completed.updatedAt,
        // Snapshot only — do not call assignVehicle (would steal today's fleet).
        vehicle: vehicleSnapshot(vehicle),
      };
      await this.assignments.doc(assignment.id).create(assignment);
      assignments.push(liteAssignmentFromSnapshot({
        id: assignment.id,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        status: assignment.status,
        vehicle: assignment.vehicle,
        route: assignment.routeSnapshot.route,
        stops: assignment.routeSnapshot.stops,
        shipmentLines: assignment.routeSnapshot.shipmentLines,
      }));
      created += 1;
      outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: 'create', reason: decision.reason });
    }

    if (!hasTargetDriver) {
      return {
        applied: false,
        reason: 'target_drivers_missing',
        created,
        completedExistingUi,
        skipped,
        geocoded,
        outcomes,
      };
    }

    await flagRef.set({
      id: AUGUST_2026_EXCEL_BACKFILL_ID,
      status: 'applied',
      appliedAt: nowIso,
      created,
      completedExistingUi,
      skipped,
      geocoded,
      uniqueAddressQueries: queries.length,
      stubPlaceholder: catalog.stubPlaceholder,
      existingUiRouteId: catalog.existingUiRoute.routeId,
      outcomes,
    });
    return {
      applied: true, reason: 'applied', created, completedExistingUi, skipped, geocoded, outcomes,
    };
  }

  /**
   * One-shot August 2026 Excel backfill v2 — after v1. Creates the sheets v1
   * skipped when LRI740/LRI741 were missing, materializes Aleksandras 08-19
   * MET630 next to Karolis NLL182 R54;R11, and PATCHes that Karolis sheet off
   * MET630 via updateTripSheet({ vehicleId }) without rewriting stops.
   * Gated by tsp_settings `august-2026-excel-backfill-v2`.
   */
  async applyAugust2026ExcelBackfillV2(input: {
    geocode?: AugustBackfillGeocodeFn;
    nowIso?: string;
  } = {}): Promise<{
    applied: boolean;
    reason: string;
    created: number;
    fleetEnsured: string[];
    lri740OpeningFuel: 'created' | 'already_exists' | 'skipped_vehicle_missing';
    movedKarolis0819ToNll182: number;
    skipped: number;
    geocoded: number;
    outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[];
  }> {
    const flagRef = this.settings.doc(AUGUST_2026_EXCEL_BACKFILL_V2_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      return {
        applied: false,
        reason: 'already_applied',
        created: 0,
        fleetEnsured: [],
        lri740OpeningFuel: 'already_exists',
        movedKarolis0819ToNll182: 0,
        skipped: 0,
        geocoded: 0,
        outcomes: [],
      };
    }

    const catalog = loadAugust2026ExcelBackfillCatalog();
    const users = await this.listUsers();
    const vehicles = await this.listVehicles();
    const nowIso = input.nowIso ?? new Date().toISOString();
    const fleetEnsured = await this.ensureAugustBackfillFleetPlates(vehicles, nowIso);
    const lri740OpeningFuel = await this.ensureLri740AugustOpeningFuel(vehicles, users, nowIso);

    const assignmentSnapshot = await this.assignments.get();
    const assignments: AugustAssignmentLite[] = assignmentSnapshot.docs.map((document) => {
      const assignment = document.data() as RouteAssignment;
      return this.liteFromRouteAssignment(assignment);
    });

    const outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[] = [];
    let movedKarolis0819ToNll182 = 0;
    const nll = matchVehicleByPlate(vehicles, 'NLL182');
    const karolis0819 = assignments.find((assignment) => (
      assignment.status === 'completed' && isKarolis0819R54R11Assignment(assignment)
    ));
    if (karolis0819 && karolis0819NeedsNll182Move(karolis0819)) {
      if (!nll) {
        outcomes.push({
          date: '2026-08-19',
          driver: karolis0819.driverName,
          vehicle: 'NLL182',
          action: 'skip',
          reason: 'karolis_0819_nll182_missing',
        });
      } else {
        await this.updateTripSheet(karolis0819.id, { vehicleId: nll.id });
        const patchedDocument = await this.assignments.doc(karolis0819.id).get();
        const patched = patchedDocument.data() as RouteAssignment | undefined;
        if (patched) replaceLiteAssignment(assignments, this.liteFromRouteAssignment(patched));
        movedKarolis0819ToNll182 += 1;
        outcomes.push({
          date: '2026-08-19',
          driver: patched?.driverName ?? karolis0819.driverName,
          vehicle: 'NLL182',
          action: 'move_vehicle',
          reason: 'karolis_0819_r54_r11_to_nll182',
        });
      }
    } else if (karolis0819) {
      outcomes.push({
        date: '2026-08-19',
        driver: karolis0819.driverName,
        vehicle: karolis0819.vehiclePlate ?? 'NLL182',
        action: 'skip',
        reason: 'karolis_0819_already_nll182',
      });
    }

    const gapDays = catalog.days.filter((day) => isAugust2026ExcelBackfillV2GapDay(day));
    const hasTargetDriver = Boolean(
      matchDriverByName(users, 'Karolis Tautkus') || matchDriverByName(users, 'Aleksandras Arsenij'),
    );
    const geocode = input.geocode ?? createAugustBackfillProductionGeocoder();
    const queries = uniqueGeocodeQueries(hasTargetDriver ? gapDays : []);
    const geocodes = queries.length > 0 ? await geocodeQueriesCached(queries, geocode) : new Map();
    const geocoded = [...geocodes.values()].filter(Boolean).length;

    let created = 0;
    let skipped = 0;

    if (!hasTargetDriver) {
      return {
        applied: false,
        reason: 'target_drivers_missing',
        created,
        fleetEnsured,
        lri740OpeningFuel,
        movedKarolis0819ToNll182,
        skipped,
        geocoded,
        outcomes,
      };
    }

    for (const day of gapDays) {
      const driver = matchDriverByName(users, day.driver);
      const vehicle = this.resolveAugustBackfillVehicleRef(vehicles, day.vehicle, nowIso);
      const decision = decideAugustBackfillV2GapAction({
        day,
        skips: catalog.skips,
        existingUiRoute: catalog.existingUiRoute,
        driverId: driver?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        assignments,
      });

      if (decision.action === 'skip') {
        skipped += 1;
        outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: decision.action, reason: decision.reason });
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v2_skip',
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          reason: decision.reason,
        })}\n`);
        continue;
      }

      if (decision.action !== 'create' || !driver || !vehicle) {
        skipped += 1;
        outcomes.push({
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          action: 'skip',
          reason: !driver ? 'driver_missing' : !vehicle ? 'vehicle_missing' : `unexpected_${decision.action}`,
        });
        continue;
      }

      const createdAssignment = await this.createAugustBackfillCompletedAssignment({
        day,
        driver,
        vehicle,
        geocodes,
        routeId: decision.routeId,
        nowIso,
        createdBy: AUGUST_2026_EXCEL_BACKFILL_V2_ID,
      });
      assignments.push(this.liteFromRouteAssignment(createdAssignment));
      created += 1;
      outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: 'create', reason: decision.reason });
    }

    await flagRef.set({
      id: AUGUST_2026_EXCEL_BACKFILL_V2_ID,
      status: 'applied',
      appliedAt: nowIso,
      created,
      fleetEnsured,
      lri740OpeningFuel,
      movedKarolis0819ToNll182,
      skipped,
      geocoded,
      uniqueAddressQueries: queries.length,
      outcomes,
    });
    return {
      applied: true,
      reason: 'applied',
      created,
      fleetEnsured,
      lri740OpeningFuel,
      movedKarolis0819ToNll182,
      skipped,
      geocoded,
      outcomes,
    };
  }

  /**
   * One-shot August 2026 Excel backfill v3 — after v2. v2 swallowed fleet
   * createVehicle failures and PATCHed the wrong 08-19 sheet (Karolis R54;R11
   * vehicle move). v3 does not swallow: it must persist unassigned LRI741,
   * PATCH MET630 08-19 R14;R27;R28;R51 onto Aleksandras, rewrite the empty
   * LRI740 08-09 stub stops, and create Aleksandras 08-11 if still missing.
   * Gated by tsp_settings `august-2026-excel-backfill-v3`.
   */
  async applyAugust2026ExcelBackfillV3(input: {
    geocode?: AugustBackfillGeocodeFn;
    nowIso?: string;
  } = {}): Promise<{
    applied: boolean;
    reason: string;
    created: number;
    rewrittenStubs: number;
    patchedAleksandras0819: number;
    fleetEnsured: string[];
    lri740OpeningFuel: 'created' | 'already_exists' | 'skipped_vehicle_missing';
    skipped: number;
    geocoded: number;
    outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[];
  }> {
    const flagRef = this.settings.doc(AUGUST_2026_EXCEL_BACKFILL_V3_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_skip',
        reason: 'already_applied',
      })}\n`);
      return {
        applied: false,
        reason: 'already_applied',
        created: 0,
        rewrittenStubs: 0,
        patchedAleksandras0819: 0,
        fleetEnsured: [],
        lri740OpeningFuel: 'already_exists',
        skipped: 0,
        geocoded: 0,
        outcomes: [],
      };
    }

    const catalog = loadAugust2026ExcelBackfillCatalog();
    const users = await this.listUsers();
    let vehicles = await this.listVehicles();
    const nowIso = input.nowIso ?? new Date().toISOString();
    const aleksandras = matchAleksandrasDriver(users);
    const karolis = matchDriverByName(users, 'Karolis Tautkus');

    process.stdout.write(`${JSON.stringify({
      event: 'august_2026_excel_backfill_v3_start',
      fleetPlates: vehicles.map((vehicle) => vehicle.registrationNumber),
      aleksandras: aleksandras ? { id: aleksandras.id, name: aleksandras.displayName } : null,
      karolis: karolis ? { id: karolis.id, name: karolis.displayName } : null,
      at: nowIso,
    })}\n`);

    if (!aleksandras) {
      const drivers = users
        .filter((user) => (user.role ?? 'driver') === 'driver' && !user.disabled)
        .map((user) => ({ id: user.id, name: user.displayName }));
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_driver_missing',
        wanted: 'Aleksandras Arsenij',
        drivers,
      })}\n`);
      throw new Error('August 2026 excel backfill v3: Aleksandras driver not found; refusing to no-op.');
    }
    if (!karolis) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_driver_missing',
        wanted: 'Karolis Tautkus',
      })}\n`);
      throw new Error('August 2026 excel backfill v3: Karolis driver not found; refusing to no-op.');
    }

    const fleetEnsured = await this.ensureAugustBackfillFleetPlatesStrict(vehicles, nowIso);
    vehicles = await this.listVehicles();
    const lri741 = matchVehicleByPlate(vehicles, 'LRI741');
    if (!lri741) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_fleet_missing',
        plate: 'LRI741',
        fleetPlates: vehicles.map((vehicle) => vehicle.registrationNumber),
      })}\n`);
      throw new Error('August 2026 excel backfill v3: LRI741 is still missing from the fleet after create.');
    }
    const lri740OpeningFuel = await this.ensureLri740AugustOpeningFuel(vehicles, users, nowIso);

    const assignmentSnapshot = await this.assignments.get();
    const rawAssignments = assignmentSnapshot.docs.map((document) => document.data() as RouteAssignment);
    const assignments: AugustAssignmentLite[] = rawAssignments.map((assignment) => this.liteFromRouteAssignment(assignment));

    const outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[] = [];
    let patchedAleksandras0819 = 0;
    for (const assignment of [...assignments]) {
      if (!needsAleksandras0819DriverPatch(assignment, aleksandras.id)) continue;
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_patch_driver',
        assignmentId: assignment.id,
        fromDriverId: assignment.driverId,
        fromDriverName: assignment.driverName,
        toDriverId: aleksandras.id,
        toDriverName: aleksandras.displayName,
        vehicle: 'MET630',
        date: '2026-08-19',
        routes: assignment.routeCodes,
      })}\n`);
      await this.updateTripSheet(assignment.id, { driverId: aleksandras.id });
      const patchedDocument = await this.assignments.doc(assignment.id).get();
      const patched = patchedDocument.data() as RouteAssignment | undefined;
      if (patched) replaceLiteAssignment(assignments, this.liteFromRouteAssignment(patched));
      patchedAleksandras0819 += 1;
      outcomes.push({
        date: '2026-08-19',
        driver: aleksandras.displayName,
        vehicle: 'MET630',
        action: 'patch_driver',
        reason: 'met630_0819_r14_r27_r28_r51_to_aleksandras',
      });
    }

    const gapDays = catalog.days.filter((day) => isAugust2026ExcelBackfillV3GapDay(day));
    const geocode = input.geocode ?? createAugustBackfillProductionGeocoder();
    const queries = uniqueGeocodeQueries(gapDays);
    const geocodes = queries.length > 0 ? await geocodeQueriesCached(queries, geocode) : new Map();
    const geocoded = [...geocodes.values()].filter(Boolean).length;

    let created = 0;
    let rewrittenStubs = 0;
    let skipped = 0;

    for (const day of gapDays) {
      const driver = normalizePersonName(day.driver).startsWith('aleksandras')
        ? aleksandras
        : matchDriverByName(users, day.driver) ?? karolis;
      const vehicle = matchVehicleByPlate(vehicles, day.vehicle)
        ?? this.resolveAugustBackfillVehicleRef(vehicles, day.vehicle, nowIso);
      const decision = decideAugustBackfillV3GapAction({
        day,
        skips: catalog.skips,
        existingUiRoute: catalog.existingUiRoute,
        driverId: driver?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        assignments,
      });

      if (decision.action === 'rewrite_empty_stub') {
        if (!driver || !vehicle) {
          process.stdout.write(`${JSON.stringify({
            event: 'august_2026_excel_backfill_v3_rewrite_blocked',
            date: day.date,
            reason: !driver ? 'driver_missing' : 'vehicle_missing',
          })}\n`);
          throw new Error(`August 2026 excel backfill v3: cannot rewrite ${day.date} ${day.vehicle} stub (${!driver ? 'driver' : 'vehicle'} missing).`);
        }
        const existingDocument = await this.assignments.doc(decision.assignmentId).get();
        const existing = existingDocument.data() as RouteAssignment | undefined;
        const rewritten = await this.rewriteAugustBackfillEmptyStub({
          existing,
          existingId: decision.assignmentId,
          day,
          driver,
          vehicle,
          geocodes,
          routeId: decision.routeId,
          nowIso,
        });
        replaceLiteAssignment(assignments, this.liteFromRouteAssignment(rewritten));
        rewrittenStubs += 1;
        outcomes.push({
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          action: 'rewrite_empty_stub',
          reason: decision.reason,
        });
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_rewrite_stub',
          date: day.date,
          assignmentId: rewritten.id,
          stopCount: rewritten.routeSnapshot.stops.length,
        })}\n`);
        continue;
      }

      if (decision.action === 'skip') {
        skipped += 1;
        outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: decision.action, reason: decision.reason });
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_skip',
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          reason: decision.reason,
        })}\n`);
        continue;
      }

      if (decision.action !== 'create' || !driver || !vehicle) {
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_create_blocked',
          date: day.date,
          driver: day.driver,
          vehicle: day.vehicle,
          action: decision.action,
          reason: !driver ? 'driver_missing' : !vehicle ? 'vehicle_missing' : `unexpected_${decision.action}`,
        })}\n`);
        throw new Error(`August 2026 excel backfill v3: refused to skip create for ${day.date} ${day.vehicle}.`);
      }

      const createdAssignment = await this.createAugustBackfillCompletedAssignment({
        day,
        driver,
        vehicle,
        geocodes,
        routeId: decision.routeId,
        nowIso,
        createdBy: AUGUST_2026_EXCEL_BACKFILL_V3_ID,
      });
      assignments.push(this.liteFromRouteAssignment(createdAssignment));
      created += 1;
      outcomes.push({ date: day.date, driver: day.driver, vehicle: day.vehicle, action: 'create', reason: decision.reason });
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_create',
        date: day.date,
        driver: day.driver,
        vehicle: day.vehicle,
        assignmentId: createdAssignment.id,
        stopCount: createdAssignment.routeSnapshot.stops.length,
        reason: decision.reason,
      })}\n`);
    }

    const refreshed = (await this.assignments.get()).docs.map((document) => (
      this.liteFromRouteAssignment(document.data() as RouteAssignment)
    ));
    const rawRefreshed = (await this.assignments.get()).docs.map((document) => document.data() as RouteAssignment);
    const liveVehicles = await this.listVehicles();
    if (!matchVehicleByPlate(liveVehicles, 'LRI741')) {
      throw new Error('August 2026 excel backfill v3: LRI741 missing after materialization.');
    }
    const aleks11 = refreshed.find((assignment) => (
      assignment.status === 'completed'
      && assignment.driverId === aleksandras.id
      && assignment.vehicleId === (matchVehicleByPlate(liveVehicles, 'LRI741')?.id ?? 'LRI741')
      && assignment.workDate === '2026-08-11'
      && assignment.stopCount >= 1
    )) ?? refreshed.find((assignment) => (
      assignment.status === 'completed'
      && assignment.driverId === aleksandras.id
      && (assignment.vehiclePlate === 'LRI741' || assignment.vehicleId === 'LRI741')
      && (assignment.workDate === '2026-08-11' || assignment.routeDate === '2026-08-11')
      && assignment.stopCount >= 1
    ));
    if (!aleks11) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_verify_failed',
        missing: 'aleksandras_2026_08_11_lri741',
      })}\n`);
      throw new Error('August 2026 excel backfill v3: Aleksandras 2026-08-11 LRI741 sheet is still missing.');
    }
    const aleks19 = refreshed.find((assignment) => (
      isAleksandras0819Met630RouteSet(assignment)
      && assignment.driverId === aleksandras.id
    ));
    if (!aleks19) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_verify_failed',
        missing: 'aleksandras_2026_08_19_met630',
      })}\n`);
      throw new Error('August 2026 excel backfill v3: Aleksandras 2026-08-19 MET630 sheet is still missing.');
    }
    const stub09 = rawRefreshed.find((assignment) => {
      const lite = this.liteFromRouteAssignment(assignment);
      return isKarolis0809Lri740Assignment(lite, karolis.id)
        && !assignmentNeedsStubStopRewrite(assignment.routeSnapshot.stops);
    });
    if (!stub09) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_verify_failed',
        missing: 'karolis_2026_08_09_lri740_stops',
      })}\n`);
      throw new Error('August 2026 excel backfill v3: 2026-08-09 LRI740 stub still has no visible stops.');
    }

    await flagRef.set({
      id: AUGUST_2026_EXCEL_BACKFILL_V3_ID,
      status: 'applied',
      appliedAt: nowIso,
      created,
      rewrittenStubs,
      patchedAleksandras0819,
      fleetEnsured,
      lri740OpeningFuel,
      skipped,
      geocoded,
      uniqueAddressQueries: queries.length,
      lri741Id: lri741.id,
      aleksandras11AssignmentId: aleks11.id,
      aleksandras19AssignmentId: aleks19.id,
      karolis0809AssignmentId: stub09.id,
      outcomes,
    });
    process.stdout.write(`${JSON.stringify({
      event: 'august_2026_excel_backfill_v3_applied',
      created,
      rewrittenStubs,
      patchedAleksandras0819,
      fleetEnsured,
      lri740OpeningFuel,
      skipped,
      geocoded,
    })}\n`);
    return {
      applied: true,
      reason: 'applied',
      created,
      rewrittenStubs,
      patchedAleksandras0819,
      fleetEnsured,
      lri740OpeningFuel,
      skipped,
      geocoded,
      outcomes,
    };
  }

  /**
   * One-shot August 2026 Excel backfill v4 — after v3. Syncs the driver
   * snapshot GET /api/trip-sheets actually lists (assignment + applyDayReading
   * overlay) via PATCH /api/trip-sheets/:id { driverId }. Does not rewrite
   * stops, delivered_at, windows, odometer, or vehicle. Does not swallow
   * errors and still mark the flag applied.
   * Gated by tsp_settings `august-2026-excel-backfill-v4`.
   */
  async applyAugust2026ExcelBackfillV4(input: {
    nowIso?: string;
  } = {}): Promise<{
    applied: boolean;
    reason: string;
    patchedAleksandras0819: number;
    patchedErikas0831: number;
    skipped: number;
    outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[];
  }> {
    const flagRef = this.settings.doc(AUGUST_2026_EXCEL_BACKFILL_V4_ID);
    const existingFlag = await flagRef.get();
    if (existingFlag.exists && existingFlag.data()?.status === 'applied') {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_skip',
        reason: 'already_applied',
      })}\n`);
      return {
        applied: false,
        reason: 'already_applied',
        patchedAleksandras0819: 0,
        patchedErikas0831: 0,
        skipped: 0,
        outcomes: [],
      };
    }

    const users = await this.listUsers();
    const nowIso = input.nowIso ?? new Date().toISOString();
    const aleksandras = matchAleksandrasDriver(users);
    const erikas = matchErikasDriver(users);
    const karolis = matchDriverByName(users, 'Karolis Tautkus');

    process.stdout.write(`${JSON.stringify({
      event: 'august_2026_excel_backfill_v4_start',
      aleksandras: aleksandras ? { id: aleksandras.id, name: aleksandras.displayName } : null,
      erikas: erikas ? { id: erikas.id, name: erikas.displayName } : null,
      karolis: karolis ? { id: karolis.id, name: karolis.displayName } : null,
      at: nowIso,
    })}\n`);

    if (!aleksandras) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_driver_missing',
        wanted: 'Aleksandras Arsenij',
      })}\n`);
      throw new Error('August 2026 excel backfill v4: Aleksandras driver not found; refusing to no-op.');
    }

    const assignmentSnapshot = await this.assignments.get();
    const rawAssignments = assignmentSnapshot.docs.map((document) => document.data() as RouteAssignment);
    const readings = (await this.vehicleDayReadings.get()).docs.map((document) => document.data() as VehicleDayReading);
    const stubFingerprintsBefore = rawAssignments
      .filter((assignment) => isAugust2026ProtectedR56StubAssignment(this.liteFromRouteAssignment(assignment)))
      .map((assignment) => august2026AssignmentFingerprint(assignment));

    const outcomes: { date: string; driver: string; vehicle: string; action: string; reason: string }[] = [];
    let patchedAleksandras0819 = 0;
    let patchedErikas0831 = 0;
    let skipped = 0;

    for (const assignment of rawAssignments) {
      const lite = this.liteFromRouteAssignment(assignment);
      const listed = listedTripSheetDriver(assignment, readings);
      const decision = decideAugustBackfillV4DriverSync({
        assignment: lite,
        listedDriverId: listed.driverId,
        listedDriverName: listed.driverName,
        aleksandrasId: aleksandras.id,
        erikasId: erikas?.id ?? null,
      });

      if (decision.action === 'skip') {
        if (decision.reason !== 'not_v4_target') {
          skipped += 1;
          outcomes.push({
            date: lite.workDate ?? lite.routeDate ?? '',
            driver: assignment.driverName,
            vehicle: lite.vehiclePlate ?? '',
            action: 'skip',
            reason: decision.reason,
          });
        }
        continue;
      }

      if (decision.reason === 'nll182_0831_listed_driver_not_erikas' && !erikas) {
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v4_driver_missing',
          wanted: 'Erikas Aškelovičius',
          assignmentId: assignment.id,
        })}\n`);
        throw new Error('August 2026 excel backfill v4: Erikas driver not found; refusing to no-op 2026-08-31 NLL182 sync.');
      }

      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_patch_driver',
        assignmentId: assignment.id,
        fromDriverId: assignment.driverId,
        fromDriverName: assignment.driverName,
        listedDriverId: listed.driverId,
        listedDriverName: listed.driverName,
        toDriverId: decision.targetDriverId,
        reason: decision.reason,
        vehicle: lite.vehiclePlate,
        date: lite.workDate ?? lite.routeDate,
        routes: lite.routeCodes,
      })}\n`);
      await this.updateTripSheet(assignment.id, { driverId: decision.targetDriverId });
      if (decision.reason === 'met630_0819_listed_driver_not_aleksandras') {
        patchedAleksandras0819 += 1;
        outcomes.push({
          date: '2026-08-19',
          driver: aleksandras.displayName,
          vehicle: 'MET630',
          action: 'sync_listed_driver',
          reason: decision.reason,
        });
      } else {
        patchedErikas0831 += 1;
        outcomes.push({
          date: '2026-08-31',
          driver: erikas?.displayName ?? assignment.driverName,
          vehicle: 'NLL182',
          action: 'sync_listed_driver',
          reason: decision.reason,
        });
      }
    }

    const refreshedRaw = (await this.assignments.get()).docs.map((document) => document.data() as RouteAssignment);
    const refreshedReadings = (await this.vehicleDayReadings.get()).docs.map((document) => document.data() as VehicleDayReading);
    const refreshedLite = refreshedRaw.map((assignment) => this.liteFromRouteAssignment(assignment));

    const aleks19 = refreshedRaw.find((assignment) => isAleksandras0819Met630Target(this.liteFromRouteAssignment(assignment)));
    if (!aleks19) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_verify_failed',
        missing: 'aleksandras_2026_08_19_met630',
      })}\n`);
      throw new Error('August 2026 excel backfill v4: 2026-08-19 MET630 R14;R27;R28;R51 sheet is still missing.');
    }
    const aleks19Listed = listedTripSheetDriver(aleks19, refreshedReadings);
    if (
      needsTripSheetListedDriverSync(
        { driverId: aleks19.driverId, driverName: aleks19.driverName },
        aleks19Listed,
        aleksandras.id,
        'aleksandras',
      )
    ) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_verify_failed',
        missing: 'aleksandras_2026_08_19_listed_driver',
        assignmentId: aleks19.id,
        assignmentDriverId: aleks19.driverId,
        assignmentDriverName: aleks19.driverName,
        listedDriverId: aleks19Listed.driverId,
        listedDriverName: aleks19Listed.driverName,
      })}\n`);
      throw new Error('August 2026 excel backfill v4: GET /api/trip-sheets 2026-08-19 MET630 driver is still not Aleksandras.');
    }
    if (isKarolis0819R54R11Assignment(this.liteFromRouteAssignment(aleks19))) {
      throw new Error('August 2026 excel backfill v4: refused to treat Karolis 08-19 R54;R11 as the MET630 sheet.');
    }

    const karolis0819 = refreshedLite.find((assignment) => isKarolis0819R54R11Assignment(assignment));
    if (karolis0819 && (
      karolis0819.driverId === aleksandras.id
      || normalizePersonName(karolis0819.driverName).startsWith('aleksandras')
    )) {
      throw new Error('August 2026 excel backfill v4: Karolis 2026-08-19 NLL182 R54;R11 driver was rewritten.');
    }

    const stubFingerprintsAfter = refreshedRaw
      .filter((assignment) => isAugust2026ProtectedR56StubAssignment(this.liteFromRouteAssignment(assignment)))
      .map((assignment) => august2026AssignmentFingerprint(assignment));
    if (JSON.stringify(stubFingerprintsBefore) !== JSON.stringify(stubFingerprintsAfter)) {
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4_verify_failed',
        missing: 'protected_r56_stub_unchanged',
      })}\n`);
      throw new Error('August 2026 excel backfill v4: protected 08-09/08-13/08-16 R56 stubs were rewritten.');
    }

    const erikas0831 = refreshedRaw.find((assignment) => (
      isErikas0831Nll182Assignment(this.liteFromRouteAssignment(assignment), erikas?.id ?? null)
    ));
    if (erikas0831) {
      if (!erikas) {
        throw new Error('August 2026 excel backfill v4: 2026-08-31 NLL182 is assigned to Erikas but Erikas user is missing.');
      }
      const listed0831 = listedTripSheetDriver(erikas0831, refreshedReadings);
      if (needsTripSheetListedDriverSync(
        { driverId: erikas0831.driverId, driverName: erikas0831.driverName },
        listed0831,
        erikas.id,
        'erikas',
      )) {
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v4_verify_failed',
          missing: 'erikas_2026_08_31_listed_driver',
          assignmentId: erikas0831.id,
          listedDriverId: listed0831.driverId,
          listedDriverName: listed0831.driverName,
        })}\n`);
        throw new Error('August 2026 excel backfill v4: GET /api/trip-sheets 2026-08-31 NLL182 driver is still not Erikas.');
      }
    }

    await flagRef.set({
      id: AUGUST_2026_EXCEL_BACKFILL_V4_ID,
      status: 'applied',
      appliedAt: nowIso,
      patchedAleksandras0819,
      patchedErikas0831,
      skipped,
      aleksandras19AssignmentId: aleks19.id,
      erikas0831AssignmentId: erikas0831?.id ?? null,
      outcomes,
    });
    process.stdout.write(`${JSON.stringify({
      event: 'august_2026_excel_backfill_v4_applied',
      patchedAleksandras0819,
      patchedErikas0831,
      skipped,
    })}\n`);
    return {
      applied: true,
      reason: 'applied',
      patchedAleksandras0819,
      patchedErikas0831,
      skipped,
      outcomes,
    };
  }

  private liteFromRouteAssignment(assignment: RouteAssignment): AugustAssignmentLite {
    return liteAssignmentFromSnapshot({
      id: assignment.id,
      routeId: assignment.routeId,
      driverId: assignment.driverId,
      driverName: assignment.driverName,
      status: assignment.status,
      vehicle: assignment.vehicle,
      route: assignment.routeSnapshot.route,
      stops: assignment.routeSnapshot.stops,
      shipmentLines: assignment.routeSnapshot.shipmentLines,
    });
  }

  private resolveAugustBackfillVehicleRef(
    vehicles: FleetVehicle[],
    plate: string,
    nowIso: string,
  ): FleetVehicle | null {
    const resolved = resolveAugustBackfillVehicle(vehicles, plate);
    if (!resolved) return null;
    if (resolved.source === 'fleet') return resolved.vehicle;
    return fleetVehicleFromAugustRef(resolved.vehicle, nowIso);
  }

  /**
   * v3 fleet ensure — never swallows createVehicle errors. After each create
   * the live collection is re-read so a silent write failure cannot mark the
   * flag applied. assignedDriverId stays null (do not call assignVehicle).
   */
  private async ensureAugustBackfillFleetPlatesStrict(
    vehicles: FleetVehicle[],
    nowIso: string,
  ): Promise<string[]> {
    const ensured: string[] = [];
    for (const plate of AUGUST_2026_ENSURE_FLEET_PLATES) {
      if (!shouldEnsureAugustBackfillFleetPlate(plate)) continue;
      const existing = matchVehicleByPlate(vehicles, plate);
      if (existing) {
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_fleet',
          plate,
          action: 'already_exists',
          vehicleId: existing.id,
          assignedDriverId: existing.assignedDriverId,
          at: nowIso,
        })}\n`);
        continue;
      }
      const input = august2026EnsureFleetVehicleCreateInput(plate);
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_fleet',
        plate,
        action: 'creating',
        model: input.model,
        payloadKg: input.maximumPayloadKg,
        tankLiters: input.fuelTankCapacityLiters,
        fuelNorm: input.fuelNormLPer100Km,
        at: nowIso,
      })}\n`);
      let created: FleetVehicle;
      try {
        created = await this.createVehicle(input);
      } catch (error) {
        if (error instanceof EmployeeApiError && error.code === 'VEHICLE_EXISTS') {
          const refreshed = matchVehicleByPlate(await this.listVehicles(), plate);
          if (!refreshed) {
            process.stdout.write(`${JSON.stringify({
              event: 'august_2026_excel_backfill_v3_fleet_failed',
              plate,
              error: 'VEHICLE_EXISTS but listVehicles has no matching plate',
            })}\n`);
            throw new Error(`August 2026 excel backfill v3: ${plate} reported VEHICLE_EXISTS but is absent from the fleet list.`);
          }
          if (!matchVehicleByPlate(vehicles, plate)) vehicles.push(refreshed);
          process.stdout.write(`${JSON.stringify({
            event: 'august_2026_excel_backfill_v3_fleet',
            plate,
            action: 'already_exists',
            vehicleId: refreshed.id,
            assignedDriverId: refreshed.assignedDriverId,
          })}\n`);
          continue;
        }
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_fleet_failed',
          plate,
          error: error instanceof Error ? error.message : String(error),
        })}\n`);
        throw error;
      }
      if (created.assignedDriverId !== null) {
        throw new Error(`August 2026 excel backfill v3: ${plate} was created assigned; expected unassigned.`);
      }
      vehicles.push(created);
      const verified = matchVehicleByPlate(await this.listVehicles(), plate);
      if (!verified) {
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v3_fleet_failed',
          plate,
          error: 'createVehicle returned but listVehicles does not include the plate',
        })}\n`);
        throw new Error(`August 2026 excel backfill v3: ${plate} createVehicle succeeded but the fleet list still lacks it.`);
      }
      ensured.push(plate);
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3_fleet',
        plate,
        action: 'created',
        vehicleId: verified.id,
        assignedDriverId: verified.assignedDriverId,
        at: nowIso,
      })}\n`);
    }
    return ensured;
  }

  private async rewriteAugustBackfillEmptyStub(input: {
    existing: RouteAssignment | undefined;
    existingId: string;
    day: AugustExcelDay;
    driver: { id: string; displayName: string };
    vehicle: FleetVehicle;
    geocodes: ReadonlyMap<string, Awaited<ReturnType<AugustBackfillGeocodeFn>>>;
    routeId: string;
    nowIso: string;
  }): Promise<RouteAssignment> {
    const snapshot = buildAugustBackfillRouteSnapshot(input.day, input.geocodes, input.routeId, input.nowIso);
    validateSnapshot(snapshot);
    const timestamps = historicalWorkdayTimestamps(input.day.date);
    const completed = applyAdminAssignmentComplete(snapshot, {
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      markAllDelivered: true,
    }, input.nowIso);
    const assignment: RouteAssignment = {
      id: input.existing?.id ?? input.existingId,
      routeId: input.routeId,
      driverId: input.driver.id,
      driverName: input.driver.displayName,
      status: 'completed',
      routeSnapshot: {
        route: completed.route,
        stops: completed.stops,
        shipmentLines: snapshot.shipmentLines,
      },
      progress: completed.progress,
      createdBy: input.existing?.createdBy ?? AUGUST_2026_EXCEL_BACKFILL_V3_ID,
      assignedAt: input.existing?.assignedAt ?? timestamps.startedAt,
      updatedAt: completed.updatedAt,
      vehicle: vehicleSnapshot(input.vehicle),
    };
    await this.assignments.doc(assignment.id).set(assignment);
    return assignment;
  }

  private async ensureAugustBackfillFleetPlates(
    vehicles: FleetVehicle[],
    nowIso: string,
  ): Promise<string[]> {
    const ensured: string[] = [];
    for (const plate of AUGUST_2026_ENSURE_FLEET_PLATES) {
      if (!shouldEnsureAugustBackfillFleetPlate(plate)) continue;
      if (matchVehicleByPlate(vehicles, plate)) continue;
      try {
        const created = await this.createVehicle({
          registrationNumber: plate,
          model: AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
          maximumPayloadKg: AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
          ...august2026EnsureFleetPlateSpecs(plate),
        });
        vehicles.push(created);
        ensured.push(plate);
      } catch (error) {
        if (error instanceof EmployeeApiError && error.code === 'VEHICLE_EXISTS') {
          const refreshed = matchVehicleByPlate(await this.listVehicles(), plate);
          if (refreshed && !matchVehicleByPlate(vehicles, plate)) vehicles.push(refreshed);
          continue;
        }
        process.stdout.write(`${JSON.stringify({
          event: 'august_2026_excel_backfill_v2_fleet_skip',
          plate,
          error: error instanceof Error ? error.message : String(error),
          at: nowIso,
        })}\n`);
      }
    }
    return ensured;
  }

  private async ensureLri740AugustOpeningFuel(
    vehicles: FleetVehicle[],
    users: { id: string; displayName: string; role?: string; disabled?: boolean }[],
    nowIso: string,
  ): Promise<'created' | 'already_exists' | 'skipped_vehicle_missing'> {
    const vehicle = matchVehicleByPlate(vehicles, 'LRI740')
      ?? this.resolveAugustBackfillVehicleRef(vehicles, 'LRI740', nowIso);
    if (!vehicle) return 'skipped_vehicle_missing';
    if ((await this.fuelReports.doc(AUGUST_2026_LRI740_OPENING_REPORT_ID).get()).exists) {
      return 'already_exists';
    }
    const existing = await this.fuelReports.where('vehicleId', '==', vehicle.id).get();
    const reports = existing.docs.map((document) => normalizeFuelReport(document.data() as FuelReport));
    if (alreadyHasOpeningFuel(reports, vehicle.id, AUGUST_2026_LRI740_OPENING_REPORT_ID, AUGUST_2026_LRI740_OPENING_DATE)) {
      return 'already_exists';
    }
    const karolis = matchDriverByName(users, 'Karolis Tautkus');
    const report: FuelReport = {
      id: AUGUST_2026_LRI740_OPENING_REPORT_ID,
      driverId: karolis?.id ?? 'opening-seed',
      driverName: karolis?.displayName ?? 'Karolis Tautkus',
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      assignmentRevision: vehicle.assignmentRevision,
      previousLiters: vehicle.fuelRemainingLiters,
      reportedLiters: AUGUST_2026_LRI740_OPENING_LITERS,
      status: 'approved',
      reportedAt: nowIso,
      reviewedAt: nowIso,
      reviewedBy: AUGUST_2026_EXCEL_BACKFILL_V2_ID,
      effectiveAt: AUGUST_2026_LRI740_OPENING_DATE,
      kind: 'admin_correction',
      note: AUGUST_2026_LRI740_OPENING_NOTE,
    };
    await this.fuelReports.doc(report.id).set(report);
    return 'created';
  }

  private async createAugustBackfillCompletedAssignment(input: {
    day: AugustExcelDay;
    driver: { id: string; displayName: string };
    vehicle: FleetVehicle;
    geocodes: ReadonlyMap<string, Awaited<ReturnType<AugustBackfillGeocodeFn>>>;
    routeId: string;
    nowIso: string;
    createdBy: string;
  }): Promise<RouteAssignment> {
    const snapshot = buildAugustBackfillRouteSnapshot(input.day, input.geocodes, input.routeId, input.nowIso);
    validateSnapshot(snapshot);
    const timestamps = historicalWorkdayTimestamps(input.day.date);
    const completed = applyAdminAssignmentComplete(snapshot, {
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      markAllDelivered: true,
    }, input.nowIso);
    const assignment: RouteAssignment = {
      id: randomUUID(),
      routeId: input.routeId,
      driverId: input.driver.id,
      driverName: input.driver.displayName,
      status: 'completed',
      routeSnapshot: {
        route: completed.route,
        stops: completed.stops,
        shipmentLines: snapshot.shipmentLines,
      },
      progress: completed.progress,
      createdBy: input.createdBy,
      assignedAt: timestamps.startedAt,
      updatedAt: completed.updatedAt,
      // Snapshot only — do not call assignVehicle (would steal today's fleet).
      vehicle: vehicleSnapshot(input.vehicle),
    };
    await this.assignments.doc(assignment.id).create(assignment);
    return assignment;
  }

  /** Retained for tests/catalog helpers; not called from listTripSheets. */
  private async seedNll182OpeningFuel(vehicles: FleetVehicle[]): Promise<void> {
    const vehicle = vehicles.find((item) => item.registrationNumber.toUpperCase() === 'NLL182');
    if (!vehicle) return;
    if ((await this.fuelReports.doc(NLL182_OPENING_FUEL_REPORT_ID).get()).exists) return;
    const existing = await this.fuelReports.where('vehicleId', '==', vehicle.id).get();
    const reports = existing.docs.map((document) => normalizeFuelReport(document.data() as FuelReport));
    if (alreadyHasOpeningFuel(reports, vehicle.id, NLL182_OPENING_FUEL_REPORT_ID, NLL182_OPENING_FUEL_EFFECTIVE_AT)) {
      return;
    }
    const driver = await this.resolveReadingDriver(vehicle, vehicle.assignedDriverId);
    const now = new Date().toISOString();
    const report: FuelReport = {
      id: NLL182_OPENING_FUEL_REPORT_ID,
      driverId: driver.id ?? 'opening-seed',
      driverName: driver.name === 'Nepriskirtas' ? NLL182_ODOMETER_DRIVER_NAME : driver.name,
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      assignmentRevision: vehicle.assignmentRevision,
      previousLiters: vehicle.fuelRemainingLiters,
      reportedLiters: NLL182_OPENING_FUEL_LITERS,
      status: 'approved',
      reportedAt: now,
      reviewedAt: now,
      reviewedBy: 'opening-seed',
      effectiveAt: NLL182_OPENING_FUEL_EFFECTIVE_AT,
      kind: 'admin_correction',
      note: NLL182_OPENING_FUEL_NOTE,
    };
    await this.fuelReports.doc(report.id).set(report);
  }

  /** Retained for catalog helpers; not called from listTripSheets. */
  private async seedExcelFuelLog(vehicles: FleetVehicle[]): Promise<void> {
    const byPlate = new Map(vehicles.map((vehicle) => [vehicle.registrationNumber.toUpperCase(), vehicle]));
    const existing = await this.fuelEntries.get();
    const entries = existing.docs.map((document) => document.data() as ServerFuelEntry);
    const drivers = new Map<string, { id: string | null; name: string }>();
    const now = new Date().toISOString();
    for (const fill of EXCEL_FUEL_LOG) {
      const vehicle = byPlate.get(fill.registrationNumber);
      if (!vehicle) continue;
      if (alreadyHasExcelFuelEntry(entries, fill, vehicle.id)) continue;
      let driver = drivers.get(vehicle.id);
      if (!driver) {
        driver = await this.resolveReadingDriver(vehicle, vehicle.assignedDriverId);
        drivers.set(vehicle.id, driver);
      }
      const assignmentId = vehicleDayAssignmentId(vehicle.id, fill.localDate);
      const id = excelFuelDocumentId(fill);
      const entry: ServerFuelEntry = {
        id,
        tripSheetId: `trip-sheet-${assignmentId}`,
        assignmentId,
        routeId: assignmentId,
        driverId: driver.id ?? '',
        driverName: driver.name,
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        filledAt: lithuaniaLocalToIso(fill.localDate, fill.localTime),
        odometer: excelFuelOdometer(fill.registrationNumber, fill.localDate),
        liters: fill.liters,
        pricePerLiter: null,
        totalCost: null,
        station: null,
        receiptNumber: fill.receiptNumber,
        notes: null,
        createdAt: now,
        createdBy: 'xlsx-import',
      };
      await this.fuelEntries.doc(id).set(entry);
      entries.push(entry);
    }
  }

  private async resolveReadingDriver(
    vehicle: FleetVehicle,
    driverIdInput?: string | null,
  ): Promise<{ id: string | null; name: string }> {
    const requested = driverIdInput === undefined ? vehicle.assignedDriverId : driverIdInput;
    if (requested) {
      const user = (await this.users.doc(requested).get()).data() as StoredUser | undefined;
      if (user) return { id: user.id, name: user.displayName };
      return { id: requested, name: 'Nepriskirtas' };
    }
    if (vehicle.registrationNumber.toUpperCase() === 'NLL182') {
      const users = await this.listUsers();
      const named = users.find((user) => user.displayName.trim().toLocaleLowerCase('lt') === NLL182_ODOMETER_DRIVER_NAME.toLocaleLowerCase('lt'));
      if (named) return { id: named.id, name: named.displayName };
      return { id: null, name: NLL182_ODOMETER_DRIVER_NAME };
    }
    return { id: null, name: 'Nepriskirtas' };
  }

  /**
   * Corrects a finished trip sheet: the odometer readings the day is measured
   * on, which driver actually drove it, and which fleet vehicle it used.
   * Both odometer and driver are entered by hand in the field and both are
   * regularly wrong — a misread odometer silently corrupts the distance, the
   * fuel ledger and the day's pay, and the GPS report's own "driver" column
   * was confirmed unreliable, so the office must be able to set it straight
   * afterwards. Vehicle is the same class of correction: a completed day can
   * sit on the wrong van after a swap, and quality on-time/late lives on the
   * stops, which this method never rewrites.
   *
   * The odometer lives in the assignment's route snapshot, which is the
   * server-side source of truth for a completed route, so the correction is
   * written there rather than kept in a parallel table that the trip sheet
   * would then have to reconcile on every read.
   */
  async updateTripSheet(assignmentIdInput: string, input: {
    startOdometer?: number | null;
    endOdometer?: number | null;
    driverId?: string;
    vehicleId?: string;
  }): Promise<ServerTripSheet> {
    const reference = this.assignments.doc(safeId(assignmentIdInput));
    const document = await reference.get();
    const assignment = document.data() as RouteAssignment | undefined;
    if (!assignment || assignment.status !== 'completed') {
      throw new EmployeeApiError('TRIP_SHEET_NOT_FOUND', 'Užbaigtas kelionės lapas nerastas.', 404);
    }
    const odometerTouched = input.startOdometer !== undefined || input.endOdometer !== undefined;
    const startOdometer = input.startOdometer === undefined
      ? nullableNumber(assignment.routeSnapshot.route.start_odometer)
      : validateOdometer(input.startOdometer, 'pradžios');
    const endOdometer = input.endOdometer === undefined
      ? nullableNumber(assignment.routeSnapshot.route.end_odometer)
      : validateOdometer(input.endOdometer, 'pabaigos');
    if (startOdometer !== null && endOdometer !== null && endOdometer < startOdometer) {
      throw new EmployeeApiError('INVALID_ODOMETER_RANGE', 'Odometras pabaigoje negali būti mažesnis nei pradžioje.', 400);
    }
    let driverId = assignment.driverId;
    let driverName = assignment.driverName;
    if (input.driverId !== undefined) {
      const driverDocument = await this.users.doc(safeId(input.driverId)).get();
      const driver = driverDocument.data() as StoredUser | undefined;
      // Admin accounts also drive (Karolis). Trip-sheet corrections record who
      // actually ran the day, not who is allowed to receive a new assignment.
      if (!driver || driver.disabled || (driver.role !== 'driver' && driver.role !== 'admin')) {
        throw new EmployeeApiError('DRIVER_NOT_FOUND', 'Toks vairuotojas nerastas.', 404);
      }
      driverId = driver.id;
      driverName = driver.displayName;
    }
    let vehicle = assignment.vehicle;
    if (input.vehicleId !== undefined) {
      const vehicleDocument = await this.vehicles.doc(validateVehicleId(input.vehicleId)).get();
      const stored = vehicleDocument.data() as FleetVehicle | undefined;
      const live = stored ? normalizeVehicle(stored) : undefined;
      if (!live) throw new EmployeeApiError('VEHICLE_NOT_FOUND', 'Automobilis nerastas.', 404);
      vehicle = vehicleSnapshot(live);
    }
    const updatedAt = new Date().toISOString();
    const updated = applyTripSheetVehicleDriverCorrection(assignment, {
      startOdometer,
      endOdometer,
      driverId,
      driverName,
      vehicle,
      updatedAt,
    });
    await reference.set(updated);
    const driverChanged = driverId !== assignment.driverId || driverName !== assignment.driverName;
    const vehicleChanged = (vehicle?.id ?? null) !== (assignment.vehicle?.id ?? null);
    // Fuel entries follow the sheet's driver/vehicle for reporting. Stops are
    // not touched here — on-time/late is derived from delivered_at + windows.
    if (driverChanged || vehicleChanged) {
      const entries = (await this.fuelEntries.get()).docs
        .map((entryDocument) => entryDocument.data() as ServerFuelEntry)
        .filter((entry) => entry.assignmentId === assignment.id);
      for (const entry of entries) {
        await this.fuelEntries.doc(entry.id).set({
          ...entry,
          ...(driverChanged ? { driverId, driverName } : {}),
          ...(vehicleChanged && vehicle ? {
            vehicleId: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
          } : {}),
        });
      }
    }
    const sheetVehicle = updated.vehicle ?? await this.findAssignedVehicleSnapshot(driverId);
    // A day reading covering this vehicle+date (e.g. from an odometer
    // correction import) always wins over the assignment in listTripSheets
    // (see applyDayReading) — so without this, a driver/odometer/vehicle edit
    // made here would be silently overwritten back to the reading's stale
    // values on the very next read. Only the NEW vehicle+date is synced;
    // other vehicles' readings for that day are left in place.
    if (sheetVehicle) {
      const date = tripSheetWorkDate(updated);
      const readingId = vehicleDayReadingDocId(sheetVehicle.id, date);
      const readingDocument = await this.vehicleDayReadings.doc(readingId).get();
      const existingReading = readingDocument.data() as VehicleDayReading | undefined;
      if (existingReading) {
        if (odometerTouched) {
          await this.vehicleDayReadings.doc(readingId).set(
            applyTripSheetCorrectionToDayReading(existingReading, {
              startOdometer,
              endOdometer,
              driverId,
              driverName,
              updatedAt,
            }),
          );
        } else if (existingReading.driverId !== driverId || existingReading.driverName !== driverName) {
          // Driver-only PATCH: listTripSheets overlays reading.driverName via
          // applyDayReading. Do not copy assignment odometer onto the GPS/fact
          // reading (NLL182 14 km vs a 300 km route sheet).
          await this.vehicleDayReadings.doc(readingId).set(
            applyTripSheetDriverCorrectionToDayReading(existingReading, {
              driverId,
              driverName,
              updatedAt,
            }),
          );
        }
      }
    }
    const priceSettings = await this.getRoutePriceSettings();
    const sheet = buildServerTripSheet(updated, sheetVehicle);
    return { ...sheet, fuelNormLitersPer100Km: tripSheetFuelNorm(sheet.vehicle, priceSettings) };
  }

  async updateFuelEntry(profile: EmployeeProfile, entryIdInput: string, input: {
    filledAt?: string;
    odometer?: number;
    liters?: number;
    pricePerLiter?: number | null;
    station?: string | null;
    receiptNumber?: string | null;
    notes?: string | null;
  }): Promise<ServerFuelEntry> {
    const reference = this.fuelEntries.doc(safeId(entryIdInput));
    const document = await reference.get();
    const current = document.data() as ServerFuelEntry | undefined;
    if (!current) throw new EmployeeApiError('FUEL_ENTRY_NOT_FOUND', 'Kuro įrašas nerastas.', 404);
    const storedVehicle = (await this.vehicles.doc(current.vehicleId).get()).data() as FleetVehicle | undefined;
    assertCanEditTripReadings(profile, storedVehicle ? normalizeVehicle(storedVehicle) : null, current.driverId);
    const filledAt = input.filledAt === undefined ? current.filledAt : isoDateOrThrow(input.filledAt);
    const odometer = input.odometer === undefined ? current.odometer : validateOdometer(input.odometer, 'pylimo');
    if (odometer === null) throw new EmployeeApiError('INVALID_ODOMETER', 'Neteisingas odometro rodmuo.', 400);
    const liters = input.liters === undefined ? current.liters : validateLiters(input.liters);
    const pricePerLiter = input.pricePerLiter === undefined
      ? current.pricePerLiter
      : input.pricePerLiter === null ? null : validatePricePerLiter(input.pricePerLiter);
    const updated: ServerFuelEntry = {
      ...current,
      filledAt,
      odometer,
      liters,
      pricePerLiter,
      totalCost: pricePerLiter === null ? null : Math.round(liters * pricePerLiter * 100) / 100,
      station: input.station === undefined ? current.station : optionalText(input.station),
      receiptNumber: input.receiptNumber === undefined ? current.receiptNumber : optionalText(input.receiptNumber),
      notes: input.notes === undefined ? current.notes : optionalText(input.notes),
    };
    await reference.set(updated);
    return updated;
  }

  async deleteFuelEntry(profile: EmployeeProfile, entryIdInput: string): Promise<ServerFuelEntry> {
    const reference = this.fuelEntries.doc(safeId(entryIdInput));
    const document = await reference.get();
    const entry = document.data() as ServerFuelEntry | undefined;
    if (!entry) throw new EmployeeApiError('FUEL_ENTRY_NOT_FOUND', 'Kuro įrašas nerastas.', 404);
    const storedVehicle = (await this.vehicles.doc(entry.vehicleId).get()).data() as FleetVehicle | undefined;
    assertCanEditTripReadings(profile, storedVehicle ? normalizeVehicle(storedVehicle) : null, entry.driverId);
    await reference.delete();
    return entry;
  }

  async listQualityRoutes(): Promise<QualityRouteMonitor[]> {
    const snapshot = await this.assignments.get();
    const assignments = snapshot.docs.map((document) => document.data() as RouteAssignment);
    const vehicles = await this.listVehicles();
    const currentVehicles = new Map(
      vehicles.filter((vehicle) => vehicle.assignedDriverId).map((vehicle) => [vehicle.assignedDriverId!, vehicleSnapshot(vehicle)]),
    );
    // assignment.driverName is a snapshot taken when the route was assigned —
    // renaming the driver afterwards never touches old assignments, so this
    // screen kept showing whatever placeholder name was current back then.
    // Resolve the live display name where the driver still exists.
    const currentDriverNames = new Map(
      (await this.users.get()).docs.map((document) => {
        const user = document.data() as StoredUser;
        return [user.id, user.displayName] as const;
      }),
    );
    return assignments
      .filter((assignment) => assignment.status !== 'cancelled')
      .map((assignment) => buildQualityRouteMonitor(
        { ...assignment, driverName: currentDriverNames.get(assignment.driverId) ?? assignment.driverName },
        assignment.vehicle ?? currentVehicles.get(assignment.driverId) ?? null,
      ))
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
    compensation: null,
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
    compensation: normalizeCompensation(user.compensation),
  };
}

/** Undefined (driver saved before rates existed) and malformed data both mean "use the defaults". */
export function normalizeCompensation(value: unknown): DriverCompensationRates | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<DriverCompensationRates>;
  const rate = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? Math.round(input * 1_000) / 1_000
      : fallback;
  return {
    type: source.type === 'fixed' ? 'fixed' : 'variable',
    fixedDailyNetEur: rate(source.fixedDailyNetEur, DEFAULT_COMPENSATION_RATES.fixedDailyNetEur),
    perKmEur: rate(source.perKmEur, DEFAULT_COMPENSATION_RATES.perKmEur),
    perKgEur: rate(source.perKgEur, DEFAULT_COMPENSATION_RATES.perKgEur),
    perStopEur: rate(source.perStopEur, DEFAULT_COMPENSATION_RATES.perStopEur),
  };
}

function validateCompensationInput(value: DriverCompensationRates | null): DriverCompensationRates | null {
  if (value === null) return null;
  const normalized = normalizeCompensation(value);
  if (!normalized) {
    throw new EmployeeApiError('INVALID_COMPENSATION', 'Neteisingi atlygio tarifai.', 400);
  }
  const tooLarge = normalized.fixedDailyNetEur > 1_000 || normalized.perKmEur > 100
    || normalized.perKgEur > 100 || normalized.perStopEur > 100;
  if (tooLarge) {
    throw new EmployeeApiError('INVALID_COMPENSATION', 'Atlygio tarifai atrodo neįprastai dideli.', 400);
  }
  return normalized;
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

function validateNewPin(pin: string): void {
  if (!/^\d{6,8}$/.test(pin)) throw new EmployeeApiError('INVALID_PIN', 'Naujas PIN turi būti 6–8 skaitmenų.', 400);
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

function validateRouteDate(value: string): string {
  const normalized = value.trim();
  const parsed = new Date(`${normalized}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new EmployeeApiError('INVALID_ROUTE_DATE', 'Maršruto data turi būti YYYY-MM-DD formato.', 400);
  }
  return normalized;
}

function fleetVehicleFromAugustRef(ref: AugustBackfillVehicleRef, nowIso: string): FleetVehicle {
  return {
    id: ref.id,
    registrationNumber: ref.registrationNumber,
    model: ref.model,
    maximumPayloadKg: ref.maximumPayloadKg,
    fuelNormLPer100Km: ref.fuelNormLPer100Km,
    fuelTankCapacityLiters: ref.fuelTankCapacityLiters,
    cargoBodyKind: ref.cargoBodyKind,
    palletCapacity: ref.palletCapacity,
    hasSideDoor: ref.hasSideDoor,
    cargoLengthMm: null,
    cargoWidthMm: null,
    cargoBodyType: 'van',
    wheelArchStartMm: null,
    wheelArchEndMm: null,
    wheelArchIntrusionMm: null,
    assignedDriverId: null,
    fuelRemainingLiters: null,
    fuelUpdatedAt: null,
    assignmentRevision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function vehicleSnapshot(vehicle: FleetVehicle): FleetVehicleSnapshot {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    model: vehicle.model,
    maximumPayloadKg: vehicle.maximumPayloadKg,
    cargoBodyKind: vehicle.cargoBodyKind,
    palletCapacity: vehicle.palletCapacity,
    hasSideDoor: vehicle.hasSideDoor,
    fuelNormLPer100Km: vehicle.fuelNormLPer100Km,
    fuelTankCapacityLiters: vehicle.fuelTankCapacityLiters,
    // The pallet drawing needs the real floor, so it travels with the snapshot.
    cargoLengthMm: vehicle.cargoLengthMm,
    cargoWidthMm: vehicle.cargoWidthMm,
    cargoBodyType: vehicle.cargoBodyType,
    wheelArchStartMm: vehicle.wheelArchStartMm,
    wheelArchEndMm: vehicle.wheelArchEndMm,
    wheelArchIntrusionMm: vehicle.wheelArchIntrusionMm,
    fuelRemainingLiters: vehicle.fuelRemainingLiters,
    fuelUpdatedAt: vehicle.fuelUpdatedAt,
    assignmentRevision: vehicle.assignmentRevision,
  };
}

function withLiveVehicleCargo(
  assignment: RouteAssignment,
  liveById: Map<string, FleetVehicleSnapshot>,
): RouteAssignment {
  const live = assignment.vehicle?.id ? liveById.get(assignment.vehicle.id) : undefined;
  const base = assignment.vehicle ?? live ?? null;
  if (!base) return assignment;
  const merged = {
    ...base,
    cargoBodyKind: live?.cargoBodyKind ?? base.cargoBodyKind,
    palletCapacity: live?.palletCapacity ?? base.palletCapacity,
    hasSideDoor: live?.hasSideDoor ?? base.hasSideDoor,
    fuelTankCapacityLiters: live?.fuelTankCapacityLiters ?? base.fuelTankCapacityLiters,
    cargoLengthMm: live?.cargoLengthMm ?? base.cargoLengthMm,
    cargoWidthMm: live?.cargoWidthMm ?? base.cargoWidthMm,
    cargoBodyType: live?.cargoBodyType ?? base.cargoBodyType,
    wheelArchStartMm: live?.wheelArchStartMm ?? base.wheelArchStartMm,
    wheelArchEndMm: live?.wheelArchEndMm ?? base.wheelArchEndMm,
    wheelArchIntrusionMm: live?.wheelArchIntrusionMm ?? base.wheelArchIntrusionMm,
  };
  const cargo = resolveVehicleCargo(merged);
  return {
    ...assignment,
    vehicle: {
      ...merged,
      cargoBodyKind: bodyKindFromPalletCapacity(cargo.palletCapacity),
      palletCapacity: cargo.palletCapacity,
      hasSideDoor: cargo.hasSideDoor,
      fuelTankCapacityLiters: resolveFuelTankCapacity({
        registrationNumber: merged.registrationNumber,
        fuelTankCapacityLiters: merged.fuelTankCapacityLiters,
      }),
    },
  };
}

function normalizeVehicle(vehicle: FleetVehicle): FleetVehicle {
  const cargo = resolveVehicleCargo(vehicle);
  return {
    ...vehicle,
    // Vehicles stored before the norm existed have no such field at all.
    fuelNormLPer100Km: nullableNumber(vehicle.fuelNormLPer100Km),
    fuelTankCapacityLiters: resolveFuelTankCapacity(vehicle),
    cargoBodyKind: bodyKindFromPalletCapacity(cargo.palletCapacity),
    palletCapacity: cargo.palletCapacity,
    hasSideDoor: cargo.hasSideDoor,
    // Vehicles saved before the cargo floor was recorded have none of these.
    cargoLengthMm: nullableNumber(vehicle.cargoLengthMm),
    cargoWidthMm: nullableNumber(vehicle.cargoWidthMm),
    cargoBodyType: vehicle.cargoBodyType === 'box' ? 'box' : 'van',
    wheelArchStartMm: nullableNumber(vehicle.wheelArchStartMm),
    wheelArchEndMm: nullableNumber(vehicle.wheelArchEndMm),
    wheelArchIntrusionMm: nullableNumber(vehicle.wheelArchIntrusionMm),
    fuelRemainingLiters: nullableNumber(vehicle.fuelRemainingLiters),
    fuelUpdatedAt: optionalText(vehicle.fuelUpdatedAt),
    assignmentRevision: finiteNumber(vehicle.assignmentRevision, 0),
  };
}

export function canonicalClientAddress(address: string): string {
  return address
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt')
    .replace(/gatve/g, 'g')
    .replace(/prospektas/g, 'pr')
    .replace(/[^a-z0-9]/g, '');
}

function canonicalClientName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt')
    .replace(/[^a-z0-9]/g, '');
}

function clientDirectoryKey(name: string, address: string): string {
  const addressKey = canonicalClientAddress(address);
  return addressKey && addressKey !== 'adresasnenurodytas'
    ? `address:${addressKey}`
    : `name:${canonicalClientName(name)}`;
}

export function clientDirectoryId(name: string, address: string): string {
  return `client-${createHash('sha256').update(clientDirectoryKey(name, address)).digest('hex').slice(0, 24)}`;
}

function preferredClientName(left: string, right: string): string {
  const candidates = [left, right]
    .map((value) => value.trim())
    .filter((value) => value && value !== 'Klientas nenurodytas');
  if (candidates.length === 0) return 'Klientas nenurodytas';
  return candidates.sort((a, b) => a.length - b.length || a.localeCompare(b, 'lt'))[0];
}

function preferredClientAddress(primary: string, secondary?: string): string {
  const candidates = [primary, secondary]
    .filter((value): value is string => Boolean(value && value !== 'Adresas nenurodytas'));
  if (candidates.length === 0) return 'Adresas nenurodytas';
  return candidates.sort((a, b) => b.length - a.length || a.localeCompare(b, 'lt'))[0];
}

function mergeStoredClientEntries(entries: StoredClientDirectoryEntry[]): StoredClientDirectoryEntry | null {
  if (entries.length === 0) return null;
  const newestFirst = [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const first = newestFirst[0];
  return {
    ...first,
    name: entries.map((entry) => entry.name).reduce(preferredClientName),
    address: entries.map((entry) => entry.address).reduce((left, right) => preferredClientAddress(left, right)),
    phone: newestFirst.find((entry) => entry.phone)?.phone ?? null,
    email: newestFirst.find((entry) => entry.email)?.email ?? null,
    contactPerson: newestFirst.find((entry) => entry.contactPerson)?.contactPerson ?? null,
    visitCount: Math.max(...entries.map((entry) => entry.visitCount)),
    firstSeenAt: entries.map((entry) => entry.firstSeenAt).sort()[0],
    lastSeenAt: entries.map((entry) => entry.lastSeenAt).sort().at(-1)!,
    lastDeliveredAt: entries.reduce<string | null>((latest, entry) => latestOptionalDate(latest, entry.lastDeliveredAt), null),
  };
}

function latestOptionalDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

/**
 * Applies a completed-trip-sheet office correction to the assignment snapshot.
 * Stops and shipment lines are spread, never mapped — delivered_at,
 * delivery_status and time windows stay exactly as stored so on-time/late
 * quality KPIs do not move.
 */
export function applyTripSheetVehicleDriverCorrection(
  assignment: RouteAssignment,
  input: {
    startOdometer: number | null;
    endOdometer: number | null;
    driverId: string;
    driverName: string;
    vehicle: FleetVehicleSnapshot | null;
    updatedAt: string;
  },
): RouteAssignment {
  // The distance is always end minus start. Writing the absolute odometer
  // reading into actual_distance_km is the bug that once produced 399 886 km
  // and a negative fuel balance, so it is derived here and never copied.
  const actualDistanceKm = input.startOdometer !== null && input.endOdometer !== null
    ? odometerDistanceKm(input.startOdometer, input.endOdometer)
    : nullableNumber(assignment.routeSnapshot.route.actual_distance_km);
  return {
    ...assignment,
    driverId: input.driverId,
    driverName: input.driverName,
    updatedAt: input.updatedAt,
    vehicle: input.vehicle,
    routeSnapshot: {
      ...assignment.routeSnapshot,
      route: {
        ...assignment.routeSnapshot.route,
        start_odometer: input.startOdometer,
        end_odometer: input.endOdometer,
        actual_distance_km: actualDistanceKm,
        updated_at: input.updatedAt,
      },
    },
  };
}

/** Syncs an existing vehicle-day reading for the NEW vehicle+date only. */
export function applyTripSheetCorrectionToDayReading(
  existing: VehicleDayReading,
  input: {
    startOdometer: number | null;
    endOdometer: number | null;
    driverId: string;
    driverName: string;
    updatedAt: string;
  },
): VehicleDayReading {
  return {
    ...existing,
    startOdometer: (input.startOdometer ?? existing.startOdometer),
    endOdometer: (input.endOdometer ?? existing.endOdometer),
    distanceKm: input.startOdometer !== null && input.endOdometer !== null
      ? odometerDistanceKm(input.startOdometer, input.endOdometer)
      : existing.distanceKm,
    driverId: input.driverId,
    driverName: input.driverName,
    updatedAt: input.updatedAt,
  };
}

/** Syncs only the driver snapshot on an existing vehicle-day reading. */
export function applyTripSheetDriverCorrectionToDayReading(
  existing: VehicleDayReading,
  input: {
    driverId: string;
    driverName: string;
    updatedAt: string;
  },
): VehicleDayReading {
  return {
    ...existing,
    driverId: input.driverId,
    driverName: input.driverName,
    updatedAt: input.updatedAt,
  };
}

/** Same driver fields GET /api/trip-sheets returns after applyDayReading. */
export function listedTripSheetDriver(
  assignment: RouteAssignment,
  readings: VehicleDayReading[],
): { driverId: string; driverName: string } {
  const sheet = applyDayReading(buildServerTripSheet(assignment, assignment.vehicle ?? null), readings);
  return { driverId: sheet.driverId, driverName: sheet.driverName };
}

export function august2026AssignmentFingerprint(assignment: RouteAssignment): string {
  return JSON.stringify({
    id: assignment.id,
    driverId: assignment.driverId,
    driverName: assignment.driverName,
    vehicleId: assignment.vehicle?.id ?? null,
    vehiclePlate: assignment.vehicle?.registrationNumber ?? null,
    startOdometer: assignment.routeSnapshot.route.start_odometer ?? null,
    endOdometer: assignment.routeSnapshot.route.end_odometer ?? null,
    stops: assignment.routeSnapshot.stops,
    shipmentLines: assignment.routeSnapshot.shipmentLines,
  });
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
    date: tripSheetWorkDate(assignment),
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
    fuelEntries: [],
  };
}

export function applyDayReading(sheet: ServerTripSheet, readings: VehicleDayReading[]): ServerTripSheet {
  const vehicleId = sheet.vehicle?.id;
  if (!vehicleId) return sheet;
  const reading = readings.find((item) => item.vehicleId === vehicleId && item.date === sheet.date);
  if (!reading) return sheet;
  const extraDistanceKm = extraDistanceKmOf(reading);
  if (extraDistanceKm > 0) {
    // Remainder km is fuel-only. Overlaying the vehicle-day total onto a
    // completed assignment would rewrite driver wage/quality distance.
    return { ...sheet, extraDistanceKm };
  }
  return {
    ...sheet,
    startOdometer: reading.startOdometer,
    endOdometer: reading.endOdometer,
    actualDistanceKm: reading.distanceKm,
    driverId: reading.driverId ?? sheet.driverId,
    driverName: reading.driverName ?? sheet.driverName,
  };
}

export function buildVehicleDayTripSheet(reading: VehicleDayReading, vehicle: FleetVehicleSnapshot | null): ServerTripSheet {
  const assignmentId = vehicleDayAssignmentId(reading.vehicleId, reading.date);
  return {
    id: `trip-sheet-${assignmentId}`,
    assignmentId,
    routeId: assignmentId,
    routeNumbers: [],
    status: 'completed',
    date: reading.date,
    driverId: reading.driverId ?? 'unassigned',
    driverName: reading.driverName ?? 'Nepriskirtas',
    vehicle,
    fuelNormLitersPer100Km: null,
    startOdometer: reading.startOdometer,
    endOdometer: reading.endOdometer,
    actualDistanceKm: reading.distanceKm,
    extraDistanceKm: extraDistanceKmOf(reading) > 0 ? extraDistanceKmOf(reading) : undefined,
    plannedDistanceKm: null,
    startedAt: `${reading.date}T00:00:00.000Z`,
    completedAt: `${reading.date}T23:59:59.000Z`,
    durationMinutes: null,
    totalStops: 0,
    deliveredStops: 0,
    totalWeightKg: 0,
    deliveredWeightKg: 0,
    startAddress: 'GPS odometras',
    endAddress: 'GPS odometras',
    compensation: null,
    fuelEntries: [],
  };
}

/** A day that has fuel fills but no odometer log — do not invent 0 km as GPS. */
export function buildFuelDayTripSheet(input: {
  vehicleId: string;
  date: string;
  vehicle: FleetVehicleSnapshot | null;
  driverId: string | null;
  driverName: string | null;
}): ServerTripSheet {
  const assignmentId = vehicleDayAssignmentId(input.vehicleId, input.date);
  return {
    id: `trip-sheet-${assignmentId}`,
    assignmentId,
    routeId: assignmentId,
    routeNumbers: [],
    status: 'completed',
    date: input.date,
    driverId: input.driverId || 'unassigned',
    driverName: input.driverName || 'Nepriskirtas',
    vehicle: input.vehicle,
    fuelNormLitersPer100Km: null,
    startOdometer: null,
    endOdometer: null,
    actualDistanceKm: null,
    plannedDistanceKm: null,
    startedAt: `${input.date}T00:00:00.000Z`,
    completedAt: `${input.date}T23:59:59.000Z`,
    durationMinutes: null,
    totalStops: 0,
    deliveredStops: 0,
    totalWeightKg: 0,
    deliveredWeightKg: 0,
    startAddress: 'Kuro pylimas',
    endAddress: 'Kuro pylimas',
    compensation: null,
    fuelEntries: [],
  };
}

function fuelEntriesForSheet(
  sheet: ServerTripSheet,
  byAssignment: Map<string, ServerFuelEntry[]>,
  byVehicleDate: Map<string, ServerFuelEntry[]>,
): ServerFuelEntry[] {
  const fromAssignment = byAssignment.get(sheet.assignmentId) ?? [];
  const fromVehicle = sheet.vehicle
    ? byVehicleDate.get(`${sheet.vehicle.id}:${sheet.date}`) ?? []
    : [];
  const seen = new Set<string>();
  return [...fromAssignment, ...fromVehicle]
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => left.filledAt.localeCompare(right.filledAt));
}

function isOwnedByDriver(
  profile: EmployeeProfile,
  driverId: string | null,
  vehicle: FleetVehicle | null,
): boolean {
  if (profile.role !== 'driver') return true;
  return driverId === profile.id || vehicle?.assignedDriverId === profile.id;
}

function isReadingVisibleTo(
  profile: EmployeeProfile,
  reading: VehicleDayReading,
  vehicle: FleetVehicle | null,
): boolean {
  return isOwnedByDriver(profile, reading.driverId, vehicle);
}

function assertCanEditTripReadings(
  profile: EmployeeProfile,
  vehicle: { assignedDriverId: string | null } | null,
  driverId: string | null,
): void {
  if (profile.role === 'admin' || profile.role === 'dispatcher') return;
  if (profile.permissions.canEnterTripReadings) return;
  if (profile.role === 'driver' && (driverId === profile.id || vehicle?.assignedDriverId === profile.id)) return;
  throw new EmployeeApiError('FORBIDDEN', 'Šiam veiksmui neturite teisės.', 403);
}

function validateDayOdometer(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new EmployeeApiError('INVALID_ODOMETER', 'Neteisingas odometro rodmuo.', 400);
  }
  return Math.round(value * 10) / 10;
}

export function tripSheetFuelNorm(vehicle: FleetVehicleSnapshot | null, settings: RoutePriceSettings): number | null {
  if (!vehicle) return null;
  // The norm entered on the vehicle itself wins. The registration table below
  // is a seed from "Maršruto kaina.xlsm" and cannot cover a vehicle added
  // later, which is why an unknown plate used to silently fall through to a
  // payload guess instead of the real figure.
  if (typeof vehicle.fuelNormLPer100Km === 'number' && vehicle.fuelNormLPer100Km > 0) {
    return vehicle.fuelNormLPer100Km;
  }
  const exact = settings.vehicleCosts[vehicle.registrationNumber.trim().toUpperCase()];
  if (exact) return exact.fuelNormLitersPer100Km;
  const size = vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.mediumMax
    ? 'large'
    : vehicle.maximumPayloadKg > settings.fallbackPayloadThresholdsKg.smallMax ? 'medium' : 'small';
  return settings.fallbackVehicleCosts[size].fuelNormLitersPer100Km;
}

/**
 * Day's net pay per driver. Distance comes from the odometer as soon as the
 * route is finished and falls back to the planned figure before that, which is
 * what `preliminary` and `distanceSource` report.
 *
 * `ratesByDriverId` carries what was agreed with each driver; anyone missing
 * from it is paid on DEFAULT_DRIVER_COMPENSATION.
 */
export function attachDailyCompensation(
  sheets: ServerTripSheet[],
  ratesByDriverId: Map<string, DriverCompensationRates | null> = new Map(),
): ServerTripSheet[] {
  const byDriverAndDate = new Map<string, ServerTripSheet[]>();
  for (const sheet of sheets) {
    const key = `${sheet.driverId}:${sheet.date}`;
    byDriverAndDate.set(key, [...(byDriverAndDate.get(key) ?? []), sheet]);
  }
  const compensationByKey = new Map<string, CompensationBreakdown>();
  for (const [key, daySheets] of byDriverAndDate) {
    const rates = ratesByDriverId.get(daySheets[0]!.driverId) ?? DEFAULT_DRIVER_COMPENSATION;
    const allActual = daySheets.every((sheet) => sheet.actualDistanceKm !== null);
    const distanceKm = daySheets.reduce((sum, sheet) => sum + (sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0), 0);
    const weightKg = daySheets.reduce((sum, sheet) => sum + sheet.totalWeightKg, 0);
    const stops = daySheets.reduce((sum, sheet) => sum + sheet.totalStops, 0);
    // A flat daily arrangement pays the same whatever the day looked like, so
    // the piece rates are zeroed rather than quietly added on top.
    const piecework = rates.type === 'variable';
    const fixedAmountEur = money(rates.fixedDailyNetEur);
    const distanceAmountEur = piecework ? money(distanceKm * rates.perKmEur) : 0;
    const weightAmountEur = piecework ? money(weightKg * rates.perKgEur) : 0;
    const stopsAmountEur = piecework ? money(stops * rates.perStopEur) : 0;
    compensationByKey.set(key, {
      rates,
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
  // Prefer stop delivery_status over snapshot remaining_* counters. Management
  // complete zeros remaining_stops/weight without marking pending stops
  // delivered, which otherwise produces "0/14 · 100%" quality cards.
  const honestRemainingStops = Math.max(0, totalStops - deliveredStops - failedStops);
  const pendingStops = honestRemainingStops;
  const nextIndex = stops.findIndex((stop) => !['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')));
  const next = nextIndex >= 0 ? stops[nextIndex] : null;
  const routeNumbers = uniqueRegionCodes(shipmentLines);
  const stopRegions = new Map<string, string>();
  for (const line of shipmentLines) {
    const stopId = optionalText(line.delivery_stop_id);
    const region = regionCodeFromSource(line);
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
      failureReason: optionalText(stop.failure_reason),
      failureComment: optionalText(stop.failure_comment),
    };
  });
  const totalWeightKg = finiteNumber(route.total_weight_kg, 0);
  const pendingWeightKg = stops
    .filter((stop) => !['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')))
    .reduce((total, stop) => total + finiteNumber(stop.weight_kg, 0), 0);
  const snapshotRemainingWeight = nullableNumber(route.remaining_weight_kg);
  const remainingWeightKg = pendingStops > 0
    ? pendingWeightKg
    : (snapshotRemainingWeight ?? pendingWeightKg);
  const deliveredWeightKg = Math.max(0, totalWeightKg - remainingWeightKg);
  const hasPlannedLegDistances = stops.some((stop) => nullableNumber(stop.leg_distance_km) !== null);
  const completedPlannedDistanceKm = stops
    .filter((stop) => ['delivered', 'failed'].includes(String(stop.delivery_status ?? 'pending')))
    .reduce((total, stop) => total + finiteNumber(stop.leg_distance_km, 0), 0);
  const processedStops = deliveredStops + failedStops;
  // Force 100% only when the route is closed AND every stop was actually marked.
  // Closing from management without deliveries must not look fully done.
  const fullySettled = assignment.status === 'completed' && honestRemainingStops === 0 && processedStops >= totalStops && totalStops > 0;
  const compositeProgress = calculateCompositeRouteProgress({
    completedStops: processedStops,
    totalStops,
    processedWeightKg: deliveredWeightKg,
    totalWeightKg,
    completedDistanceKm: hasPlannedLegDistances ? completedPlannedDistanceKm : null,
    totalDistanceKm: hasPlannedLegDistances ? nullableNumber(route.estimated_distance_km) : null,
    completed: fullySettled,
  });
  return {
    id: assignment.id,
    routeId: assignment.routeId,
    // route.date defaults to the day the draft was CREATED when nobody set an
    // explicit delivery date (see insertDraftRoute), which can be a different
    // calendar day than when it was actually driven — a route planned the
    // evening before, or left in a draft over a date boundary, then reported
    // under the wrong day here. Once a route has actually run, the real
    // completed/started timestamp is the honest "when did this happen" for
    // quality-control; route.date (the plan) only matters before that.
    date: optionalText(route.completed_at)?.slice(0, 10)
      ?? optionalText(route.started_at)?.slice(0, 10)
      ?? optionalText(route.date)
      ?? assignment.assignedAt.slice(0, 10),
    routeNumbers,
    status: assignment.status,
    driverId: assignment.driverId,
    driverName: assignment.driverName,
    vehicle,
    totalStops,
    deliveredStops,
    failedStops,
    remainingStops: honestRemainingStops,
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

/**
 * Old records can carry the wrong vehicle snapshot after a reassignment. If a
 * driver's separate day reading is wholly inside an already recorded route's
 * odometer interval *on the same vehicle*, it is the same driven distance, not
 * another trip. Two fleet vehicles on the same day (MET630 vs NLL182) are two
 * odometer chains — do not hide NLL182's 14 km behind a MET630 route sheet.
 */
export function odometerReadingCoveredBySheet(
  reading: VehicleDayReading,
  sheets: readonly ServerTripSheet[],
): boolean {
  if (!reading.driverId) return false;
  return sheets.some((sheet) => {
    if (sheet.driverId !== reading.driverId || sheet.date !== reading.date) return false;
    if (sheet.startOdometer === null || sheet.endOdometer === null) return false;
    if (reading.startOdometer < sheet.startOdometer || reading.endOdometer > sheet.endOdometer) return false;
    const sheetVehicleId = sheet.vehicle?.id;
    if (sheetVehicleId && sheetVehicleId !== reading.vehicleId) return false;
    return true;
  });
}

/**
 * Financial reports follow the day work actually began. A route's planning
 * date can be edited, imported incorrectly, or left several days ahead of an
 * already completed assignment; using it moved kilometres and pay to the
 * wrong day. Before work starts, the planned date remains the best available
 * value. Admin-completed routes without a start fall back to completion time.
 */
export function tripSheetWorkDate(assignment: RouteAssignment): string {
  const route = assignment.routeSnapshot.route;
  const actualReference = optionalText(route.started_at) ?? optionalText(route.completed_at);
  const actualDate = actualReference ? lithuanianDateKey(actualReference) : null;
  return actualDate ?? optionalText(route.date) ?? assignment.assignedAt.slice(0, 10);
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

function validateCargoBodyKind(value: string | null | undefined): VanBodyKind {
  if (value === undefined || value === null || value === '') return 'van_long';
  if (!isVanBodyKind(value)) {
    throw new EmployeeApiError('INVALID_CARGO_BODY', 'Kėbulas turi būti 5 PLL arba 8 PLL.', 400);
  }
  return value;
}

function validatePalletCapacity(value: number | null | undefined): PalletCapacity {
  if (!isPalletCapacity(value)) {
    throw new EmployeeApiError('INVALID_PALLET_CAPACITY', 'Kėbulo talpa turi būti 5 arba 8 PLL.', 400);
  }
  return value;
}

/** Reports written before corrections existed carry neither a date nor a kind. */
export function normalizeFuelReport(report: FuelReport): FuelReport {
  return {
    ...report,
    effectiveAt: (optionalText(report.effectiveAt) ?? report.reportedAt).slice(0, 10),
    kind: report.kind === 'admin_correction' ? 'admin_correction' : 'driver_report',
    note: optionalText(report.note),
  };
}

/**
 * Newest approved balance dated on or before `onDate` — the figure a period
 * opens on. Returns null when nothing has been confirmed yet that early.
 */
export function fuelAnchorFor(reports: FuelReport[], vehicleId: string, onDate: string): FuelAnchor | null {
  const applicable = reports
    .filter((report) => report.vehicleId === vehicleId && report.status === 'approved' && report.effectiveAt <= onDate)
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt) || right.reportedAt.localeCompare(left.reportedAt));
  const anchor = applicable[0];
  return anchor ? { liters: anchor.reportedLiters, effectiveAt: anchor.effectiveAt } : null;
}

function validateEffectiveDate(value: string): string {
  const normalized = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new EmployeeApiError('INVALID_EFFECTIVE_DATE', 'Nurodykite korekcijos datą formatu YYYY-MM-DD.', 400);
  }
  return normalized;
}

/** Cargo floor dimension in millimetres; null means "not measured". */
function validateMillimetres(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0 || value > 20_000) {
    throw new EmployeeApiError('INVALID_DIMENSION', `Neteisingas matmuo (${label}): turi būti 1–20000 mm.`, 400);
  }
  return Math.round(value);
}

/** null clears the norm and sends the vehicle back to the table/estimate fallback. */
function validateFuelNorm(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0 || value > 200) {
    throw new EmployeeApiError('INVALID_FUEL_NORM', 'Kuro norma turi būti nuo 0 iki 200 l/100 km.', 400);
  }
  return Math.round(value * 10) / 10;
}

/** null means the tank size is unknown. Not the remaining fuel in the tank. */
function validateFuelTankCapacity(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!isFuelTankCapacity(value)) {
    throw new EmployeeApiError('INVALID_TANK_CAPACITY', 'Bako talpa turi būti nuo 1 iki 400 litrų.', 400);
  }
  return Math.round(value * 10) / 10;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new EmployeeApiError('INVALID_ID', 'Neteisingas identifikatorius.', 400);
  return value;
}

function createAugustBackfillProductionGeocoder(): AugustBackfillGeocodeFn {
  const key = process.env.GOOGLE_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
  if (!key) return async () => null;
  const adapter = new GoogleGeocodingAdapter(key);
  return async (query) => {
    try {
      const { candidates } = await adapter.geocode({ address: query, language: 'lt', region: 'lt' });
      const best = candidates[0];
      return best
        ? { normalizedAddress: best.normalizedAddress, latitude: best.latitude, longitude: best.longitude }
        : null;
    } catch {
      return null;
    }
  };
}

export function validateSnapshot(snapshot: RouteSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.route || !Array.isArray(snapshot.stops) || !Array.isArray(snapshot.shipmentLines)) {
    throw new EmployeeApiError('INVALID_ROUTE_SNAPSHOT', 'Maršruto duomenys nepilni.', 400);
  }
  if (snapshot.stops.length < 1 || snapshot.stops.length > 500) {
    throw new EmployeeApiError('INVALID_ROUTE_SNAPSHOT', 'Maršrutas turi turėti 1–500 taškų.', 400);
  }
}
