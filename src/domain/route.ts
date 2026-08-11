export const ROUTE_STATUSES = [
  'draft',
  'planned',
  'loading',
  'loaded',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const PLANNING_MODES = ['with_time_windows', 'ignore_time_windows'] as const;
export type PlanningMode = (typeof PLANNING_MODES)[number];

export const LOADING_STATUSES = ['pending', 'loaded'] as const;
export type LoadingStatus = (typeof LOADING_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const IMPORT_SOURCE_TYPES = ['photo', 'document', 'pasted_text', 'manual', 'excel'] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export type Route = {
  id: string;
  vehicleId: string | null;
  date: string;
  status: RouteStatus;
  planningMode: PlanningMode | null;
  estimatedDistanceKm: number | null;
  actualDistanceKm: number | null;
  totalWeightKg: number;
  remainingWeightKg: number;
  totalStops: number;
  remainingStops: number;
  startOdometer: number | null;
  endOdometer: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  startLocation: RouteEndpoint | null;
  endLocation: RouteEndpoint | null;
  plannedDepartureAt: string | null;
  selectedRunId: string | null;
  selectedCandidateId: string | null;
  estimatedDurationMinutes: number | null;
  sourceImportAuditId: string | null;
  unknownWeightStops: number;
  remainingUnknownWeightStops: number;
  cancelledAt: string | null;
  startOdometerRecordedAt: string | null;
  startOdometerSkippedAt: string | null;
  endOdometerRecordedAt: string | null;
  activeSequenceSnapshotAt: string | null;
  completionStartedAt: string | null;
  completionEndOdometerDraft: string | null;
  returnDestinationKind?: 'warehouse' | 'home' | null;
  returnStartedAt?: string | null;
  returnArrivedAt?: string | null;
  completionSummary: RouteCompletionSummary | null;
};

export type RouteCompletionSummary = {
  totalStops: number;
  deliveredStops: number;
  failedStops: number;
  unmarkedStops: number;
  deliveredKnownWeightKg: number;
  undeliveredKnownWeightKg: number;
  unknownWeightStops: number;
  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  /** Delivered within the client window (or within 5 min of planned arrival). */
  onTimeStops: number;
  /** Delivered after the client window / planned arrival. */
  lateStops: number;
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  /** actual − planned; negative means finished earlier / shorter. */
  durationDeviationMinutes: number | null;
  distanceDeviationKm: number | null;
};

export type RouteEndpoint = {
  originalAddress: string;
  geocodingQuery: string | null;
  normalizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type AddressValidationState =
  | 'auto_confirmed'
  | 'ambiguous'
  | 'unconfirmed'
  | 'geocode_error';

export type DeliveryStop = {
  id: string;
  sourceStopId: string | null;
  routeId: string;
  originalOrder: number;
  optimizedOrder: number | null;
  activeOrder: number | null;
  orderNumber: string | null;
  recipient: string;
  address: string;
  originalAddress: string;
  geocodingQuery: string | null;
  normalizedAddress: string | null;
  addressValidationState: AddressValidationState;
  geocodingError: string | null;
  latitude: number | null;
  longitude: number | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  requiredTimeWindow: boolean;
  serviceDurationMinutes: number;
  plannedArrivalAt: string | null;
  plannedDepartureAt: string | null;
  latestEstimatedArrivalAt: string | null;
  legDistanceKm: number | null;
  legDurationMinutes: number | null;
  etaUpdatedAt: string | null;
  etaApproximate: boolean;
  weightKg: number | null;
  priorityFirst: boolean;
  phone: string | null;
  notes: string | null;
  loadingStatus: LoadingStatus;
  deliveryStatus: DeliveryStatus;
  failureReason: string | null;
  failureComment: string | null;
  loadedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportSource = {
  id: string;
  routeId: string;
  type: ImportSourceType;
  originalText: string | null;
  imageReference: string | null;
  createdAt: string;
};

export type DeliveryFilter = 'all' | 'undelivered' | 'delivered' | 'failed';

export const SAVED_LOCATION_KINDS = ['warehouse', 'home'] as const;
export type SavedLocationKind = (typeof SAVED_LOCATION_KINDS)[number];

export type SavedLocation = {
  kind: SavedLocationKind;
  label: string;
  endpoint: RouteEndpoint;
  createdAt: string;
  updatedAt: string;
};
