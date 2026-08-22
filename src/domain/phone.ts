/** Shared phone helpers for import, contacts, and click-to-call. */

const LOCAL_PHONE_DIGITS = 8;

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00370')) return `+370${digits.slice(5)}`;
  if (digits.startsWith('370')) return `+${digits}`;
  if (digits.startsWith('8')) return `+370${digits.slice(1)}`;
  if (digits.length === LOCAL_PHONE_DIGITS) return `+370${digits}`;
  if (trimmed.startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

export function isUsablePhone(value: string | null | undefined): boolean {
  const normalized = normalizePhone(value);
  if (!normalized) return false;
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= LOCAL_PHONE_DIGITS;
}

export function telUrl(value: string): string {
  const normalized = normalizePhone(value) ?? value.trim();
  return `tel:${normalized}`;
}
