import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const swipe = readFileSync('src/components/swipe-action-card.tsx', 'utf8');
const loading = readFileSync('src/app/route/[id]/loading.tsx', 'utf8');
const delivery = readFileSync('src/app/route/[id]/delivery.tsx', 'utf8');

describe('daily swipe workflow', () => {
  it('keeps a deliberate horizontal threshold', () => {
    expect(swipe).toContain('gesture.dx >= threshold()');
    expect(swipe).toContain('gesture.dx <= -threshold()');
    expect(swipe).toContain('Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2');
    expect(swipe).toContain('transform: [{ translateX }]');
  });

  it('loads right and marks not-loaded left while retaining visible buttons', () => {
    expect(loading).toContain('onSwipeRight=');
    expect(loading).toContain('markLoaded(stop.id)');
    expect(loading).toContain('onSwipeLeft=');
    expect(loading).toContain('beginNotLoaded(stop.id)');
    expect(loading).toContain('Pakrauta');
    expect(loading).toContain('Nepakrauta');
  });

  it('delivers right and opens failure reasons left while retaining visible buttons', () => {
    expect(delivery).toContain('onSwipeRight={() => { void delivered(stop.id); }}');
    expect(delivery).toContain('onSwipeLeft={() => beginFailed(stop.id)}');
    expect(delivery).toContain('ATLIKTA');
    expect(delivery).toContain('NEATLIKTA');
  });
});
