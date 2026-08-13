import { normalizeRegionCode } from '@/domain/route-code';

export interface RouteCodeRow {
  readonly route_id: string;
  readonly route_code: string | null;
}

export function groupRouteCodes(rows: readonly RouteCodeRow[]): Record<string, string> {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const normalized = normalizeRegionCode(row.route_code);
    if (!normalized) continue;
    const values = grouped.get(row.route_id) ?? new Set<string>();
    values.add(normalized);
    grouped.set(row.route_id, values);
  }
  return Object.fromEntries([...grouped].map(([routeId, values]) => [
    routeId,
    [...values].join(' · '),
  ]));
}

export function routeCodeLabel(routeId: string, routeCodes: Readonly<Record<string, string>>): string {
  return routeCodes[routeId] ?? 'Maršrutas';
}
