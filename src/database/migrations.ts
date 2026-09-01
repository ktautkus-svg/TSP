import type { SQLiteDatabase } from 'expo-sqlite';

export const SCHEMA_VERSION = 27;

/**
 * PWA clients that ran courtyard park-memory (#21/#22) are already at
 * `user_version` 28. That revision only added unused `location_park_memory`
 * and `delivery_stops.park_*` leftovers. The app no longer reads them, but
 * throwing here would brick those clients until site data is cleared.
 */
export const COMPATIBLE_LEGACY_SCHEMA_VERSIONS = [28] as const;

export const LEGACY_V28_DELIVERY_STOP_COLUMNS = [
  'park_latitude',
  'park_longitude',
  'park_heading',
  'park_accuracy_m',
  'park_sample_count',
  'park_sampled_at',
] as const;

export function isSupportedLocalSchemaVersion(version: number): boolean {
  return version === SCHEMA_VERSION
    || (COMPATIBLE_LEGACY_SCHEMA_VERSIONS as readonly number[]).includes(version);
}

export function omitLegacyV28StopColumns<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = { ...row };
  for (const column of LEGACY_V28_DELIVERY_STOP_COLUMNS) {
    delete next[column];
  }
  return next as T;
}

const migrationV1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','planned','loading','loaded','in_progress','completed')),
  planning_mode TEXT CHECK (planning_mode IS NULL OR planning_mode IN ('with_time_windows','ignore_time_windows')),
  estimated_distance_km REAL CHECK (estimated_distance_km IS NULL OR estimated_distance_km >= 0),
  actual_distance_km REAL CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
  total_weight_kg REAL NOT NULL DEFAULT 0 CHECK (total_weight_kg >= 0),
  remaining_weight_kg REAL NOT NULL DEFAULT 0 CHECK (remaining_weight_kg >= 0),
  total_stops INTEGER NOT NULL DEFAULT 0 CHECK (total_stops >= 0),
  remaining_stops INTEGER NOT NULL DEFAULT 0 CHECK (remaining_stops >= 0),
  start_odometer REAL CHECK (start_odometer IS NULL OR start_odometer >= 0),
  end_odometer REAL CHECK (end_odometer IS NULL OR end_odometer >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_route
ON routes ((1))
WHERE status <> 'completed';

CREATE TABLE IF NOT EXISTS delivery_stops (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  original_order INTEGER NOT NULL CHECK (original_order > 0),
  optimized_order INTEGER CHECK (optimized_order IS NULL OR optimized_order > 0),
  order_number TEXT,
  recipient TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  delivery_time_from TEXT,
  delivery_time_to TEXT,
  weight_kg REAL NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  phone TEXT,
  notes TEXT,
  loading_status TEXT NOT NULL DEFAULT 'pending' CHECK (loading_status IN ('pending','loaded')),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','delivered','failed')),
  failure_comment TEXT,
  loaded_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(route_id, original_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_optimized_order
ON delivery_stops(route_id, optimized_order)
WHERE optimized_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS stops_by_route_and_delivery_order
ON delivery_stops(route_id, optimized_order);

CREATE INDEX IF NOT EXISTS stops_by_route_and_status
ON delivery_stops(route_id, delivery_status);

CREATE TABLE IF NOT EXISTS import_sources (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo','document','pasted_text','manual')),
  original_text TEXT,
  image_reference TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL REFERENCES delivery_stops(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('delivered','failed')),
  failure_comment TEXT,
  created_at TEXT NOT NULL,
  undone_at TEXT,
  CHECK (result <> 'failed' OR length(trim(failure_comment)) > 0)
);

CREATE INDEX IF NOT EXISTS attempts_by_stop
ON delivery_attempts(stop_id, created_at);

CREATE TABLE IF NOT EXISTS action_journal (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id TEXT REFERENCES delivery_stops(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undo_expires_at TEXT,
  undone_at TEXT
);

CREATE INDEX IF NOT EXISTS undoable_actions
ON action_journal(route_id, created_at)
WHERE undone_at IS NULL;

CREATE TABLE IF NOT EXISTS route_order_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('original','optimized','manual')),
  ordered_stop_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 1;
`;

const migrationV2 = `
BEGIN IMMEDIATE;

ALTER TABLE delivery_stops
ADD COLUMN service_duration_minutes INTEGER NOT NULL DEFAULT 10
CHECK (service_duration_minutes >= 0);

ALTER TABLE delivery_stops
ADD COLUMN planned_arrival_at TEXT;

ALTER TABLE delivery_stops
ADD COLUMN planned_departure_at TEXT;

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('diesel','petrol','lpg','electric','hybrid','other')),
  base_fuel_norm_l_per_100_km REAL
    CHECK (base_fuel_norm_l_per_100_km IS NULL OR base_fuel_norm_l_per_100_km > 0),
  length_m REAL CHECK (length_m IS NULL OR length_m > 0),
  width_m REAL CHECK (width_m IS NULL OR width_m > 0),
  height_m REAL CHECK (height_m IS NULL OR height_m > 0),
  empty_weight_kg REAL CHECK (empty_weight_kg IS NULL OR empty_weight_kg >= 0),
  maximum_payload_kg REAL CHECK (maximum_payload_kg IS NULL OR maximum_payload_kg > 0),
  maximum_gross_weight_kg REAL CHECK (maximum_gross_weight_kg IS NULL OR maximum_gross_weight_kg > 0),
  home_location_json TEXT,
  warehouse_location_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    maximum_gross_weight_kg IS NULL OR empty_weight_kg IS NULL
    OR maximum_gross_weight_kg >= empty_weight_kg
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_registration_number
ON vehicles(registration_number);

ALTER TABLE routes
ADD COLUMN vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS trip_sheets (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  start_location_json TEXT NOT NULL,
  end_location_json TEXT NOT NULL,
  start_odometer REAL CHECK (start_odometer IS NULL OR start_odometer >= 0),
  end_odometer REAL CHECK (end_odometer IS NULL OR end_odometer >= 0),
  actual_distance_km REAL CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
  planned_distance_km REAL CHECK (planned_distance_km IS NULL OR planned_distance_km >= 0),
  planned_start_at TEXT,
  actual_start_at TEXT,
  planned_end_at TEXT,
  actual_end_at TEXT,
  planned_duration_minutes INTEGER CHECK (planned_duration_minutes IS NULL OR planned_duration_minutes >= 0),
  actual_duration_minutes INTEGER CHECK (actual_duration_minutes IS NULL OR actual_duration_minutes >= 0),
  planned_driving_minutes INTEGER CHECK (planned_driving_minutes IS NULL OR planned_driving_minutes >= 0),
  actual_driving_minutes INTEGER CHECK (actual_driving_minutes IS NULL OR actual_driving_minutes >= 0),
  planned_service_minutes INTEGER CHECK (planned_service_minutes IS NULL OR planned_service_minutes >= 0),
  actual_service_minutes INTEGER CHECK (actual_service_minutes IS NULL OR actual_service_minutes >= 0),
  schedule_performance_percent REAL
    CHECK (schedule_performance_percent IS NULL OR schedule_performance_percent >= 0),
  productive_time_percent REAL
    CHECK (productive_time_percent IS NULL OR productive_time_percent BETWEEN 0 AND 100),
  total_delivered_weight_kg REAL NOT NULL DEFAULT 0 CHECK (total_delivered_weight_kg >= 0),
  total_stops INTEGER NOT NULL DEFAULT 0 CHECK (total_stops >= 0),
  notes TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer)
);

CREATE INDEX IF NOT EXISTS trip_sheets_by_vehicle_and_date
ON trip_sheets(vehicle_id, date);

CREATE TABLE IF NOT EXISTS trip_sheet_routes (
  trip_sheet_id TEXT NOT NULL REFERENCES trip_sheets(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  route_order INTEGER NOT NULL CHECK (route_order > 0),
  PRIMARY KEY (trip_sheet_id, route_id),
  UNIQUE (trip_sheet_id, route_order)
);

CREATE TABLE IF NOT EXISTS fuel_entries (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  trip_sheet_id TEXT REFERENCES trip_sheets(id) ON DELETE SET NULL,
  filled_at TEXT NOT NULL,
  odometer REAL NOT NULL CHECK (odometer >= 0),
  liters REAL NOT NULL CHECK (liters > 0),
  price_per_liter REAL CHECK (price_per_liter IS NULL OR price_per_liter >= 0),
  total_cost REAL CHECK (total_cost IS NULL OR total_cost >= 0),
  full_tank INTEGER NOT NULL DEFAULT 0 CHECK (full_tank IN (0,1)),
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('diesel','petrol','lpg','electric','hybrid','other')),
  station TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fuel_entries_by_vehicle_and_odometer
ON fuel_entries(vehicle_id, odometer, filled_at);

CREATE TABLE IF NOT EXISTS route_optimization_results (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  previous_result_id TEXT REFERENCES route_optimization_results(id) ON DELETE SET NULL,
  optimization_profile TEXT NOT NULL
    CHECK (optimization_profile IN ('recommended','fastest','load_priority')),
  planning_mode TEXT NOT NULL
    CHECK (planning_mode IN ('with_time_windows','ignore_time_windows')),
  direction_strategy TEXT NOT NULL
    CHECK (direction_strategy IN ('near_to_far','far_to_near','loop','end_at_home','end_at_warehouse','end_at_custom')),
  generated_at TEXT NOT NULL,
  start_location_json TEXT NOT NULL,
  end_location_json TEXT NOT NULL,
  order_before_json TEXT NOT NULL,
  order_after_json TEXT NOT NULL,
  estimated_distance_km REAL NOT NULL CHECK (estimated_distance_km >= 0),
  estimated_driving_minutes INTEGER NOT NULL CHECK (estimated_driving_minutes >= 0),
  estimated_service_minutes INTEGER NOT NULL CHECK (estimated_service_minutes >= 0),
  estimated_waiting_minutes INTEGER NOT NULL CHECK (estimated_waiting_minutes >= 0),
  estimated_total_minutes INTEGER NOT NULL CHECK (estimated_total_minutes >= 0),
  estimated_load_distance_tonne_km REAL NOT NULL CHECK (estimated_load_distance_tonne_km >= 0),
  estimated_late_stops INTEGER NOT NULL DEFAULT 0 CHECK (estimated_late_stops >= 0),
  optimization_score REAL NOT NULL CHECK (optimization_score >= 0),
  traffic_data_timestamp TEXT,
  traffic_data_source TEXT,
  provider_name TEXT,
  criteria_version TEXT NOT NULL,
  criteria_weights_json TEXT NOT NULL,
  score_components_json TEXT NOT NULL,
  explanations_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  manual_changes_json TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_selected_optimization_per_route
ON route_optimization_results(route_id)
WHERE selected = 1;

CREATE INDEX IF NOT EXISTS optimization_results_by_route
ON route_optimization_results(route_id, generated_at);

CREATE TABLE IF NOT EXISTS route_optimization_stops (
  result_id TEXT NOT NULL REFERENCES route_optimization_results(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL REFERENCES delivery_stops(id) ON DELETE CASCADE,
  planned_order INTEGER NOT NULL CHECK (planned_order > 0),
  planned_arrival_at TEXT NOT NULL,
  planned_departure_at TEXT NOT NULL,
  leg_distance_km REAL NOT NULL CHECK (leg_distance_km >= 0),
  leg_driving_minutes INTEGER NOT NULL CHECK (leg_driving_minutes >= 0),
  waiting_minutes INTEGER NOT NULL DEFAULT 0 CHECK (waiting_minutes >= 0),
  service_minutes INTEGER NOT NULL DEFAULT 0 CHECK (service_minutes >= 0),
  remaining_load_kg_after_stop REAL NOT NULL CHECK (remaining_load_kg_after_stop >= 0),
  maneuver_penalty_points REAL NOT NULL DEFAULT 0 CHECK (maneuver_penalty_points >= 0),
  PRIMARY KEY (result_id, stop_id),
  UNIQUE (result_id, planned_order)
);

CREATE TABLE IF NOT EXISTS route_stop_constraints (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_stop_id TEXT NOT NULL REFERENCES delivery_stops(id) ON DELETE CASCADE,
  constraint_type TEXT NOT NULL CHECK (
    constraint_type IN (
      'fixed_position','deliver_first','deliver_last','deliver_before','deliver_after',
      'prefer_early','prefer_late','required_time_window','user_locked'
    )
  ),
  priority INTEGER NOT NULL DEFAULT 0,
  related_stop_id TEXT REFERENCES delivery_stops(id) ON DELETE CASCADE,
  value_json TEXT,
  is_hard_constraint INTEGER NOT NULL DEFAULT 0 CHECK (is_hard_constraint IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS constraints_by_stop
ON route_stop_constraints(delivery_stop_id);

CREATE TABLE IF NOT EXISTS manual_route_edits (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  based_on_result_id TEXT REFERENCES route_optimization_results(id) ON DELETE SET NULL,
  order_before_json TEXT NOT NULL,
  order_after_json TEXT NOT NULL,
  estimated_delta_minutes INTEGER,
  estimated_delta_km REAL,
  warning TEXT,
  created_at TEXT NOT NULL,
  reverted_at TEXT
);

CREATE TABLE IF NOT EXISTS trip_time_entries (
  id TEXT PRIMARY KEY NOT NULL,
  trip_sheet_id TEXT NOT NULL REFERENCES trip_sheets(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('driving','service','waiting','break','unplanned_idle','other')
  ),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
  source TEXT NOT NULL CHECK (source IN ('manual','derived','automatic')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trip_time_entries_by_sheet
ON trip_time_entries(trip_sheet_id, started_at);

CREATE TABLE IF NOT EXISTS location_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  normalized_location_key TEXT NOT NULL,
  note TEXT NOT NULL,
  preference_type TEXT NOT NULL CHECK (
    preference_type IN (
      'preferred_approach','difficult_u_turn','rear_access','long_service',
      'restricted_hours','vehicle_unsuitable','other'
    )
  ),
  is_hard_constraint INTEGER NOT NULL DEFAULT 0 CHECK (is_hard_constraint IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 2;
COMMIT;
`;

const migrationV3 = `
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS routing_engine_runs (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_execution_mode TEXT NOT NULL
    CHECK (provider_execution_mode IN ('real','stub','synthetic','cache')),
  traffic_mode TEXT NOT NULL CHECK (traffic_mode IN ('none','historical','live','synthetic')),
  matrix_fetched_at TEXT NOT NULL,
  planned_departure_at TEXT NOT NULL,
  request_json TEXT NOT NULL,
  scoring_config_json TEXT NOT NULL,
  original_order_json TEXT NOT NULL,
  feasible_route_found INTEGER NOT NULL CHECK (feasible_route_found IN (0,1)),
  recommended_candidate_id TEXT,
  selected_candidate_id TEXT,
  diagnostic_candidate_id TEXT,
  warnings_json TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS routing_engine_runs_by_route
ON routing_engine_runs(route_id, generated_at);

CREATE TABLE IF NOT EXISTS routing_engine_candidates (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES routing_engine_runs(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0,1)),
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
  feasible INTEGER NOT NULL CHECK (feasible IN (0,1)),
  stop_sequence_json TEXT NOT NULL,
  generated_by_json TEXT NOT NULL,
  legs_json TEXT NOT NULL,
  schedules_json TEXT NOT NULL,
  total_distance_km REAL NOT NULL CHECK (total_distance_km >= 0),
  driving_minutes REAL NOT NULL CHECK (driving_minutes >= 0),
  service_minutes REAL NOT NULL CHECK (service_minutes >= 0),
  waiting_minutes REAL NOT NULL CHECK (waiting_minutes >= 0),
  total_work_minutes REAL NOT NULL CHECK (total_work_minutes >= 0),
  tonne_kilometers REAL NOT NULL CHECK (tonne_kilometers >= 0),
  critical_rank_json TEXT NOT NULL,
  raw_score_json TEXT NOT NULL,
  normalized_score_json TEXT NOT NULL,
  total_score REAL,
  violations_json TEXT NOT NULL,
  explanations_json TEXT NOT NULL,
  local_search_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, rank)
);

CREATE INDEX IF NOT EXISTS routing_engine_candidates_by_run
ON routing_engine_candidates(run_id, rank);

CREATE TABLE IF NOT EXISTS routing_recalculations (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  previous_run_id TEXT REFERENCES routing_engine_runs(id) ON DELETE SET NULL,
  new_run_id TEXT REFERENCES routing_engine_runs(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('failed_stop','skipped_stop','delay','traffic','manual_edit','new_stop','new_destination')
  ),
  completed_stop_ids_json TEXT NOT NULL,
  order_before_json TEXT NOT NULL,
  order_after_json TEXT NOT NULL,
  time_delta_minutes REAL,
  distance_delta_km REAL,
  changed_stop_ids_json TEXT NOT NULL,
  accepted INTEGER CHECK (accepted IS NULL OR accepted IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS routing_recalculations_by_route
ON routing_recalculations(route_id, created_at);

CREATE TABLE IF NOT EXISTS routing_matrix_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  provider_name TEXT NOT NULL,
  request_json TEXT NOT NULL,
  matrix_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS routing_matrix_cache_expiry
ON routing_matrix_cache(expires_at);

PRAGMA user_version = 3;
COMMIT;
`;

const migrationV4 = `
BEGIN;

CREATE TABLE IF NOT EXISTS import_audits (
  id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('camera','gallery','pdf','clipboard','text')),
  original_file_uri TEXT,
  document_json TEXT NOT NULL,
  preprocessing_json TEXT NOT NULL,
  ocr_json TEXT NOT NULL,
  parser_result_json TEXT NOT NULL,
  duplicates_json TEXT NOT NULL,
  corrections_json TEXT NOT NULL,
  final_route_id TEXT,
  quality_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS import_audits_by_created_at
ON import_audits(created_at DESC);

PRAGMA user_version = 4;
COMMIT;
`;

// v5 turns the previously transient route-preparation flow into durable state.
// delivery_stops is rebuilt because SQLite cannot remove the legacy NOT NULL
// constraint from weight_kg with ALTER TABLE. Existing rows are preserved.
const migrationV5 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

ALTER TABLE routes ADD COLUMN start_location_json TEXT;
ALTER TABLE routes ADD COLUMN end_location_json TEXT;
ALTER TABLE routes ADD COLUMN planned_departure_at TEXT;
ALTER TABLE routes ADD COLUMN selected_run_id TEXT;
ALTER TABLE routes ADD COLUMN selected_candidate_id TEXT;
ALTER TABLE routes ADD COLUMN estimated_duration_minutes REAL
  CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0);
ALTER TABLE routes ADD COLUMN source_import_audit_id TEXT;
ALTER TABLE routes ADD COLUMN unknown_weight_stops INTEGER NOT NULL DEFAULT 0
  CHECK (unknown_weight_stops >= 0);
ALTER TABLE routes ADD COLUMN cancelled_at TEXT;

DROP INDEX IF EXISTS one_active_route;
CREATE UNIQUE INDEX one_active_route
ON routes ((1))
WHERE status <> 'completed' AND cancelled_at IS NULL;

CREATE TABLE delivery_stops_v5 (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  original_order INTEGER NOT NULL CHECK (original_order > 0),
  optimized_order INTEGER CHECK (optimized_order IS NULL OR optimized_order > 0),
  active_order INTEGER CHECK (active_order IS NULL OR active_order > 0),
  order_number TEXT,
  recipient TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  original_address TEXT NOT NULL DEFAULT '',
  geocoding_query TEXT,
  normalized_address TEXT,
  address_validation_state TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (address_validation_state IN ('auto_confirmed','ambiguous','unconfirmed','geocode_error')),
  geocoding_error TEXT,
  latitude REAL,
  longitude REAL,
  delivery_time_from TEXT,
  delivery_time_to TEXT,
  required_time_window INTEGER NOT NULL DEFAULT 0 CHECK (required_time_window IN (0,1)),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  phone TEXT,
  notes TEXT,
  loading_status TEXT NOT NULL DEFAULT 'pending' CHECK (loading_status IN ('pending','loaded')),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','delivered','failed')),
  failure_comment TEXT,
  loaded_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  service_duration_minutes INTEGER NOT NULL DEFAULT 10 CHECK (service_duration_minutes >= 0),
  planned_arrival_at TEXT,
  planned_departure_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(route_id, original_order)
);

INSERT INTO delivery_stops_v5 (
  id, route_id, original_order, optimized_order, active_order, order_number,
  recipient, address, original_address, geocoding_query, normalized_address,
  address_validation_state, latitude, longitude, delivery_time_from,
  delivery_time_to, required_time_window, weight_kg, phone, notes,
  loading_status, delivery_status, failure_comment, loaded_at, delivered_at,
  failed_at, service_duration_minutes, planned_arrival_at,
  planned_departure_at, created_at, updated_at
)
SELECT
  id, route_id, original_order, optimized_order,
  COALESCE(optimized_order, original_order), order_number, recipient, address,
  address, CASE WHEN length(trim(address)) > 0 THEN address ELSE NULL END,
  CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN address ELSE NULL END,
  CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 'auto_confirmed' ELSE 'unconfirmed' END,
  latitude, longitude, delivery_time_from, delivery_time_to, 0, weight_kg,
  phone, notes, loading_status, delivery_status, failure_comment, loaded_at,
  delivered_at, failed_at, service_duration_minutes, planned_arrival_at,
  planned_departure_at, created_at, updated_at
FROM delivery_stops;

DROP TABLE delivery_stops;
ALTER TABLE delivery_stops_v5 RENAME TO delivery_stops;

CREATE UNIQUE INDEX unique_optimized_order
ON delivery_stops(route_id, optimized_order)
WHERE optimized_order IS NOT NULL;
CREATE UNIQUE INDEX unique_active_order
ON delivery_stops(route_id, active_order)
WHERE active_order IS NOT NULL;
CREATE INDEX stops_by_route_and_delivery_order
ON delivery_stops(route_id, active_order, optimized_order, original_order);
CREATE INDEX stops_by_route_and_status
ON delivery_stops(route_id, delivery_status);

PRAGMA user_version = 5;
COMMIT;
PRAGMA foreign_keys = ON;
`;

// v6 freezes the driver workday lifecycle and all data required to restore it
// after a process restart. The route table is rebuilt solely to extend the
// status CHECK with the terminal `cancelled` state.
const migrationV6 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS one_active_route;

CREATE TABLE routes_v6 (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','planned','loading','loaded','in_progress','completed','cancelled')),
  planning_mode TEXT CHECK (planning_mode IS NULL OR planning_mode IN ('with_time_windows','ignore_time_windows')),
  estimated_distance_km REAL CHECK (estimated_distance_km IS NULL OR estimated_distance_km >= 0),
  actual_distance_km REAL CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
  total_weight_kg REAL NOT NULL DEFAULT 0 CHECK (total_weight_kg >= 0),
  remaining_weight_kg REAL NOT NULL DEFAULT 0 CHECK (remaining_weight_kg >= 0),
  total_stops INTEGER NOT NULL DEFAULT 0 CHECK (total_stops >= 0),
  remaining_stops INTEGER NOT NULL DEFAULT 0 CHECK (remaining_stops >= 0),
  start_odometer REAL CHECK (start_odometer IS NULL OR start_odometer >= 0),
  end_odometer REAL CHECK (end_odometer IS NULL OR end_odometer >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  start_location_json TEXT,
  end_location_json TEXT,
  planned_departure_at TEXT,
  selected_run_id TEXT,
  selected_candidate_id TEXT,
  estimated_duration_minutes REAL CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0),
  source_import_audit_id TEXT,
  unknown_weight_stops INTEGER NOT NULL DEFAULT 0 CHECK (unknown_weight_stops >= 0),
  remaining_unknown_weight_stops INTEGER NOT NULL DEFAULT 0 CHECK (remaining_unknown_weight_stops >= 0),
  cancelled_at TEXT,
  start_odometer_recorded_at TEXT,
  start_odometer_skipped_at TEXT,
  end_odometer_recorded_at TEXT,
  active_sequence_snapshot_at TEXT,
  completion_summary_json TEXT,
  CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer)
);

INSERT INTO routes_v6 (
  id, date, status, planning_mode, estimated_distance_km, actual_distance_km,
  total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
  start_odometer, end_odometer, created_at, updated_at, started_at, completed_at,
  vehicle_id, start_location_json, end_location_json, planned_departure_at,
  selected_run_id, selected_candidate_id, estimated_duration_minutes,
  source_import_audit_id, unknown_weight_stops, remaining_unknown_weight_stops,
  cancelled_at
)
SELECT
  id, date, CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' ELSE status END,
  planning_mode, estimated_distance_km, actual_distance_km, total_weight_kg,
  remaining_weight_kg, total_stops, remaining_stops, start_odometer,
  end_odometer, created_at, updated_at, started_at, completed_at, vehicle_id,
  start_location_json, end_location_json, planned_departure_at, selected_run_id,
  selected_candidate_id, estimated_duration_minutes, source_import_audit_id,
  unknown_weight_stops, unknown_weight_stops, cancelled_at
FROM routes;

DROP TABLE routes;
ALTER TABLE routes_v6 RENAME TO routes;

CREATE UNIQUE INDEX one_active_route
ON routes ((1))
WHERE status NOT IN ('completed','cancelled');

ALTER TABLE delivery_stops ADD COLUMN failure_reason TEXT;

CREATE TABLE IF NOT EXISTS saved_locations (
  kind TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('warehouse','home')),
  label TEXT NOT NULL,
  endpoint_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS route_history_by_completion
ON routes(completed_at DESC, date DESC)
WHERE status IN ('completed','cancelled');

PRAGMA user_version = 6;
COMMIT;
PRAGMA foreign_keys = ON;
`;

// v7 separates the globally unique persisted stop identity from the stable
// import/parser identity and records durable route-creation idempotency keys.
// Existing stop primary keys are preserved; no user route data is rewritten.
const migrationV7 = `
BEGIN IMMEDIATE;

ALTER TABLE delivery_stops ADD COLUMN source_stop_id TEXT;

CREATE INDEX IF NOT EXISTS stops_by_source_identity
ON delivery_stops(source_stop_id);

CREATE TABLE IF NOT EXISTS route_creation_commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL UNIQUE REFERENCES routes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 7;
COMMIT;
`;

// v8 persists an interrupted completion flow without changing Route status.
const migrationV8 = `
BEGIN IMMEDIATE;

ALTER TABLE routes ADD COLUMN completion_started_at TEXT;
ALTER TABLE routes ADD COLUMN completion_end_odometer_draft TEXT;

PRAGMA user_version = 8;
COMMIT;
`;

// v9 adds durable Excel import sessions and preserves every original order
// row separately from the physical DeliveryStop used by Routing Engine.
const migrationV9 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE import_sources_v9 (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo','document','pasted_text','manual','excel')),
  original_text TEXT,
  image_reference TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO import_sources_v9 SELECT * FROM import_sources;
DROP TABLE import_sources;
ALTER TABLE import_sources_v9 RENAME TO import_sources;

CREATE TABLE import_audits_v9 (
  id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('camera','gallery','pdf','clipboard','text','excel')),
  original_file_uri TEXT,
  document_json TEXT NOT NULL,
  preprocessing_json TEXT NOT NULL,
  ocr_json TEXT NOT NULL,
  parser_result_json TEXT NOT NULL,
  duplicates_json TEXT NOT NULL,
  corrections_json TEXT NOT NULL,
  final_route_id TEXT,
  quality_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO import_audits_v9 SELECT * FROM import_audits;
DROP TABLE import_audits;
ALTER TABLE import_audits_v9 RENAME TO import_audits;
CREATE INDEX import_audits_by_created_at ON import_audits(created_at DESC);

CREATE TABLE IF NOT EXISTS excel_import_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  file_hash TEXT NOT NULL,
  file_name TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  first_data_row INTEGER NOT NULL CHECK (first_data_row > 0),
  column_mapping_json TEXT NOT NULL,
  selected_route_codes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('review','ready','routed','abandoned')),
  summary_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  review_result_json TEXT,
  final_route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS excel_sessions_by_fingerprint
ON excel_import_sessions(file_hash, sheet_name, created_at DESC);

CREATE TABLE IF NOT EXISTS excel_import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  import_session_id TEXT NOT NULL REFERENCES excel_import_sessions(id) ON DELETE CASCADE,
  source_sheet_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  order_number TEXT,
  weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams >= 0),
  weight_raw TEXT,
  delivery_time_from TEXT,
  delivery_time_to TEXT,
  delivery_time_raw TEXT,
  supplier_prefix TEXT,
  recipient TEXT,
  route_code TEXT,
  raw_column_d TEXT,
  raw_column_e TEXT,
  raw_row_json TEXT NOT NULL,
  original_address TEXT,
  normalized_address TEXT,
  alternate_address TEXT,
  manual_group_key TEXT,
  issue_codes_json TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(import_session_id, source_sheet_name, source_row_number)
);
CREATE INDEX IF NOT EXISTS excel_rows_by_session
ON excel_import_rows(import_session_id, source_row_number);

CREATE TABLE IF NOT EXISTS excel_import_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  import_session_id TEXT NOT NULL REFERENCES excel_import_sessions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('row','group')),
  target_id TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value_json TEXT NOT NULL,
  corrected_value_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS excel_corrections_by_session
ON excel_import_corrections(import_session_id, created_at);

CREATE TABLE IF NOT EXISTS shipment_lines (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  delivery_stop_id TEXT NOT NULL REFERENCES delivery_stops(id) ON DELETE CASCADE,
  source_import_id TEXT NOT NULL,
  source_sheet_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  order_number TEXT,
  weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams >= 0),
  delivery_time_from TEXT,
  delivery_time_to TEXT,
  supplier_prefix TEXT,
  recipient TEXT,
  route_code TEXT,
  raw_column_d TEXT,
  raw_column_e TEXT,
  raw_row_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(route_id, source_import_id, source_sheet_name, source_row_number)
);
CREATE INDEX IF NOT EXISTS shipment_lines_by_stop
ON shipment_lines(delivery_stop_id, source_row_number);
CREATE INDEX IF NOT EXISTS shipment_lines_by_route
ON shipment_lines(route_id, delivery_stop_id);

PRAGMA user_version = 9;
COMMIT;
PRAGMA foreign_keys = ON;
`;

const migrationV10 = `
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS app_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO saved_locations (kind, label, endpoint_json, created_at, updated_at)
VALUES (
  'warehouse',
  'Savanorių pr. 180',
  '{"originalAddress":"Savanorių pr. 180, Vilnius","geocodingQuery":"Savanorių pr. 180, Vilnius","normalizedAddress":null,"latitude":null,"longitude":null}',
  '2026-08-03T00:00:00.000Z',
  '2026-08-03T00:00:00.000Z'
)
ON CONFLICT(kind) DO UPDATE SET
  label = excluded.label,
  endpoint_json = excluded.endpoint_json,
  updated_at = excluded.updated_at;

INSERT INTO saved_locations (kind, label, endpoint_json, created_at, updated_at)
VALUES (
  'home',
  'Alinkos g. 1A',
  '{"originalAddress":"Alinkos g. 1A, Elektrėnai","geocodingQuery":"Alinkos g. 1A, Elektrėnai","normalizedAddress":null,"latitude":null,"longitude":null}',
  '2026-08-03T00:00:00.000Z',
  '2026-08-03T00:00:00.000Z'
)
ON CONFLICT(kind) DO UPDATE SET
  label = excluded.label,
  endpoint_json = excluded.endpoint_json,
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO app_preferences (key, value, updated_at)
VALUES ('last_route_end_kind', 'warehouse', '2026-08-03T00:00:00.000Z');

PRAGMA user_version = 10;
COMMIT;
`;

// v11 persists the original and latest ETA separately. Existing delivered_at
// remains the factual delivery timestamp; it is never overwritten by an ETA.
const migrationV11 = `
BEGIN IMMEDIATE;

ALTER TABLE delivery_stops ADD COLUMN latest_estimated_arrival_at TEXT;
ALTER TABLE delivery_stops ADD COLUMN leg_distance_km REAL CHECK (leg_distance_km IS NULL OR leg_distance_km >= 0);
ALTER TABLE delivery_stops ADD COLUMN leg_duration_minutes REAL CHECK (leg_duration_minutes IS NULL OR leg_duration_minutes >= 0);
ALTER TABLE delivery_stops ADD COLUMN eta_updated_at TEXT;
ALTER TABLE delivery_stops ADD COLUMN eta_approximate INTEGER NOT NULL DEFAULT 0 CHECK (eta_approximate IN (0,1));

UPDATE delivery_stops
SET latest_estimated_arrival_at = planned_arrival_at,
    eta_updated_at = updated_at
WHERE planned_arrival_at IS NOT NULL;

INSERT OR IGNORE INTO app_preferences (key, value, updated_at)
VALUES ('last_planning_mode', 'with_time_windows', '2026-08-03T00:00:00.000Z');

PRAGMA user_version = 11;
COMMIT;
`;

// v12 lets the user pin a single stop as "priority first" so the optimizer
// is forced to unload it before every other stop, instead of only being
// able to influence order indirectly through weight/distance heuristics.
const migrationV12 = `
BEGIN IMMEDIATE;

ALTER TABLE delivery_stops ADD COLUMN priority_first INTEGER NOT NULL DEFAULT 0 CHECK (priority_first IN (0,1));

PRAGMA user_version = 12;
COMMIT;
`;

// v13 links a server-side employee assignment to its offline SQLite route.
// Business route tables remain unchanged; this metadata is safe to rebuild.
const migrationV13 = `
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS route_sync_state (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL UNIQUE REFERENCES routes(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  server_revision TEXT NOT NULL,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('synced','pending','conflict')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS route_sync_by_employee
ON route_sync_state(employee_id, updated_at);

PRAGMA user_version = 13;
COMMIT;
`;

// v14 replaces the flat ten-minute unloading estimate with a weight-derived one,
// so a heavy drop is planned as the longer stop it actually is. Only pending
// stops are touched; delivered history keeps the time it was planned with.
// The numbers are written out rather than read from the service-time model on
// purpose: a migration must produce the same result forever, even after the
// model is retuned.
const migrationV14 = `
BEGIN IMMEDIATE;

UPDATE delivery_stops
SET service_duration_minutes = CASE
  WHEN weight_kg IS NULL THEN 10
  ELSE MAX(5, MIN(45, CAST(ROUND(MAX(weight_kg, 0) / 5.0) AS INTEGER)))
END
WHERE delivery_status = 'pending';

PRAGMA user_version = 14;
COMMIT;
`;

// v15 adds cross-device cloud sync bookkeeping to routes. `cloud_synced_at`
// is deliberately left NULL for every pre-existing row: the sync engine
// treats `cloud_synced_at IS NULL OR updated_at > cloud_synced_at` as "needs
// upload", so every route created before this migration is automatically
// picked up on the first sync — no separate migration flag or step needed.
const migrationV15 = `
BEGIN IMMEDIATE;

ALTER TABLE routes ADD COLUMN cloud_synced_at TEXT;
ALTER TABLE routes ADD COLUMN cloud_deleted_at TEXT;

PRAGMA user_version = 15;
COMMIT;
`;

// v16 makes cloud sync account-aware and gives deferred pulls a durable home.
// Everything here is additive: no table is rebuilt, no row is rewritten and no
// data is deleted except the single device-global sync cursor, which cannot be
// attributed to an account and is therefore dropped so each account re-pulls
// once (applying a pulled snapshot is idempotent).
//
// `routes.owner_employee_id` is NULL for every existing row. It is claimed on
// the first sync by the first account to sync on this device, and *only* by
// that account — see `claimLocalRoutes` in route-cloud-sync.ts. A second
// account claims nothing it did not create, so one employee's route history
// can never be uploaded into another employee's cloud account.
const migrationV16 = `
BEGIN IMMEDIATE;

ALTER TABLE routes ADD COLUMN owner_employee_id TEXT;

CREATE INDEX IF NOT EXISTS routes_by_cloud_owner
ON routes(owner_employee_id, updated_at);

CREATE TABLE IF NOT EXISTS sync_accounts (
  employee_id TEXT PRIMARY KEY NOT NULL,
  claim_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  entity TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  cursor TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity, employee_id)
);

CREATE TABLE IF NOT EXISTS route_sync_deferrals (
  route_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  server_updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (route_id, employee_id)
);

DELETE FROM app_preferences WHERE key = 'route_cloud_sync_cursor';

PRAGMA user_version = 16;
COMMIT;
`;

// v17 allows several planned routes while still enforcing a single route that
// is physically being worked. Return-to-base progress stays separate from the
// delivery status so history is reached only after arrival and final odometer.
const migrationV17 = `
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS one_active_route;
CREATE UNIQUE INDEX IF NOT EXISTS one_working_route
ON routes ((1))
WHERE status IN ('loading','loaded','in_progress');

ALTER TABLE routes ADD COLUMN return_destination_kind TEXT
  CHECK (return_destination_kind IS NULL OR return_destination_kind IN ('warehouse','home'));
ALTER TABLE routes ADD COLUMN return_started_at TEXT;
ALTER TABLE routes ADD COLUMN return_arrived_at TEXT;

PRAGMA user_version = 17;
COMMIT;
`;

// v18 was previously released from the operations branch. Keep its exact
// version number and route-guard semantics so devices that already reached v18
// can move forward without a downgrade or database reset.
const migrationV18 = `
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS one_active_route;
CREATE UNIQUE INDEX one_active_route
ON routes ((1))
WHERE status IN ('draft','loading','loaded','in_progress');

PRAGMA user_version = 18;
COMMIT;
`;

// v17 had two independently released shapes. v19 gives both lines one
// canonical route guard; missing return columns are added conditionally by
// ensureRouteReturnColumns before this SQL is executed.
const migrationV19 = `
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS one_working_route;
DROP INDEX IF EXISTS one_active_route;
CREATE UNIQUE INDEX one_active_route
ON routes ((1))
WHERE status IN ('draft','loading','loaded','in_progress');

PRAGMA user_version = 19;
COMMIT;
`;

// v20 restores the intended multi-route workflow: administrators may prepare
// and schedule many routes while a driver device still protects the single
// route that is physically being loaded or driven.
const migrationV20 = `
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS one_active_route;
DROP INDEX IF EXISTS one_working_route;
CREATE UNIQUE INDEX one_working_route
ON routes ((1))
WHERE status IN ('loading','loaded','in_progress');

PRAGMA user_version = 20;
COMMIT;
`;

// v21 stores the exact order in which priority stops were selected. The old
// boolean remains for backwards-compatible cloud snapshots and quick filters.
const migrationV21 = `
BEGIN IMMEDIATE;

ALTER TABLE delivery_stops ADD COLUMN priority_rank INTEGER
  CHECK (priority_rank IS NULL OR priority_rank > 0);

UPDATE delivery_stops
SET priority_rank = (
  SELECT COUNT(*)
  FROM delivery_stops earlier
  WHERE earlier.route_id = delivery_stops.route_id
    AND earlier.priority_first = 1
    AND (
      earlier.original_order < delivery_stops.original_order
      OR (earlier.original_order = delivery_stops.original_order AND earlier.id <= delivery_stops.id)
    )
)
WHERE priority_first = 1;

CREATE INDEX priority_stops_by_route_and_rank
ON delivery_stops(route_id, priority_rank)
WHERE priority_rank IS NOT NULL;

PRAGMA user_version = 21;
COMMIT;
`;

// v22 remembers confirmed address resolutions. Re-importing the same address
// can then reuse the driver's correction instead of asking again or paying for
// another provider lookup.
const migrationV22 = `
BEGIN IMMEDIATE;

CREATE TABLE address_resolution_memory (
  address_key TEXT PRIMARY KEY NOT NULL,
  source_address TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  place_id TEXT,
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 22;
COMMIT;
`;

const migrationV23 = `
BEGIN IMMEDIATE;

ALTER TABLE vehicles ADD COLUMN technical_inspection_due_on TEXT;
ALTER TABLE vehicles ADD COLUMN road_tax_due_on TEXT;
ALTER TABLE vehicles ADD COLUMN next_service_due_on TEXT;
ALTER TABLE vehicles ADD COLUMN next_service_odometer REAL
  CHECK (next_service_odometer IS NULL OR next_service_odometer >= 0);

CREATE TABLE vehicle_faults (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL CHECK (length(trim(comment)) > 0),
  reported_by TEXT,
  reported_at TEXT NOT NULL,
  notified_at TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX vehicle_faults_by_vehicle ON vehicle_faults(vehicle_id, reported_at);

CREATE TABLE operational_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('administration','dispatcher','warehouse','other')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role_label TEXT,
  phone TEXT NOT NULL CHECK (length(trim(phone)) > 0),
  is_emergency INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX operational_contacts_by_kind ON operational_contacts(kind, sort_order, created_at);

PRAGMA user_version = 23;
COMMIT;
`;

const migrationV24 = `
BEGIN IMMEDIATE;

CREATE TABLE vehicle_departure_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL CHECK (length(trim(fingerprint)) > 0),
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX vehicle_departure_overrides_by_vehicle
  ON vehicle_departure_overrides(vehicle_id, updated_at);

PRAGMA user_version = 24;
COMMIT;
`;

const migrationV25 = `
BEGIN IMMEDIATE;

ALTER TABLE fuel_entries ADD COLUMN receipt_number TEXT;

PRAGMA user_version = 25;
COMMIT;
`;

const migrationV26 = `
BEGIN IMMEDIATE;

ALTER TABLE vehicles ADD COLUMN insurance_due_on TEXT;

PRAGMA user_version = 26;
COMMIT;
`;

// v27 remembers a recipient's phone number the first time anyone types it in
// for a delivery address, so re-importing the same address later fills the
// phone in automatically instead of asking every driver to type it again.
const migrationV27 = `
BEGIN IMMEDIATE;

CREATE TABLE contact_phone_memory (
  address_key TEXT PRIMARY KEY NOT NULL,
  phone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 27;
COMMIT;
`;

async function ensureRouteReturnColumns(db: SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(routes)');
  const names = new Set(columns.map((column) => column.name));
  if (
    names.has('return_destination_kind')
    && names.has('return_started_at')
    && names.has('return_arrived_at')
  ) return;

  await db.withTransactionAsync(async () => {
    if (!names.has('return_destination_kind')) {
      await db.execAsync(`ALTER TABLE routes ADD COLUMN return_destination_kind TEXT
        CHECK (return_destination_kind IS NULL OR return_destination_kind IN ('warehouse','home'));`);
    }
    if (!names.has('return_started_at')) {
      await db.execAsync('ALTER TABLE routes ADD COLUMN return_started_at TEXT;');
    }
    if (!names.has('return_arrived_at')) {
      await db.execAsync('ALTER TABLE routes ADD COLUMN return_arrived_at TEXT;');
    }
  });
}

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = result?.user_version ?? 0;

  if (currentVersion > SCHEMA_VERSION) {
    if (isSupportedLocalSchemaVersion(currentVersion)) {
      return;
    }
    throw new Error(
      `Duomenų bazės versija ${currentVersion} yra naujesnė už programos palaikomą ${SCHEMA_VERSION}.`,
    );
  }

  if (currentVersion < 1) {
    await db.execAsync(migrationV1);
    currentVersion = 1;
  }

  if (currentVersion < 2) {
    await db.execAsync(migrationV2);
    currentVersion = 2;
  }

  if (currentVersion < 3) {
    await db.execAsync(migrationV3);
    currentVersion = 3;
  }

  if (currentVersion < 4) {
    await db.execAsync(migrationV4);
    currentVersion = 4;
  }

  if (currentVersion < 5) {
    await db.execAsync(migrationV5);
    currentVersion = 5;
  }

  if (currentVersion < 6) {
    await db.execAsync(migrationV6);
    currentVersion = 6;
  }

  if (currentVersion < 7) {
    await db.execAsync(migrationV7);
    currentVersion = 7;
  }

  if (currentVersion < 8) {
    await db.execAsync(migrationV8);
    currentVersion = 8;
  }

  if (currentVersion < 9) {
    await db.execAsync(migrationV9);
    currentVersion = 9;
  }

  if (currentVersion < 10) {
    await db.execAsync(migrationV10);
    currentVersion = 10;
  }

  if (currentVersion < 11) {
    await db.execAsync(migrationV11);
    currentVersion = 11;
  }

  if (currentVersion < 12) {
    await db.execAsync(migrationV12);
    currentVersion = 12;
  }

  if (currentVersion < 13) {
    await db.execAsync(migrationV13);
    currentVersion = 13;
  }

  if (currentVersion < 14) {
    await db.execAsync(migrationV14);
    currentVersion = 14;
  }

  if (currentVersion < 15) {
    await db.execAsync(migrationV15);
    currentVersion = 15;
  }

  if (currentVersion < 16) {
    await db.execAsync(migrationV16);
    currentVersion = 16;
  }

  if (currentVersion < 17) {
    await db.execAsync(migrationV17);
    currentVersion = 17;
  }

  if (currentVersion < 18) {
    await db.execAsync(migrationV18);
    currentVersion = 18;
  }

  if (currentVersion < 19) {
    await ensureRouteReturnColumns(db);
    await db.execAsync(migrationV19);
    currentVersion = 19;
  }

  if (currentVersion < 20) {
    await db.execAsync(migrationV20);
    currentVersion = 20;
  }

  if (currentVersion < 21) {
    await db.execAsync(migrationV21);
    currentVersion = 21;
  }

  if (currentVersion < 22) {
    await db.execAsync(migrationV22);
    currentVersion = 22;
  }

  if (currentVersion < 23) {
    await db.execAsync(migrationV23);
    currentVersion = 23;
  }

  if (currentVersion < 24) {
    await db.execAsync(migrationV24);
    currentVersion = 24;
  }

  if (currentVersion < 25) {
    await db.execAsync(migrationV25);
    currentVersion = 25;
  }

  if (currentVersion < 26) {
    await db.execAsync(migrationV26);
    currentVersion = 26;
  }

  if (currentVersion < 27) {
    await db.execAsync(migrationV27);
  }
}
