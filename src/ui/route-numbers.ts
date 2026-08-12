export interface RouteNumberRow {
  readonly route_id: string;
  readonly order_number: string | null;
}

export function groupRouteNumbers(rows: readonly RouteNumberRow[]): Record<string, string> {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const value = row.order_number?.trim();
    if (!value) continue;
    const normalized = /^R/i.test(value) ? value.toUpperCase() : `R${value}`;
    const values = grouped.get(row.route_id) ?? new Set<string>();
    values.add(normalized);
    grouped.set(row.route_id, values);
  }
  return Object.fromEntries([...grouped].map(([routeId, values]) => [routeId, [...values].join(' · ')]));
}

export function routeNumberLabel(routeId: string, routeNumbers: Readonly<Record<string, string>>): string {
  const known = routeNumbers[routeId];
  if (known) return known;
  const suffix = routeId.match(/(\d{1,4})$/)?.[1];
  const readableTail = routeId.split('-').filter(Boolean).at(-1)?.slice(-6).toUpperCase() ?? routeId.slice(-6).toUpperCase();
  return suffix ? `R${suffix}` : `Maršrutas ${readableTail}`;
}
