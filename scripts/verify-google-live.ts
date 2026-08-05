import { loadGatewayConfig } from '../gateway/config';
import { GoogleMatrixAdapter } from '../gateway/providers/google-matrix-adapter';
import { GoogleRoutesAdapter } from '../gateway/providers/google-routes-adapter';
import type { GatewayMatrixRequest, GatewayPolylineRequest } from '../gateway/types';

async function main() {
  const config = loadGatewayConfig();
  if (!config.googleApiKey) {
    throw new Error('GOOGLE_API_KEY / GOOGLE_ROUTES_API_KEY nesukonfigūruotas.');
  }

  console.log('=== 1. TIKRINAMAS GOOGLE ROUTE MATRIX API v2 ===');
  const matrixAdapter = new GoogleMatrixAdapter(config.googleApiKey);
  const matrixRequest: GatewayMatrixRequest = {
    schemaVersion: '1',
    provider: 'google',
    matrixId: 'live-test-matrix',
    startLocation: { id: 'start', label: 'Vilnius Centras', latitude: 54.6872, longitude: 25.2797 },
    stops: [
      { id: 'stop-1', label: 'Antakalnis', latitude: 54.7042, longitude: 25.3148 },
      { id: 'stop-2', label: 'Žirmūnai', latitude: 54.7175, longitude: 25.2952 },
      { id: 'stop-3', label: 'Fabijoniškės', latitude: 54.7338, longitude: 25.2394 },
    ],
    endLocation: { id: 'end', label: 'Naujamiestis', latitude: 54.6755, longitude: 25.2678 },
    departureAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    trafficMode: 'live',
    vehicle: {
      id: 'van',
      type: 'van',
      maximumPayloadKg: 1500,
      useRoadRestrictions: false,
      startLocation: { id: 'start', label: 'Vilnius Centras', latitude: 54.6872, longitude: 25.2797 },
      defaultEndLocation: { id: 'end', label: 'Naujamiestis', latitude: 54.6755, longitude: 25.2678 },
    },
    language: 'lt-LT',
    regionCode: 'LT',
  };

  const matrixResult = await matrixAdapter.fetchMatrix(matrixRequest, new AbortController().signal);
  console.log('✅ Route Matrix gautas sėkmingai!');
  console.log(`- Matricos dydis: ${matrixResult.matrix.nodeIds.length}x${matrixResult.matrix.nodeIds.length}`);
  console.log(`- Užklausos laikas: ${matrixResult.responseMs.toFixed(1)} ms`);
  console.log(`- Pasiekiamumas: ${(matrixResult.completenessRatio * 100).toFixed(1)}%`);
  console.log(`- Pavyzdinė atkarpa [0]->[1]: ${matrixResult.matrix.cells[0][1].distanceKm} km, ${matrixResult.matrix.cells[0][1].durationMinutes?.toFixed(1)} min`);

  console.log('\n=== 2. TIKRINAMAS GOOGLE COMPUTE ROUTES API v2 (POLYLINE) ===');
  const routesAdapter = new GoogleRoutesAdapter(config.googleApiKey);
  const polylineRequest: GatewayPolylineRequest = {
    schemaVersion: '1',
    provider: 'google',
    startLocation: matrixRequest.startLocation,
    orderedStops: [
      matrixRequest.stops[0], // Antakalnis
      matrixRequest.stops[1], // Žirmūnai
      matrixRequest.stops[2], // Fabijoniškės
    ],
    endLocation: matrixRequest.endLocation,
    departureAt: matrixRequest.departureAt,
    trafficMode: 'live',
    language: 'lt-LT',
    regionCode: 'LT',
  };

  const polylineResult = await routesAdapter.fetchRoutePolyline(polylineRequest, new AbortController().signal);
  console.log('✅ Polilinija gauta sėkmingai!');
  console.log(`- Bendras atstumas: ${(polylineResult.distanceMeters / 1000).toFixed(2)} km`);
  console.log(`- Bendras laikas: ${(polylineResult.durationSeconds / 60).toFixed(1)} min`);
  console.log(`- Encoded Polyline ilgis: ${polylineResult.encodedPolyline.length} simbolių`);
  console.log(`- Encoded Polyline iškarpa: ${polylineResult.encodedPolyline.slice(0, 40)}...`);
  console.log(`- Atkarpų (legs) skaičius: ${polylineResult.legs.length}`);
}

main().catch((err) => {
  console.error('❌ Klaida tikrinant Google API:', err);
  process.exit(1);
});
