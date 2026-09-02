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
const periodSource = readFileSync(resolve(root, 'src/application/reporting/period-range.ts'), 'utf8');
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

  it('does not claim 100% points progress when a completed route still has unmarked stops', () => {
    // Management complete zeros remaining_* without marking deliveries — the
    // quality card must show honest 0/N progress, not a forced 100% bar.
    const closed = assignment();
    closed.status = 'completed';
    closed.routeSnapshot.route.status = 'completed';
    closed.routeSnapshot.route.remaining_stops = 0;
    closed.routeSnapshot.route.remaining_weight_kg = 0;
    closed.routeSnapshot.route.completed_at = '2026-08-12T12:00:00.000Z';
    for (const stop of closed.routeSnapshot.stops) {
      stop.delivery_status = 'pending';
      stop.delivered_at = null;
    }
    const route = buildQualityRouteMonitor(closed, closed.vehicle);
    expect(route).toMatchObject({
      deliveredStops: 0,
      remainingStops: 10,
      progressPercent: 0,
      totalWeightKg: 1000,
      remainingWeightKg: 1000,
    });
    expect(dashboardSource).toContain('route.deliveredStops / route.totalStops');
  });

  it('reports the day the route actually completed, not the day the draft happened to be created on', () => {
    // route.date defaults to the creation day when nobody sets an explicit
    // delivery date — a route drafted the evening before and driven the next
    // day must still land in quality-control under the day it was actually
    // worked, not the day it was drafted.
    const late = assignment();
    late.routeSnapshot.route.date = '2026-08-11';
    late.routeSnapshot.route.started_at = '2026-08-12T05:30:00.000Z';
    late.routeSnapshot.route.completed_at = '2026-08-12T09:00:00.000Z';
    const route = buildQualityRouteMonitor(late, late.vehicle);
    expect(route.date).toBe('2026-08-12');
  });

  it('falls back to the planned date for a route that has not started yet', () => {
    const notStarted = assignment();
    notStarted.routeSnapshot.route.date = '2026-08-15';
    notStarted.routeSnapshot.route.started_at = null;
    const route = buildQualityRouteMonitor(notStarted, notStarted.vehicle);
    expect(route.date).toBe('2026-08-15');
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

  it('uses one calendar with quick ranges and collapsible driver/vehicle filters', () => {
    expect(dashboardSource).toContain("from '@/application/reporting/period-range'");
    expect(periodSource).toContain('CALENDAR_PERIOD_PRESETS');
    expect(dashboardSource).toContain('<PeriodCalendarPicker');
    expect(dashboardSource).toContain('testID="quality-entity-filters-toggle"');
    expect(dashboardSource).toContain("route.date >= period.from && route.date <= period.to");
    expect(dashboardSource).toContain("driverId === 'all' || route.driverId === driverId");
    expect(dashboardSource).toContain('Visi vairuotojai');
    expect(dashboardSource).toContain('Baigta pasirinktu laikotarpiu');
    expect(dashboardSource).toContain("{ key: 'completed', label: 'Įvykdyti', tone: 'success' }");
    expect(dashboardSource).toContain("completed: completedRoutes.length");
  });

  it('matches the current navy and burgundy FiRo identity instead of the old green dark theme', () => {
    expect(dashboardSource).not.toContain('useTheme');
    expect(dashboardSource).toContain('qualityBrandBurgundy');
    expect(paletteSource).toContain("background: '#FBF9F8'");
    expect(paletteSource).toContain("primary: '#15174C'");
    expect(paletteSource).toContain("brandOperationalNavy: '#15174C'");
    expect(paletteSource).toContain("qualityBrandBurgundy = '#9E202C'");
  });

  it('uses the real FiRo mark and classifies delivery timing without changing route logic', () => {
    expect(dashboardSource).toContain('<FiroBrand compact />');
    expect(dashboardSource).toContain('KOKYBĖS KONTROLĖ');
    expect(dashboardSource).not.toContain('Maršrutai gyvai');
    expect(dashboardSource).toContain('MINOR_DELAY_MINUTES = 45');
    expect(dashboardSource).toContain('Per anksti');
    expect(dashboardSource).toContain('Pavėlavo');
    expect(dashboardSource).toContain('Vėlavo ${delay} min.');
  });
});
