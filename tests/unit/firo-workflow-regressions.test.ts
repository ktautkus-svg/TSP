import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('assignment and cockpit regressions', () => {
  it('assigns from one button and treats a repeated same request as the existing assignment', () => {
    const screen = readFileSync(resolve(import.meta.dirname, '../../src/app/route-management.tsx'), 'utf8');
    const store = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
    expect(screen).toContain("label: selectedRouteId === route.id ? 'Pasirinkta' : 'Pasirinkti'");
    expect(screen).not.toContain("label: 'Priskirti', onPress: () => selectRoute");
    expect(screen).toContain('Šis maršrutas jau priskirtas');
    expect(store).toContain('if (sameDriver) return sameDriver;');
  });

  it('hides voice from the driver dashboard and keeps recalculation on stops', () => {
    const delivery = readFileSync(resolve(import.meta.dirname, '../../src/app/route/[id]/delivery.tsx'), 'utf8');
    expect(delivery).not.toContain('VoiceCommandButton');
    expect(delivery).not.toContain('dashboard-recalculate-remaining-route');
    expect(delivery).toContain('Perskaičiuoti nuo dabartinio');
    expect(delivery).toContain('recalculate-remaining-route');
    expect(readFileSync(resolve(import.meta.dirname, '../../src/components/voice-command-button.tsx'), 'utf8')).toContain('VoiceCommandButton');
  });
});
