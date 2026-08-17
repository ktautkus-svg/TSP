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
const routeOverview = readFileSync(resolve(here, '../../src/app/route/[id]/overview.tsx'), 'utf8');

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
    expect(importScreen).toContain('Tęsti iš šio Excel');
    expect(importScreen).toContain('Failo iš naujo kelti nereikia');
    expect(importScreen).toContain('for (const [index, sheet] of preview.sheets.entries())');
    expect(importScreen).toContain('multiple: true');
    expect(importScreen).toContain('testID="excel-sheet-queue"');
    expect(importScreen).toContain('Pasirinkite planuojamą Excel lapą');
    expect(importScreen).toContain("routed ? 'Suplanuotas'");
    expect(importScreen).toContain('saveActiveBatchFileHashes');
    expect(importScreen).toContain('findLatestByFingerprint(excelPreview.fileHash, targetSheet)');
    expect(importScreen).toContain('toggle-paste-field');
    expect(importScreen).toContain("pathname: '/route/[id]/review'");
    expect(importScreen).toContain("result && (!excelPreview || excelProblemCount === 0)");
    expect(importScreen).not.toContain('Duomenys prasideda nuo');
    expect(importScreen).not.toContain('Excel eilutės →');
    expect(importScreen).toContain('excelGroupNeedsAction');
    expect(importScreen).not.toContain('formatLineCount(rows.length)');
    // Time-window handling is a single compact switch now, not a pair of
    // "Atsižvelgti"/"Neatsižvelgti" choice buttons.
    expect(importScreen).toContain('testID="toggle-planning-mode"');
    expect(importScreen).toContain('Atsižvelgti į pristatymo langus');
    expect(importScreen).toContain('switchTrackOn');
  });

  it('shows every import source explicitly with progressive disclosure', () => {
    expect(importScreen).toContain('testID="pick-excel"');
    expect(importScreen).toContain('Pasirinkti Excel failą');
    expect(importScreen).toContain('PASIRINKITE ŠALTINĮ');
    expect(importScreen).toContain('Nuotrauka');
    expect(importScreen).toContain('PDF dokumentas');
    expect(importScreen).toContain('Įklijuoti tekstą');
    expect(importScreen).toContain('excelPrimaryButton');
    expect(importScreen).toContain('toggle-excel-content');
    expect(importScreen).toContain('testID="route-setup-visible"');
    expect(importScreen).not.toContain('autoRestoredExcel');
  });

  it('lets the driver drop whole regions and edit the schedule inline', () => {
    expect(importScreen).toContain('testID="region-summary"');
    expect(importScreen).toContain('region-chip-');
    expect(importScreen).toContain('toggleRouteCode');
    expect(importScreen).toContain('testID="toggle-schedule-edit"');
    expect(importScreen).toContain('testID="cancel-route-setup"');
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
    // The tick is a real SVG icon now, not a ✓ glyph in the label.
    expect(loadingScreen).toContain('Visi kroviniai pakrauti');
    expect(loadingScreen).toContain('<CheckIcon');
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
    expect(importScreen).toContain('${excelProblemCount} taškus reikia patikrinti');
    expect(importScreen).toContain("testID=\"create-route-top\"");
    expect(importScreen).not.toContain('Dabartinė vieta');
    expect(importScreen).not.toContain('Paskutinis taškas');
    expect(manualRouteScreen).toContain('GetDefaultLocations');
    expect(manualRouteScreen).toContain('savedStartEndpoint');
    expect(manualRouteScreen).toContain('savedEndEndpoint');
    expect(manualRouteScreen).toContain('testID="manual-route-review-top"');
    expect(importScreen).toContain('useFocusEffect(useCallback(() =>');
    expect(reviewScreen).toContain('testID="apply-current-warehouse"');
    expect(reviewScreen).toContain('testID="apply-kretinga-warehouse"');
  });

  it('keeps back navigation inside the import and review flow', () => {
    expect(importScreen).toContain('returnToSourceChooser');
    expect(importScreen).toContain('← Šaltiniai');
    expect(importScreen).toContain("returnTo: 'import'");
    expect(reviewScreen).toContain("<Stack.Screen options={{ gestureEnabled: false, title: 'Adresų patikra' }} />");
    expect(manualRouteScreen).toContain("returnTo: 'manual'");
    expect(manualRouteScreen).toContain("pathname: '/route/[id]/review'");
  });

  it('keeps the full route sequence collapsed until requested', () => {
    expect(routeOverview).toContain('testID="toggle-route-stops"');
    expect(routeOverview).toContain('showStops ? stops.map');
    expect(routeOverview).toContain("profile.role === 'driver' ? <DriverAppTabs");
  });

  it('offers both the saved warehouse and Kretinga as route starts', () => {
    expect(importScreen).toContain('KRETINGA_WAREHOUSE_ADDRESS');
    expect(importScreen).toContain('testID="start-location-choice"');
    expect(importScreen).toContain("startMode === null ? ['Pasirinkite sandėlį");
    expect(importScreen).toContain("setStartMode('warehouse')");
    expect(importScreen).toContain("setStartMode('kretinga')");
    expect(importScreen).toContain('>Numatytasis sandėlis</Text>');
    expect(importScreen).toContain('>Kretingos sandėlis</Text>');
    expect(importScreen).toContain("{selectedStartAddress} → {endMode === 'home' ? homeAddress : selectedStartAddress}");
    expect(importScreen).toContain('const startLocation: RouteEndpoint = selectedStartEndpoint');
    expect(reviewScreen).toContain('canonicalWarehouseAddress');
    expect(reviewScreen).toContain('endpoint.normalizedAddress');
    expect(reviewScreen).toContain('testID="review-warehouse-choice"');
    expect(reviewScreen).toContain('Pasirinkite sandėlį prieš optimizuodami');
    expect(alternativesScreen).toContain('testID="change-warehouse-or-stops"');
    expect(alternativesScreen).toContain('Keisti sandėlį arba taškus');
  });

  it('keeps route selection compact and fits the whole route after map resize', () => {
    expect(alternativesScreen).toContain('buildFourObjectiveAlternatives');
    expect(alternativesScreen).toContain('item.title');
    expect(alternativesScreen).toContain('item.comment');
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
    expect(alternativesScreen).toContain('verifyPersistedSequence');
    expect(alternativesScreen).toContain('markRouted(current.sourceImportAuditId, routeId)');
    expect(alternativesScreen).toContain('pushRouteAssignmentRevision');
    expect(alternativesScreen).toContain('stopSequence: manualOrder');
    expect(alternativesScreen).not.toContain('Sutvarkykite taškus rodyklėmis');
    expect(manualOrderList).toContain('PanResponder');
    expect(manualOrderList).toContain('manual-drag-list');
    expect(manualOrderList).toContain('accessibilityRole="checkbox"');
    expect(alternativesScreen).toContain('address: stop.location.address ?? stop.location.label');
    expect(manualOrderList).toContain('props.item.address');
    expect(manualOrderList).toContain('styles.address');
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
    expect(loadingScreen).toContain('testID="assign-planned-route"');
    expect(loadingScreen).toContain('testID="edit-planned-route"');
    expect(loadingScreen).toContain('testID="plan-another-route"');
    expect(loadingScreen).toContain('testID="delete-planned-route"');
    expect(loadingScreen).toContain('Redaguoti maršrutą');
    expect(loadingScreen).toContain('Tęsti nepriskyrus');
    expect(loadingScreen).toContain('Ištrinti maršrutą');
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
