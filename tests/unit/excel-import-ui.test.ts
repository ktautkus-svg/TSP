import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const importScreen = readFileSync(resolve(here, '../../src/app/import/index.tsx'), 'utf8');
const shipmentSummary = readFileSync(resolve(here, '../../src/components/shipment-lines-summary.tsx'), 'utf8');
const reviewScreen = readFileSync(resolve(here, '../../src/app/route/[id]/review.tsx'), 'utf8');
const loadingScreen = readFileSync(resolve(here, '../../src/app/route/[id]/loading.tsx'), 'utf8');
const deliveryScreen = readFileSync(resolve(here, '../../src/app/route/[id]/delivery.tsx'), 'utf8');
const dashboardScreen = readFileSync(resolve(here, '../../src/app/index.tsx'), 'utf8');
const failureModel = readFileSync(resolve(here, '../../src/domain/delivery-failure.ts'), 'utf8');
const manualRouteScreen = readFileSync(resolve(here, '../../src/app/route/new.tsx'), 'utf8');
const alternativesScreen = readFileSync(resolve(here, '../../src/app/route/[id]/alternatives.tsx'), 'utf8');
const webMap = readFileSync(resolve(here, '../../src/components/route-map.web.tsx'), 'utf8');
const manualOrderList = readFileSync(resolve(here, '../../src/components/manual-route-order-list.tsx'), 'utf8');

describe('compact daily Excel UI', () => {
  it('shows the compact problem filter and expands only actionable groups', () => {
    expect(importScreen).toContain('testID="excel-problems-filter"');
    expect(importScreen).toContain('Peržiūrėti visus taškus');
    expect(importScreen).toContain('testID="excel-problem-navigator"');
    expect(importScreen).toContain('Patikrinti šį adresą');
    expect(importScreen).toContain('Taisyti šį adresą');
    expect(importScreen).toContain('showHeading={!result}');
    expect(importScreen).toContain('testID="planning-date"');
    expect(importScreen).toContain('testID="planning-time"');
    expect(importScreen).toContain('defaultPlanningDate');
    expect(importScreen).toContain('plannedDepartureAt');
    expect(importScreen).toContain('Kurti maršrutą');
    expect(importScreen).toContain('placeholder="04:00"');
    expect(importScreen).toContain('defaultPlanningTime');
    expect(importScreen).toContain('remembered-excel-card');
    expect(importScreen).toContain('toggle-paste-field');
    expect(importScreen).toContain("pathname: '/route/[id]/review'");
    expect(importScreen).toContain("result && (!excelPreview || excelProblemCount === 0)");
    expect(importScreen).not.toContain('Duomenys prasideda nuo');
    expect(importScreen).not.toContain('Excel eilutės →');
    expect(importScreen).toContain('excelGroupNeedsAction');
    expect(importScreen).not.toContain('formatLineCount(rows.length)');
    expect(importScreen).toContain('Pristatymo laikai');
    expect(importScreen).toContain('label="Atsižvelgti"');
    expect(importScreen).toContain('label="Neatsižvelgti"');
  });

  it('keeps priorities compact and opens odometer entry in a modal', () => {
    const reviewScreen = readFileSync(resolve(process.cwd(), 'src/app/route/[id]/review.tsx'), 'utf8');
    const loadingScreen = readFileSync(resolve(process.cwd(), 'src/app/route/[id]/loading.tsx'), 'utf8');

    expect(reviewScreen).toContain('Optimizuoti maršrutą');
    expect(reviewScreen).toContain('compact={allReady');
    expect(reviewScreen).toContain('numberOfLines={1}');
    expect(reviewScreen).toContain('Rodyti detales');
    expect(loadingScreen).toContain('testID="start-odometer-modal"');
    expect(loadingScreen).toContain('testID="open-start-odometer"');
    expect(loadingScreen).not.toContain('Įvesiu vėliau');
  });

  it('does not render order numbers or phone fields in daily stop editors', () => {
    const editorFields = importScreen.slice(importScreen.indexOf('const fields:'), importScreen.indexOf('return (', importScreen.indexOf('const fields:')));
    expect(editorFields).not.toContain("key: 'orderNumber'");
    expect(editorFields).not.toContain("key: 'phone'");
    expect(shipmentSummary).not.toContain('line.orderNumber');
    expect(shipmentSummary).not.toContain('Užsakymo');
    expect(reviewScreen).not.toContain('Užsakymas (neprivaloma)');
    expect(loadingScreen).not.toContain('Užsakymas:');
    expect(loadingScreen).not.toContain('ShipmentLinesSummary');
    expect(deliveryScreen).not.toContain('ShipmentLinesSummary');
    expect(loadingScreen).not.toContain('stop.orderNumber');
    expect(deliveryScreen).not.toContain('stop.orderNumber');
    expect(loadingScreen).not.toContain('stop.phone');
    expect(deliveryScreen).not.toContain('stop.phone');
    expect(loadingScreen).toContain('etaLabel(stop)');
    expect(loadingScreen).toContain('Pažymėti visus kaip pakrautus');
    expect(loadingScreen).toContain('Visi kroviniai pakrauti ✓');
    expect(loadingScreen).toContain('bulkInFlight.current');
    expect(loadingScreen).toContain('MarkStopUnloaded');
    expect(deliveryScreen).toContain('etaLabel(stop)');
    expect(dashboardScreen).toContain('dashboard-route-summary');
    expect(dashboardScreen).not.toContain('KITAS PRISTATYMAS');
  });

  it('reuses the saved warehouse and home without repeated confirmation', () => {
    expect(importScreen).toContain('warehouseEndpoint');
    expect(importScreen).toContain('homeEndpoint');
    expect(importScreen).not.toContain('Išsaugota vieta naudojama automatiškai');
    expect(importScreen).toContain('Patikrinkite ${excelProblemCount}');
    expect(importScreen).toContain("testID=\"create-route-top\"");
    expect(importScreen).not.toContain('Dabartinė vieta');
    expect(importScreen).not.toContain('Paskutinis taškas');
    expect(manualRouteScreen).toContain('GetDefaultLocations');
    expect(manualRouteScreen).toContain('savedStartEndpoint');
    expect(manualRouteScreen).toContain('savedEndEndpoint');
    expect(manualRouteScreen).toContain('testID="manual-route-review-top"');
  });

  it('keeps route selection compact and fits the whole route after map resize', () => {
    expect(alternativesScreen).toContain('testID="save-selected-route-top"');
    expect(alternativesScreen).toContain('Patvirtinti pasirinktą maršrutą');
    expect(alternativesScreen).toContain('Redaguoti rankiniu būdu');
    expect(alternativesScreen).not.toContain("await new ActivateRoute(db).execute(routeId)");
    expect(alternativesScreen).toContain('testID="cancel-route-and-new-file"');
    expect(alternativesScreen).toContain('Atšaukti ir pasirinkti kitą failą');
    expect(alternativesScreen).toContain('new CancelDraftRoute(db).execute(routeId)');
    expect(alternativesScreen).toContain('Rodyti eiliškumą');
    expect(alternativesScreen).toContain('expandedCandidateId');
    expect(alternativesScreen).toContain('ManualRouteOrderList');
    expect(alternativesScreen).toContain('manualPriorityIds');
    expect(alternativesScreen).toContain('Perskaičiuoti pagal prioritetus');
    expect(alternativesScreen).not.toContain('Sutvarkykite taškus rodyklėmis');
    expect(manualOrderList).toContain('PanResponder');
    expect(manualOrderList).toContain('manual-drag-list');
    expect(manualOrderList).toContain('accessibilityRole="checkbox"');
    expect(webMap).toContain('ResizeObserver');
    expect(webMap).toContain('invalidateSize');
    expect(webMap).toContain('fitBounds');
    expect(webMap).toContain("import 'leaflet/dist/leaflet.css'");
    expect(webMap).toContain("position: 'absolute'");
  });

  it('keeps a confirmed route planned until the driver explicitly starts loading', () => {
    expect(loadingScreen).toContain("persisted.route.status === 'planned'");
    expect(loadingScreen).toContain('Suplanuotas maršrutas');
    expect(loadingScreen).toContain('testID="begin-loading"');
    expect(loadingScreen).toContain('testID="edit-planned-route"');
    expect(loadingScreen).toContain('testID="cancel-planned-route"');
    expect(loadingScreen).toContain('Grįžti į redagavimą');
    expect(loadingScreen).toContain('await new ActivateRoute(db).execute(routeId)');
    expect(loadingScreen).not.toContain("if (persisted.route.status === 'planned') await new ActivateRoute");
    expect(dashboardScreen).toContain('Tęsti suplanuotą maršrutą');
  });

  it('uses a safe-area failure modal and keeps recalculation explicitly manual', () => {
    expect(deliveryScreen).toContain('<Modal');
    expect(deliveryScreen).toContain('testID="failure-modal"');
    expect(deliveryScreen).toContain('KeyboardAvoidingView');
    expect(deliveryScreen).toContain('useSafeAreaInsets');
    expect(deliveryScreen.indexOf('</FoundationScreen>')).toBeLessThan(deliveryScreen.indexOf('<Modal'));
    for (const reason of ['Nedirba', 'Liko sandėlyje', 'Netilpo', 'Netinka produkcija', 'Kita']) {
      expect(failureModel).toContain(reason);
    }
    for (const oldReason of ['Trūko dokumentų / akto', 'Klientas nepriėmė', 'Nerastas gavėjas', 'Neteisingas adresas', 'Nepavyko susisiekti']) {
      expect(deliveryScreen).not.toContain(oldReason);
    }
    const saveFailed = deliveryScreen.slice(deliveryScreen.indexOf('const saveFailed'), deliveryScreen.indexOf('const proposeRecalculation'));
    expect(saveFailed).not.toContain('proposeRecalculation');
    expect(deliveryScreen).toContain('testID="recalculate-remaining-route"');
    expect(deliveryScreen).toContain('deliveryMatchesFilter(filter, stop.deliveryStatus)');
    expect(deliveryScreen).toContain('userVisibleStopNote(stop.notes)');
  });
});
