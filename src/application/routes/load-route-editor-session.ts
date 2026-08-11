import type { SQLiteDatabase } from 'expo-sqlite';

import { buildOptimizationRequestFromRoute } from '@/application/routes/route-request-builder';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { RouteRepository } from '@/database/repositories/route-repository';
import type {
  CandidateLeg,
  CandidateStopSchedule,
  CriticalRank,
  ExplanationEvidence,
  LocalSearchStats,
  NormalizedScoreComponents,
  RawScoreComponents,
  RouteCandidate,
  RouteOptimizationRequest,
  TravelMatrix,
} from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { FallbackTravelCostProvider } from '@/infrastructure/routing/providers/fallback-travel-cost-provider';
import { GoogleTravelCostProvider, HereTravelCostProvider } from '@/infrastructure/routing/providers/gateway-travel-cost-provider';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';

export type RouteEditorSession = {
  request: RouteOptimizationRequest;
  matrix: TravelMatrix;
  runId: string;
  candidate: RouteCandidate;
  baselineSequence: string[];
};

type CandidateRow = {
  id: string;
  stop_sequence_json: string;
  generated_by_json: string;
  legs_json: string;
  schedules_json: string;
  total_distance_km: number;
  driving_minutes: number;
  service_minutes: number;
  waiting_minutes: number;
  total_work_minutes: number;
  tonne_kilometers: number;
  critical_rank_json: string;
  raw_score_json: string;
  normalized_score_json: string;
  total_score: number | null;
  violations_json: string;
  explanations_json: string;
  local_search_json: string;
  warnings_json: string;
  feasible: number;
  provider_name: string;
};

type RunRow = {
  id: string;
  request_json: string;
  provider_name: string;
  provider_execution_mode: string;
};

function createTravelProvider() {
  return new FallbackTravelCostProvider([
    new GoogleTravelCostProvider(),
    new HereTravelCostProvider(),
    new SyntheticTravelCostProvider('linear'),
  ]);
}

function candidateFromRow(row: CandidateRow): RouteCandidate {
  return {
    id: row.id,
    provider: row.provider_name,
    stopSequence: JSON.parse(row.stop_sequence_json) as string[],
    generatedBy: JSON.parse(row.generated_by_json) as string[],
    schedules: JSON.parse(row.schedules_json) as CandidateStopSchedule[],
    legs: JSON.parse(row.legs_json) as CandidateLeg[],
    totalDistanceKm: row.total_distance_km,
    drivingMinutes: row.driving_minutes,
    serviceMinutes: row.service_minutes,
    waitingMinutes: row.waiting_minutes,
    totalWorkMinutes: row.total_work_minutes,
    totalLateMinutes: 0,
    maximumSingleStopLateMinutes: 0,
    tonneKilometers: row.tonne_kilometers,
    directionalityPenalty: 0,
    maneuverPenalty: 0,
    violations: JSON.parse(row.violations_json),
    feasible: row.feasible === 1,
    criticalRank: JSON.parse(row.critical_rank_json) as CriticalRank,
    rawScoreComponents: JSON.parse(row.raw_score_json) as RawScoreComponents,
    normalizedScoreComponents: JSON.parse(row.normalized_score_json) as NormalizedScoreComponents,
    totalScore: row.total_score,
    localSearch: JSON.parse(row.local_search_json) as LocalSearchStats,
    warnings: JSON.parse(row.warnings_json) as string[],
    explanations: JSON.parse(row.explanations_json) as ExplanationEvidence[],
  };
}

async function fetchMatrix(request: RouteOptimizationRequest): Promise<TravelMatrix> {
  return createTravelProvider().getMatrix({
    locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
    vehicle: request.vehicle,
    departureAt: request.plannedDepartureAt,
    trafficMode: request.trafficMode,
    timeoutMs: Math.max(1_000, request.maxCalculationMs * 2),
  });
}

/**
 * Loads the selected optimization run/candidate for the route editor.
 * Falls back to rebuilding a request from persisted stops when audit rows are missing.
 */
export async function loadRouteEditorSession(
  db: SQLiteDatabase,
  routeId: string,
  runId?: string | null,
  candidateId?: string | null,
): Promise<RouteEditorSession> {
  const repository = new RouteRepository(db);
  const persisted = await repository.getWithStops(routeId);
  if (!persisted) throw new Error('Maršrutas nerastas.');
  if (persisted.route.status !== 'draft') {
    throw new Error('Maršrutą redaguoti galima tik juodraščio būsenoje.');
  }

  let run = runId
    ? await db.getFirstAsync<RunRow>(
      'SELECT id, request_json, provider_name, provider_execution_mode FROM routing_engine_runs WHERE id = ? AND route_id = ?',
      runId,
      routeId,
    )
    : null;

  if (!run) {
    run = await db.getFirstAsync<RunRow>(
      `SELECT id, request_json, provider_name, provider_execution_mode
       FROM routing_engine_runs
       WHERE route_id = ?
       ORDER BY generated_at DESC
       LIMIT 1`,
      routeId,
    );
  }

  if (run) {
    const request = JSON.parse(run.request_json) as RouteOptimizationRequest;
    const candidateRow = candidateId
      ? await db.getFirstAsync<CandidateRow>(
        `SELECT c.*, r.provider_name
         FROM routing_engine_candidates c
         JOIN routing_engine_runs r ON r.id = c.run_id
         WHERE c.run_id = ? AND c.id = ?`,
        run.id,
        candidateId,
      )
      : await db.getFirstAsync<CandidateRow>(
        `SELECT c.*, r.provider_name
         FROM routing_engine_candidates c
         JOIN routing_engine_runs r ON r.id = c.run_id
         WHERE c.run_id = ?
         ORDER BY c.recommended DESC, c.rank ASC
         LIMIT 1`,
        run.id,
      );
    if (candidateRow) {
      const candidate = candidateFromRow(candidateRow);
      const matrix = await fetchMatrix(request);
      return {
        request,
        matrix,
        runId: run.id,
        candidate,
        baselineSequence: [...candidate.stopSequence],
      };
    }
  }

  const request = buildOptimizationRequestFromRoute(persisted.route, persisted.stops);
  const result = await new RoutingEngine(createTravelProvider()).optimize(request);
  const candidate = result.recommended ?? result.diagnosticCandidate ?? result.candidates[0];
  if (!candidate) throw new Error('Nepavyko paruošti maršruto sekos redagavimui.');
  await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, request, result);
  return {
    request,
    matrix: result.matrix,
    runId: result.requestId,
    candidate,
    baselineSequence: [...candidate.stopSequence],
  };
}
