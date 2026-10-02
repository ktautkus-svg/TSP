import { describe, expect, it } from 'vitest';

import { classifyDeliveryWindow, minutesLate } from '../../src/domain/delivery-window-timing';

describe('delivery window timing', () => {
  it('classifies by local clock time even when the planned route date is different', () => {
    expect(classifyDeliveryWindow('2026-08-14T07:01:00', '06:00', '15:00')).toBe('on_time');
    expect(classifyDeliveryWindow('2026-08-14T05:59:00', '06:00', '10:00')).toBe('early');
  });

  it('includes both delivery-window boundaries and allows a 15-minute late grace', () => {
    expect(classifyDeliveryWindow('2026-08-14T06:00:00', '06:00', '15:00')).toBe('on_time');
    expect(classifyDeliveryWindow('2026-08-14T15:00:59', '06:00', '15:00')).toBe('on_time');
    // 08:00–10:00 → 10:15 still on time, 10:16 is late.
    expect(classifyDeliveryWindow('2026-08-14T15:15:00', '06:00', '15:00')).toBe('on_time');
    expect(classifyDeliveryWindow('2026-08-14T15:16:00', '06:00', '15:00')).toBe('late');
    // Raw lateness is still reported unrounded.
    expect(minutesLate('2026-08-14T15:01:00', '15:00')).toBe(1);
    expect(minutesLate('2026-08-14T15:16:00', '15:00')).toBe(16);
  });

  it('supports delivery windows that cross midnight', () => {
    expect(classifyDeliveryWindow('2026-08-14T23:30:00', '22:00', '02:00')).toBe('on_time');
    expect(classifyDeliveryWindow('2026-08-15T01:30:00', '22:00', '02:00')).toBe('on_time');
  });
});
