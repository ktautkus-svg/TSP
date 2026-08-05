import type {
  CandidateLeg,
  CandidateStopSchedule,
  ConstraintViolation,
  CriticalRank,
  RouteOptimizationRequest,
} from '../models';
import { summarizeStopWeights } from '../weights';

export function evaluateConstraints(input: {
  stopSequence: string[];
  schedules: CandidateStopSchedule[];
  legs: CandidateLeg[];
  request: RouteOptimizationRequest;
  matrixNodeIds: string[];
}): { violations: ConstraintViolation[]; criticalRank: CriticalRank } {
  const { stopSequence, schedules, legs, request, matrixNodeIds } = input;
  const violations: ConstraintViolation[] = [];
  const expectedIds = request.stops.map((stop) => stop.id);
  const counts = new Map<string, number>();
  stopSequence.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));

  for (const id of expectedIds) {
    if (!counts.has(id)) {
      violations.push(violation('MISSING_STOP', id, 'Privalomas taškas neįtrauktas.', 0, 1));
    } else if ((counts.get(id) ?? 0) > 1) {
      violations.push(
        violation('DUPLICATE_STOP', id, 'Taškas maršrute pakartotas.', counts.get(id)!, 1),
      );
    }
  }
  for (const id of stopSequence) {
    if (!expectedIds.includes(id)) {
      violations.push(violation('UNKNOWN_STOP', id, 'Maršrute yra nežinomas taškas.', id, null));
    }
  }

  const totalPayload =
    request.initialLoadKg ?? summarizeStopWeights(request.stops).knownTotalKg;
  if (totalPayload > request.vehicle.maximumPayloadKg) {
    violations.push(
      violation(
        'MAX_PAYLOAD',
        null,
        'Pradinis krovinys viršija transporto priemonės ribą.',
        totalPayload,
        request.vehicle.maximumPayloadKg,
      ),
    );
  }

  const position = new Map(stopSequence.map((id, index) => [id, index + 1]));
  for (const stop of request.stops) {
    const actual = position.get(stop.id);
    if (actual === undefined) continue;
    if (stop.lockedPosition !== undefined && actual !== stop.lockedPosition) {
      violations.push(
        violation(
          'LOCKED_POSITION',
          stop.id,
          'Neišlaikyta užrakinta taško pozicija.',
          actual,
          stop.lockedPosition,
        ),
      );
    }
    if (stop.mustBeFirst && actual !== 1) {
      violations.push(
        violation('MUST_BE_FIRST', stop.id, 'Taškas privalo būti pirmas.', actual, 1),
      );
    }
    if (stop.mustBeLast && actual !== stopSequence.length) {
      violations.push(
        violation(
          'MUST_BE_LAST',
          stop.id,
          'Taškas privalo būti paskutinis.',
          actual,
          stopSequence.length,
        ),
      );
    }
    for (const relatedId of stop.deliverBeforeStopIds) {
      const related = position.get(relatedId);
      if (related !== undefined && actual >= related) {
        violations.push(
          violation(
            'DELIVER_BEFORE',
            stop.id,
            `Taškas turi būti prieš ${relatedId}.`,
            `${actual} >= ${related}`,
            `${actual} < ${related}`,
          ),
        );
      }
    }
    for (const relatedId of stop.deliverAfterStopIds) {
      const related = position.get(relatedId);
      if (related !== undefined && actual <= related) {
        violations.push(
          violation(
            'DELIVER_AFTER',
            stop.id,
            `Taškas turi būti po ${relatedId}.`,
            `${actual} <= ${related}`,
            `${actual} > ${related}`,
          ),
        );
      }
    }
  }

  for (const schedule of schedules) {
    const stop = request.stops.find((item) => item.id === schedule.stopId);
    if (
      request.planningMode === 'with_time_windows' &&
      stop?.requiredTimeWindow &&
      schedule.lateMinutes > request.scoring.tolerances.requiredWindowMinutes
    ) {
      violations.push(
        violation(
          'REQUIRED_TIME_WINDOW',
          stop.id,
          'Pristatymo laiko langas gali būti pažeistas — tai rekomendacija, ne kliūtis pasirinkti maršrutą.',
          schedule.lateMinutes,
          request.scoring.tolerances.requiredWindowMinutes,
          'soft',
        ),
      );
    }
  }

  for (const leg of legs) {
    if (!matrixNodeIds.includes(leg.fromId) || !matrixNodeIds.includes(leg.toId)) {
      violations.push(
        violation(
          'UNREACHABLE_LEG',
          leg.toId,
          'Atkarpos taško nėra matricoje.',
          `${leg.fromId} → ${leg.toId}`,
          'reachable',
        ),
      );
    }
    if (!leg.reachable || !Number.isFinite(leg.distanceKm) || !Number.isFinite(leg.durationMinutes)) {
      violations.push(
        violation(
          'UNREACHABLE_LEG',
          leg.toId,
          'Atkarpa nepasiekiama.',
          `${leg.fromId} → ${leg.toId}`,
          'reachable',
        ),
      );
    }
    if (request.vehicle.useRoadRestrictions && leg.restrictionWarnings.length > 0) {
      violations.push(
        violation(
          'ROAD_RESTRICTION',
          leg.toId,
          'Atkarpa pažeidžia transporto priemonės kelio apribojimą.',
          leg.restrictionWarnings.join('; '),
          'no restriction warning',
        ),
      );
    }
  }

  if (!matrixNodeIds.includes(request.startLocation.id)) {
    violations.push(
      violation('INVALID_START', null, 'Pradžios vietos nėra matricoje.', request.startLocation.id, 'matrix node'),
    );
  }
  if (!matrixNodeIds.includes(request.endLocation.id)) {
    violations.push(
      violation('INVALID_END', null, 'Pabaigos vietos nėra matricoje.', request.endLocation.id, 'matrix node'),
    );
  }

  const lastDeparture = legs.at(-1)?.arrivalAt;
  let workdayOverrunMinutes = 0;
  if (request.workdayEndAt && lastDeparture) {
    workdayOverrunMinutes = Math.max(
      0,
      (Date.parse(lastDeparture) - Date.parse(request.workdayEndAt)) / 60_000,
    );
    if (workdayOverrunMinutes > 0) {
      violations.push(
        violation(
          'WORKDAY_END',
          null,
          'Maršrutas viršija darbo laiko ribą.',
          workdayOverrunMinutes,
          0,
        ),
      );
    }
  }

  const late = schedules.map((schedule) => schedule.lateMinutes);
  return {
    violations,
    criticalRank: {
      unservedRequiredStops: violations.filter((item) => item.code === 'MISSING_STOP').length,
      requiredWindowViolations: violations.filter(
        (item) => item.code === 'REQUIRED_TIME_WINDOW',
      ).length,
      totalLateMinutes: late.reduce((sum, value) => sum + value, 0),
      maximumSingleStopLateMinutes: Math.max(0, ...late),
      workdayOverrunMinutes,
      criticalRoadOrVehicleViolations: violations.filter((item) =>
        ['MAX_PAYLOAD', 'UNREACHABLE_LEG', 'ROAD_RESTRICTION'].includes(item.code),
      ).length,
    },
  };
}

function violation(
  code: ConstraintViolation['code'],
  stopId: string | null,
  explanation: string,
  actualValue: string | number | null,
  allowedValue: string | number | null,
  type: ConstraintViolation['type'] = 'hard',
): ConstraintViolation {
  return {
    code,
    type,
    stopId,
    explanation,
    actualValue,
    allowedValue,
    severity: type === 'soft'
      ? 'warning'
      : ['UNREACHABLE_LEG', 'MAX_PAYLOAD', 'MISSING_STOP'].includes(code)
        ? 'critical'
        : 'error',
  };
}
