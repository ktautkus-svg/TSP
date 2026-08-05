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

describe('compact daily Excel UI', () => {
  it('shows the compact problem filter and expands only actionable groups', () => {
    expect(importScreen).toContain('testID="excel-problems-filter"');
    expect(importScreen).toContain('Rodyti tik problemas');
    expect(importScreen).toContain('excelGroupNeedsAction');
    expect(importScreen).not.toContain('formatLineCount(rows.length)');
    expect(importScreen).toContain('Atsižvelgti į pristatymo laikus');
    expect(importScreen).toContain('Neatsižvelgti į pristatymo laikus');
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
    expect(dashboardScreen).toContain('dashboard-next-stop');
  });

  it('uses a fixed warehouse start and the two explicit destination choices', () => {
    expect(importScreen).toContain('Grįžti į Savanorių pr. 180, Vilnius');
    expect(importScreen).toContain('Baigti Alinkos g. 1A, Elektrėnai');
    expect(importScreen).not.toContain('Dabartinė vieta');
    expect(importScreen).not.toContain('Paskutinis taškas');
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
