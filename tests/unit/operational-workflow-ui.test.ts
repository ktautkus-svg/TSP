import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('driver operational UI', () => {
  it('lists every assigned route with operational summaries and role protection', () => {
    const home = read('src/app/index.tsx');
    const layout = read('src/app/_layout.tsx');
    expect(home).toContain('driver-route-list');
    expect(home).toContain("!initialRestoreHandled.current && route?.status === 'in_progress'");
    expect(home).toContain('listOperational');
    expect(home).toContain('Pirma užbaikite aktyvų maršrutą');
    expect(layout).toContain('RoleAccessBoundary');
    expect(layout).toContain("profile.role === 'driver' && adminOnly");
  });

  it('shows the return choice before final odometer and keeps both actions distinct', () => {
    const delivery = read('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('route-return-choice');
    expect(delivery).toContain("startReturn('warehouse')");
    expect(delivery).toContain("startReturn('home')");
    expect(delivery).toContain('confirm-return-arrival');
    expect(delivery).toContain('ĮVESTI GALUTINĮ ODOMETRĄ');
  });

  it('moves the swipe card, removes celestial decorations and enlarges the desktop map', () => {
    const swipe = read('src/components/swipe-action-card.tsx');
    const road = read('src/components/road-progress-bar.tsx');
    const map = read('src/components/route-map.web.tsx');
    expect(swipe).toContain('transform: [{ translateX }]');
    expect(swipe).toContain('PRIDUOTA');
    expect(swipe).toContain('NEPRIDUOTA');
    expect(road).not.toContain('moonGlow');
    expect(map).toContain('width >= 1024 ? 540');
  });
});
