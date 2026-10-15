export const DOCUMENT_WARNING_DAYS = 30;

export type VehicleDocumentState = 'valid' | 'expiring' | 'expired' | 'missing';

export type VehicleDocumentKind = 'inspection' | 'insurance' | 'roadTax' | 'service';

export function vehicleDocumentState(dueOn: string | null | undefined, today: string): VehicleDocumentState {
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 'missing';
  const due = Date.parse(`${dueOn}T00:00:00.000Z`);
  const current = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(current)) return 'missing';
  const remaining = Math.round((due - current) / 86_400_000);
  if (remaining <= 0) return 'expired';
  if (remaining <= DOCUMENT_WARNING_DAYS) return 'expiring';
  return 'valid';
}

export function vehicleDocumentLabel(state: VehicleDocumentState): string {
  if (state === 'valid') return 'Galioja';
  if (state === 'expiring') return 'Baigiasi';
  if (state === 'expired') return 'Negalioja';
  return 'Nenurodyta';
}
