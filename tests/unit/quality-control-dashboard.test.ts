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
const paletteSource = readFileSync(resolve(root, 'src/ui/quality-control-palette.ts'), 'utf8');

function assignment(): RouteAssignment {
  const stops = Array.from({ length: 10 }, (_, index) => ({
    id: `stop-${index + 1}`,
    active_order: index + 1,
    order_number: String(index + 1),
    recipient: index === 7 ? 'Klientas Kelmė' : `Klientas ${index + 1}`,
    normalized_address: index === 7 ? 'Vytauto Didžiojo g. 58, Kelmė' : `Gatvė ${index + 1}`,
    delivery_status: index < 7 ? 'delivered' : 'pending',
    weight_kg: 100,
    delivery_time_from: '08:00',
    delivery_time_to: '09:00',
    planned_arrival_at: `2026-08-12T08:${String(index).padStart(2, '0')}:00.000Z`,
    delivered_at: index < 7 ? `2026-08-12T08:${String(index + 5).padStart(2, '0')}:00.000Z` : null,
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
      nextStop: { sequence: 8, recipient: 'Klientas Kelmė', address: 'Vytauto Didžiojo g. 58, Kelmė', routeNumber: 'H01', deliveryTimeFrom: '08:00', deliveryTimeTo: '09:00' },
      vehicle: { registrationNumber: 'LRI744', model: 'Renault Master' },
    });
    expect(route.stops[0]).toMatchObject({ sequence: 1, status: 'delivered', deliveredAt: '2026-08-12T08:05:00.000Z' });
  });

  it('recovers a missing mapped region from the preserved Excel row and still ignores S codes', () => {
    const legacy = assignment();
    legacy.routeSnapshot.shipmentLines = legacy.routeSnapshot.shipmentLines.map((line) => ({
      ...line,
      route_code: null,
      raw_row_json: JSON.stringify({ A: line.order_number, F: 'R80', G: 'S01' }),
    }));
    const route = buildQualityRouteMonitor(legacy, legacy.vehicle);
    expect(route.routeNumbers).toEqual(['R80']);
    expect(route.nextStop?.routeNumber).toBe('R80');
  });

  it('exposes a dedicated read-only endpoint and isolates the quality role in navigation', () => {
    expect(apiSource).toContain("pathname === '/api/quality/routes'");
    expect(apiSource).toContain("requireRole(profile, ['quality', 'admin', 'dispatcher'])");
    expect(apiSource).toContain("requireRole(profile, ['admin', 'dispatcher', 'driver'])");
    expect(dashboardSource).toContain("employeeApi<{ routes: QualityRouteMonitor[]; serverTime: string }>('/api/quality/routes')");
    expect(dashboardSource).not.toContain("method: 'POST'");
    expect(dashboardSource).not.toContain("method: 'PATCH'");
    expect(layoutSource).toContain("profile.role === 'quality' && !qualityAllowed");
    expect(layoutSource).toContain("pathname === '/trip-sheet'");
    expect(layoutSource).toContain("pathname === '/statistics'");
    expect(dashboardSource).toContain('testID="quality-open-trip-sheets"');
    expect(dashboardSource).toContain('testID="quality-open-statistics"');
  });

  it('publishes driver progress immediately after a delivery and refreshes both sides periodically', () => {
    expect(deliverySource).toContain('void publishProgress()');
    expect(deliverySource).toContain('pullAssignedRoutes(db, profile)');
    expect(deliverySource).toContain('10_000');
    expect(dashboardSource).toContain('REFRESH_INTERVAL_MS = 15_000');
    expect(dashboardSource).toContain('Duomenys vėluoja');
  });

  it('uses bottom status filters, expandable routes and hides driver-only sync state', () => {
    expect(dashboardSource).toContain('qualityControlColors as colors');
    expect(dashboardSource).toContain('function StatusFilter');
    expect(dashboardSource).toContain('accessibilityState={{ expanded }}');
    expect(dashboardSource).toContain('Rodyti taškus ir laikus');
    expect(dashboardSource).toContain('styles.routeCardMobile');
    expect(dashboardSource).toContain('Regionas ${stop.routeNumber}');
    expect(dashboardSource).not.toContain('Užsakymo Nr.');
    expect(brandHeaderSource).toContain('showSyncStatus = true');
    expect(syncContextSource).toContain("profile.role === 'quality'");
  });

  it('can review a day, week, month or custom period for all or one driver', () => {
    expect(dashboardSource).toContain("type PeriodMode");
    expect(dashboardSource).toContain("from '@/application/reporting/period-range'");
    expect(dashboardSource).toContain('periodRange(periodMode, anchorDate, customFrom, customTo)');
    expect(dashboardSource).toContain("route.date >= period.from && route.date <= period.to");
    expect(dashboardSource).toContain("driverId === 'all' || route.driverId === driverId");
    expect(dashboardSource).toContain('Visi vairuotojai');
    expect(dashboardSource).toContain('Baigta pasirinktu laikotarpiu');
    expect(dashboardSource).toContain("{ key: 'completed', label: 'Įvykdyti', tone: 'success' }");
    expect(dashboardSource).toContain("completed: completed.length");
  });

  it('matches the current red and blue TSP identity instead of the old green dark theme', () => {
    expect(dashboardSource).not.toContain('useTheme');
    expect(dashboardSource).toContain('qualityBrandRed');
    expect(paletteSource).toContain("background: '#FBF9F8'");
    expect(paletteSource).toContain("primary: '#15174C'");
    expect(paletteSource).toContain("brandWordmarkBlue: '#174A88'");
    expect(paletteSource).toContain("qualityBrandRed = '#A73835'");
  });

  it('uses the real TSP mark and classifies delivery timing without changing route logic', () => {
    expect(dashboardSource).toContain('<TspBrand compact inverse={false} />');
    expect(dashboardSource).toContain('KOKYBĖS KONTROLĖ');
    expect(dashboardSource).not.toContain('Maršrutai gyvai');
    expect(dashboardSource).toContain('MINOR_DELAY_MINUTES = 45');
    expect(dashboardSource).toContain('Per anksti');
    expect(dashboardSource).toContain('Pavėlavo');
    expect(dashboardSource).toContain('Vėlavo ${delay} min.');
  });
});
