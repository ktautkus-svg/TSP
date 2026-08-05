import { describe, expect, it } from 'vitest';
import { GatewayError } from '../../gateway/errors';
import { parseGatewayMatrixRequest } from '../../gateway/validation';
import { gatewayRequest } from './helpers';

describe('gateway request validation', () => {
  it('accepts normalized request', () => {
    expect(parseGatewayMatrixRequest(gatewayRequest()).stops).toHaveLength(1);
  });

  it.each([20, 30, 40])('accepts %i delivery stops', (stopCount) => {
    const request = gatewayRequest('google');
    const parsed = parseGatewayMatrixRequest({
      ...request,
      stops: Array.from({ length: stopCount }, (_, index) => ({
        ...request.stops[0],
        id: `stop-${index + 1}`,
        label: `Taškas ${index + 1}`,
        latitude: request.stops[0]!.latitude + index * 0.0001,
      })),
    });
    expect(parsed.stops).toHaveLength(stopCount);
  });

  it('accepts a ring route with equal coordinates and distinct node IDs', () => {
    const request = gatewayRequest('google');
    const ring = {
      ...request,
      endLocation: {
        ...request.startLocation,
        id: 'return-to-start',
        label: 'Grįžimas į startą',
      },
    };
    const parsed = parseGatewayMatrixRequest(ring);
    expect(parsed.startLocation.id).not.toBe(parsed.endLocation.id);
    expect(parsed.startLocation.latitude).toBe(parsed.endLocation.latitude);
    expect(parsed.startLocation.longitude).toBe(parsed.endLocation.longitude);
  });

  it.each([
    [{ ...gatewayRequest(), provider: 'arbitrary' }, 'provider'],
    [{ ...gatewayRequest(), stops: [] }, 'tuščias'],
    [
      {
        ...gatewayRequest(),
        startLocation: { ...gatewayRequest().startLocation, latitude: 95 },
      },
      'coordinate',
    ],
    [{ ...gatewayRequest(), externalUrl: 'https://attacker.invalid' }, 'url'],
    [{
      ...gatewayRequest(),
      stops: Array.from({ length: 41 }, (_, index) => ({
        ...gatewayRequest().stops[0],
        id: `stop-${index + 1}`,
        latitude: gatewayRequest().stops[0]!.latitude + index * 0.0001,
      })),
    }, 'limit'],
  ])('rejects invalid or untrusted input: $1', (input, _label) => {
    expect(() => parseGatewayMatrixRequest(input)).toThrow(GatewayError);
  });
});
