import { describe, expect, it } from 'vitest';

import {
  fallbackRouteWeatherScene,
  routeTimeOfDay,
  routeWeatherCondition,
} from '@/application/weather/route-weather';

describe('route windshield weather scene', () => {
  it('selects the time-of-day scene from local time', () => {
    expect(routeTimeOfDay(new Date('2026-08-09T06:00:00'))).toBe('dawn');
    expect(routeTimeOfDay(new Date('2026-08-09T12:00:00'))).toBe('day');
    expect(routeTimeOfDay(new Date('2026-08-09T19:00:00'))).toBe('dusk');
    expect(routeTimeOfDay(new Date('2026-08-09T23:00:00'))).toBe('night');
  });

  it('maps Open-Meteo observations to the supported visual conditions', () => {
    expect(routeWeatherCondition({ weather_code: 0 })).toBe('clear');
    expect(routeWeatherCondition({ weather_code: 3 })).toBe('cloudy');
    expect(routeWeatherCondition({ weather_code: 45 })).toBe('fog');
    expect(routeWeatherCondition({ weather_code: 61, rain: 1 })).toBe('rain');
    expect(routeWeatherCondition({ weather_code: 75, snowfall: 1 })).toBe('snow');
    expect(routeWeatherCondition({ weather_code: 95 })).toBe('storm');
  });

  it('keeps a safe clear fallback when the weather service is unavailable', () => {
    const scene = fallbackRouteWeatherScene(55.73, 24.36, new Date('2026-08-09T22:00:00'));
    expect(scene).toMatchObject({ condition: 'clear', timeOfDay: 'night', latitude: 55.73, longitude: 24.36 });
  });
});
