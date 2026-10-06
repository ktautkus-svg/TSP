import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const swipe = readFileSync('src/components/swipe-action-card.tsx', 'utf8');
const loading = readFileSync('src/app/route/[id]/loading.tsx', 'utf8');
const delivery = readFileSync('src/app/route/[id]/delivery.tsx', 'utf8');
const alternatives = readFileSync('src/app/route/[id]/alternatives.tsx', 'utf8');

describe('daily swipe workflow', () => {
  it('keeps a deliberate horizontal threshold', () => {
    expect(swipe).toContain('gesture.dx >= threshold()');
    expect(swipe).toContain('gesture.dx <= -threshold()');
    expect(swipe).toContain('Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2');
    expect(swipe).toContain('transform: [{ translateX }]');
    expect(swipe).toContain('onMoveShouldSetPanResponderCapture');
    expect(swipe).toContain('props.rightActionLabel ??');
    expect(swipe).toContain('props.leftActionLabel ??');
  });

  it('loads right and marks not-loaded left while retaining visible buttons', () => {
    expect(loading).toContain('onSwipeRight=');
    expect(loading).toContain('markLoaded(stop.id)');
    expect(loading).toContain('onSwipeLeft=');
    expect(loading).toContain('beginNotLoaded(stop.id)');
    expect(loading).toContain('Pakrauta');
    expect(loading).toContain('Nepakrauta');
    expect(loading).toContain('toggle-processed-loading-stops');
    expect(loading).toContain('rightActionLabel="PAKRAUTA"');
  });

  it('delivers right and opens failure reasons left while retaining visible buttons', () => {
    expect(delivery).toContain('onSwipeRight={() => { void delivered(stop.id); }}');
    expect(delivery).toContain('onSwipeLeft={() => beginFailed(stop.id)}');
    expect(delivery).toContain('ATLIKTA');
    expect(delivery).toContain('NEATLIKTA');
  });

  it('gives primary route actions immediate pressed feedback and async busy state', () => {
    expect(loading).toContain('pressed && styles.plannedPressed');
    expect(loading).toContain('bulkBusy && styles.disabled');
    expect(alternatives).toContain('pressed && styles.pressedFeedback');
    expect(alternatives).toContain('priorityCalculating && styles.disabled');
    expect(delivery).toContain('pressed && styles.pressedFeedback');
  });
});
