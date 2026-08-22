import { describe, expect, it } from 'vitest';
import { parseCoordinateInput } from '../../src/application/import/address-resolver';

describe('parseCoordinateInput', () => {
  it('parses a plain "lat, lng" pair', () => {
    expect(parseCoordinateInput('54.6872, 25.2797')).toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('parses a plain "lat;lng" pair without a space', () => {
    expect(parseCoordinateInput('54.6872;25.2797')).toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('parses a Google Maps "@lat,lng,zoom" URL', () => {
    expect(parseCoordinateInput('https://www.google.com/maps/@54.6872,25.2797,15z')).toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('parses a Google Maps place URL with a "@lat,lng" pin', () => {
    expect(parseCoordinateInput('https://www.google.com/maps/place/Some+Place/@54.6872,25.2797,17z/data=!3m1!4b1'))
      .toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('parses a Google Maps "?q=lat,lng" URL', () => {
    expect(parseCoordinateInput('https://maps.google.com/?q=54.6872,25.2797')).toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('parses the internal "!3dlat!4dlng" place-pin parameter', () => {
    expect(parseCoordinateInput('https://www.google.com/maps/place/x/data=!4m5!3m4!1s0x0:0x0!8m2!3d54.6872!4d25.2797'))
      .toEqual({ latitude: 54.6872, longitude: 25.2797 });
  });

  it('rejects a plain address', () => {
    expect(parseCoordinateInput('Katedros g. 4, Panevėžys, Lietuva')).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(parseCoordinateInput('200, 25.2797')).toBeNull();
    expect(parseCoordinateInput('54.6872, 400')).toBeNull();
  });

  it('converts maps.lt LKS-94 metres to WGS84 coordinates', () => {
    const result = parseCoordinateInput('https://www.maps.lt/map/?xy=584000,6070000&z=12');
    expect(result?.latitude).toBeCloseTo(54.76, 1);
    expect(result?.longitude).toBeCloseTo(25.29, 1);
  });
});
