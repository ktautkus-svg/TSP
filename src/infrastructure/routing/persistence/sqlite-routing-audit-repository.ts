import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  MatrixRequest,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  TravelMatrix,
} from '@/domain/routing/models';
import type { MatrixCache } from '../cache/matrix-cache';

export class SQLiteRoutingAuditRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async saveOptimizationRun(
    routeId: string,
    request: RouteOptimizationRequest,
    result: RouteOptimizationResult,
  ): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO routing_engine_runs (
          id, route_id, generated_at, provider_name, provider_execution_mode,
          traffic_mode, matrix_fetched_at, planned_departure_at, request_json,
          scoring_config_json, original_order_json, feasible_route_found,
          recommended_candidate_id, selected_candidate_id, diagnostic_candidate_id, warnings_json,
          suggestions_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        result.requestId,
        routeId,
        result.generatedAt,
        result.provider,
        result.executionMode,
        request.trafficMode,
        result.matrixFetchedAt,
        request.plannedDepartureAt,
        JSON.stringify(request),
        JSON.stringify(request.scoring),
        JSON.stringify(request.stops.map((stop) => stop.id)),
        result.feasibleRouteFound ? 1 : 0,
        result.recommended?.id ?? null,
        null,
        result.diagnosticCandidate?.id ?? null,
        JSON.stringify(result.warnings),
        JSON.stringify(result.suggestions),
        new Date().toISOString(),
      );
      for (const [index, candidate] of result.candidates.entries()) {
        await this.db.runAsync(
          `INSERT INTO routing_engine_candidates (
            id, run_id, rank, recommended, selected, feasible, stop_sequence_json,
            generated_by_json, legs_json, schedules_json, total_distance_km,
            driving_minutes, service_minutes, waiting_minutes, total_work_minutes,
            tonne_kilometers, critical_rank_json, raw_score_json,
            normalized_score_json, total_score, violations_json, explanations_json,
            local_search_json, warnings_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          candidate.id,
          result.requestId,
          index + 1,
          candidate.id === result.recommended?.id ? 1 : 0,
          0,
          candidate.feasible ? 1 : 0,
          JSON.stringify(candidate.stopSequence),
          JSON.stringify(candidate.generatedBy),
          JSON.stringify(candidate.legs),
          JSON.stringify(candidate.schedules),
          candidate.totalDistanceKm,
          candidate.drivingMinutes,
          candidate.serviceMinutes,
          candidate.waitingMinutes,
          candidate.totalWorkMinutes,
          candidate.tonneKilometers,
          JSON.stringify(candidate.criticalRank),
          JSON.stringify(candidate.rawScoreComponents),
          JSON.stringify(candidate.normalizedScoreComponents),
          candidate.totalScore,
          JSON.stringify(candidate.violations),
          JSON.stringify(candidate.explanations),
          JSON.stringify(candidate.localSearch),
          JSON.stringify(candidate.warnings),
        );
      }
    });
  }

  async selectCandidate(runId: string, candidateId: string): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      const candidate = await this.db.getFirstAsync<{ id: string }>(
        'SELECT id FROM routing_engine_candidates WHERE run_id = ? AND id = ?',
        runId,
        candidateId,
      );
      if (!candidate) throw new Error('Pasirinktas kandidatas neegzistuoja.');
      await this.db.runAsync(
        'UPDATE routing_engine_candidates SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE run_id = ?',
        candidateId,
        runId,
      );
      await this.db.runAsync(
        'UPDATE routing_engine_runs SET selected_candidate_id = ? WHERE id = ?',
        candidateId,
        runId,
      );
    });
  }

  async saveRecalculation(input: {
    id: string;
    routeId: string;
    previousRunId: string | null;
    newRunId: string | null;
    triggerType:
      | 'failed_stop'
      | 'skipped_stop'
      | 'delay'
      | 'traffic'
      | 'manual_edit'
      | 'new_stop'
      | 'new_destination';
    completedStopIds: string[];
    orderBefore: string[];
    orderAfter: string[];
    timeDeltaMinutes: number | null;
    distanceDeltaKm: number | null;
    changedStopIds: string[];
    accepted: boolean | null;
    createdAt: string;
  }): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO routing_recalculations (
        id, route_id, previous_run_id, new_run_id, trigger_type,
        completed_stop_ids_json, order_before_json, order_after_json,
        time_delta_minutes, distance_delta_km, changed_stop_ids_json,
        accepted, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.routeId,
      input.previousRunId,
      input.newRunId,
      input.triggerType,
      JSON.stringify(input.completedStopIds),
      JSON.stringify(input.orderBefore),
      JSON.stringify(input.orderAfter),
      input.timeDeltaMinutes,
      input.distanceDeltaKm,
      JSON.stringify(input.changedStopIds),
      input.accepted === null ? null : input.accepted ? 1 : 0,
      input.createdAt,
    );
  }
}

export class SQLiteMatrixCache implements MatrixCache {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(key: string): Promise<TravelMatrix | null> {
    const row = await this.db.getFirstAsync<{ matrix_json: string; expires_at: string }>(
      `SELECT matrix_json, expires_at
       FROM routing_matrix_cache
       WHERE cache_key = ?`,
      key,
    );
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      await this.db.runAsync('DELETE FROM routing_matrix_cache WHERE cache_key = ?', key);
      return null;
    }
    return { ...(JSON.parse(row.matrix_json) as TravelMatrix), executionMode: 'cache' };
  }

  async set(key: string, matrix: TravelMatrix, expiresAt: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO routing_matrix_cache (
        cache_key, provider_name, request_json, matrix_json, fetched_at, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        matrix_json = excluded.matrix_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at`,
      key,
      matrix.provider,
      JSON.stringify(matrixRequestAudit(matrix)),
      JSON.stringify(matrix),
      matrix.fetchedAt,
      expiresAt,
      new Date().toISOString(),
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM routing_matrix_cache WHERE cache_key = ?', key);
  }

  async clear(): Promise<void> {
    await this.db.runAsync('DELETE FROM routing_matrix_cache');
  }
}

function matrixRequestAudit(matrix: TravelMatrix): Pick<
  MatrixRequest,
  'departureAt' | 'trafficMode'
> {
  return {
    departureAt: matrix.departureAt,
    trafficMode: matrix.trafficMode,
  };
}
