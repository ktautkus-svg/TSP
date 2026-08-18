import type { SQLiteDatabase } from 'expo-sqlite';

import { RouteRepository } from '@/database/repositories/route-repository';
import { ShipmentLineRepository } from '@/database/repositories/shipment-line-repository';

export type PilotRouteDiagnosticExport = {
  exportType: 'pilot_route_diagnostic';
  exportedAt: string;
  applicationVersion: string;
  schemaVersion: number;
  route: {
    id: string;
    status: string;
    startLocation: unknown;
    endLocation: unknown;
    startOdometer: number | null;
    endOdometer: number | null;
    plannedDistanceKm: number | null;
    actualDistanceKm: number | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    completionStartedAt: string | null;
    completionEndOdometerDraft: string | null;
    updatedAt: string;
  };
  stops: {
    id: string;
    order: number;
    address: string;
    loadingStatus: string;
    deliveryStatus: string;
    failureReason: string | null;
    failureComment: string | null;
    loadedAt: string | null;
    deliveredAt: string | null;
    failedAt: string | null;
  }[];
  shipmentLines: {
    id: string;
    deliveryStopId: string;
    sourceSheetName: string;
    sourceRowNumber: number;
    orderNumber: string | null;
    weightGrams: number | null;
    routeCode: string | null;
  }[];
  audit: unknown[];
};

const SENSITIVE_KEY = /(?:api.?key|secret|authorization|signature|token|headers?)/i;

export class ExportPilotRouteDiagnostic {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly clock = () => new Date().toISOString(),
  ) {}

  async execute(routeId: string, applicationVersion: string): Promise<PilotRouteDiagnosticExport> {
    const repository = new RouteRepository(this.db);
    const [persisted, audit, schema, shipmentLines] = await Promise.all([
      repository.getWithStops(routeId),
      repository.listAudit(routeId),
      this.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
      new ShipmentLineRepository(this.db).getByRoute(routeId),
    ]);
    if (!persisted) throw new Error('Maršrutas diagnostiniam eksportui nerastas.');

    return {
      exportType: 'pilot_route_diagnostic',
      exportedAt: this.clock(),
      applicationVersion,
      schemaVersion: schema?.user_version ?? 0,
      route: {
        id: persisted.route.id,
        status: persisted.route.status,
        startLocation: redactSensitive(persisted.route.startLocation),
        endLocation: redactSensitive(persisted.route.endLocation),
        startOdometer: persisted.route.startOdometer,
        endOdometer: persisted.route.endOdometer,
        plannedDistanceKm: persisted.route.estimatedDistanceKm,
        actualDistanceKm: persisted.route.actualDistanceKm,
        createdAt: persisted.route.createdAt,
        startedAt: persisted.route.startedAt,
        completedAt: persisted.route.completedAt,
        completionStartedAt: persisted.route.completionStartedAt,
        completionEndOdometerDraft: persisted.route.completionEndOdometerDraft,
        updatedAt: persisted.route.updatedAt,
      },
      stops: persisted.stops.map((stop) => ({
        id: stop.id,
        order: stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder,
        address: stop.normalizedAddress ?? stop.originalAddress,
        loadingStatus: stop.loadingStatus,
        deliveryStatus: stop.deliveryStatus,
        failureReason: stop.failureReason,
        failureComment: stop.failureComment,
        loadedAt: stop.loadedAt,
        deliveredAt: stop.deliveredAt,
        failedAt: stop.failedAt,
      })),
      shipmentLines: shipmentLines.map((line) => ({
        id: line.id,
        deliveryStopId: line.deliveryStopId,
        sourceSheetName: line.sourceSheetName,
        sourceRowNumber: line.sourceRowNumber,
        orderNumber: line.orderNumber,
        weightGrams: line.weightGrams,
        routeCode: line.routeCode,
      })),
      audit: audit.map((entry) => redactSensitive(entry)),
    };
  }

  async executeJson(routeId: string, applicationVersion: string): Promise<string> {
    return JSON.stringify(await this.execute(routeId, applicationVersion), null, 2);
  }
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(nested),
    ]),
  );
}
