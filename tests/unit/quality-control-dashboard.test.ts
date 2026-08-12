import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildQualityRouteMonitor, type RouteAssignment } from '../../server/employee-auth-store';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiSource = readFileSync(resolve(root, 'server/employee-api.ts'), 'utf8');
const dashboardSource = readFileSync(resolve(root, 'src/app/quality-control.tsx'), 'utf8');
const deliverySource = readFileSync(resolve(root, 'src/app/route/[id]/delivery.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');
const brandHeaderSource = readFileSync(resolve(root, 'src/components/brand-header.tsx'), 'utf8');
const syncContextSource = readFileSync(resolve(root, 'src/application/sync/route-cloud-sync-context.tsx'), 'utf8');

function assignment(): RouteAssignment {
  const stops = Array.from({ length: 10 }, (_, index) => ({
    id: `stop-${index + 1}`,
    active_order: index + 1,
    order_number: String(index + 1),
    recipient: index === 7 ? 'Klientas Kelmė' : `Klientas ${index + 1}`,
    normalized_address: index === 7 ? 'Vytauto Didžiojo g. 58, Kelmė' : `Gatvė ${index + 1}`,
    delivery_status: index < 7 ? 'delivered' : 'pending',
    weight_kg: 100,
  }));
  const shipmentLines = stops.flatMap((stop, index) => [
    { delivery_stop_id: stop.id, route_code: index === 7 ? 'H01' : 'R12', order_number: `RS60928${index}` },
    ...(index === 7 ? [{ delivery_stop_id: stop.id, route_code: 'S01', order_number: 'RS609299' }] : []),
  ]);
  return {
    id: 'assignment-quality-1', routeId: 'route-quality-1', driverId: 'driver-vadimas', driverName: 'Vadimas',
    status: 'in_progress', progress: null, createdBy: 'admin-sensejus', assignedAt: '2026-08-12T05:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z', vehicle: { id: 'LRI744', registrationNumber: 'LRI744', model: 'Renault Master', maximumPayloadKg: 1500 },
    routeSnapshot: { route: { id: 'route-quality-1', date: '2026-08-12', status: 'in_progress', total_stops: 10, remaining_stops: 3, total_weight_kg: 1000, remaining_weight_kg: 300, started_at: '2026-08-12T06:00:00.000Z' }, stops, shipmentLines },
  };
}

describe('quality control dashboard', () => {
  it('shows completed count and the actual next stop in route order', () => {
    const route = buildQualityRouteMonitor(assignment(), assignment().vehicle);
    expect(route).toMatchObject({
      driverName: 'Vadimas', deliveredStops: 7, remainingStops: 3, progressPercent: 70,
      routeNumbers: ['R12', 'H01'],
      nextStop: { sequence: 8, recipient: 'Klientas Kelmė', address: 'Vytauto Didžiojo g. 58, Kelmė', routeNumber: 'H01' },
      vehicle: { registrationNumber: 'LRI744', model: 'Renault Master' },
    });
  });

  it('exposes a dedicated read-only endpoint and isolates the quality role in navigation', () => {
    expect(apiSource).toContain("pathname === '/api/quality/routes'");
    expect(apiSource).toContain("requireRole(profile, ['quality', 'admin', 'dispatcher'])");
    expect(apiSource).toContain("requireRole(profile, ['admin', 'dispatcher', 'driver'])");
    expect(dashboardSource).toContain("employeeApi<{ routes: QualityRouteMonitor[]; serverTime: string }>('/api/quality/routes')");
    expect(dashboardSource).not.toContain("method: 'POST'");
    expect(dashboardSource).not.toContain("method: 'PATCH'");
    expect(layoutSource).toContain("profile.role === 'quality' && !qualityAllowed");
  });

  it('publishes driver progress immediately after a delivery and refreshes both sides periodically', () => {
    expect(deliverySource).toContain('void publishProgress()');
    expect(deliverySource).toContain('30_000');
    expect(dashboardSource).toContain('REFRESH_INTERVAL_MS = 15_000');
    expect(dashboardSource).toContain('Duomenys vėluoja');
  });

  it('keeps the mobile overview compact, shows region codes and hides driver-only sync state', () => {
    expect(dashboardSource).toContain('showSyncStatus={false}');
    expect(dashboardSource).toContain('styles.metricCompact');
    expect(dashboardSource).toContain('styles.routeCardMobile');
    expect(dashboardSource).toContain('Regionas ${route.nextStop.routeNumber}');
    expect(dashboardSource).not.toContain('Užsakymo Nr.');
    expect(brandHeaderSource).toContain('showSyncStatus = true');
    expect(syncContextSource).toContain("profile.role === 'quality'");
  });
});
