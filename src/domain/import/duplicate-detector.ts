import { knownSplitUnloadSite } from './known-address-corrections';
import type { DuplicateFinding, ParsedDelivery } from './models';
import { smelynes25UnloadIdentity } from './smelynes-25-unloads';

export function detectDuplicates(deliveries: ParsedDelivery[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (let leftIndex = 0; leftIndex < deliveries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < deliveries.length; rightIndex += 1) {
      const left = deliveries[leftIndex];
      const right = deliveries[rightIndex];
      const orderLeft = normalize(left.orderNumber.value ?? '');
      const orderRight = normalize(right.orderNumber.value ?? '');
      const addressLeft = normalizeAddress(left.address.value ?? '');
      const addressRight = normalizeAddress(right.address.value ?? '');
      if (orderLeft && orderLeft === orderRight) {
        findings.push(finding(left.id, right.id, 'same-order-number', 1, 'merge'));
        continue;
      }
      if (keepSeparateUnloads(left, right)) {
        continue;
      }
      if (addressLeft && addressLeft === addressRight) {
        findings.push(finding(left.id, right.id, 'same-address', 1, 'merge'));
        continue;
      }
      const similarity = addressSimilarity(addressLeft, addressRight);
      if (addressLeft && addressRight && similarity >= 0.82) {
        findings.push(finding(left.id, right.id, 'similar-address', similarity, 'review'));
      }
    }
  }
  return findings;
}

function keepSeparateUnloads(left: ParsedDelivery, right: ParsedDelivery): boolean {
  const leftText = deliverySiteText(left);
  const rightText = deliverySiteText(right);
  if (!knownSplitUnloadSite(leftText) && !knownSplitUnloadSite(rightText)) return false;
  return smelynes25UnloadIdentity(leftText) !== smelynes25UnloadIdentity(rightText);
}

function deliverySiteText(delivery: ParsedDelivery): string {
  return [
    delivery.address.value,
    delivery.address.evidence,
    delivery.recipient.value,
    delivery.notes.value,
    delivery.rawText,
  ].filter((value): value is string => Boolean(value?.trim())).join(' ');
}

export function addressSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('lt-LT').replace(/[^a-z0-9]/g, '');
}

function normalizeAddress(value: string): string {
  return normalize(value)
    .replace(/gatve/g, 'g')
    .replace(/prospektas/g, 'pr')
    .replace(/avenue/g, 'pr');
}

function finding(
  leftDeliveryId: string,
  rightDeliveryId: string,
  reason: DuplicateFinding['reason'],
  similarity: number,
  recommendation: DuplicateFinding['recommendation'],
): DuplicateFinding {
  return {
    id: `${reason}:${leftDeliveryId}:${rightDeliveryId}`,
    leftDeliveryId,
    rightDeliveryId,
    reason,
    similarity,
    recommendation,
  };
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
