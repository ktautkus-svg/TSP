export function failedDeliveryLabel(
  reason: string | null,
  comment: string | null,
): string {
  const normalizedReason = reason?.trim() || null;
  const normalizedComment = comment?.trim() || null;
  if (!normalizedReason && !normalizedComment) return 'Nepavyko';
  if (!normalizedReason) return `Nepavyko\nKomentaras: ${normalizedComment}`;
  if (!normalizedComment || normalizedComment === normalizedReason) return `Nepavyko: ${normalizedReason}`;
  return `Nepavyko: ${normalizedReason}\nKomentaras: ${normalizedComment}`;
}

export function userVisibleStopNote(note: string | null): string | null {
  const value = note?.trim() || null;
  if (!value) return null;
  if (/^\d+\s+užsakymo\s+eilut(?:ė|ės|e|es)/iu.test(value)) return null;
  if (/užsakym(?:o|ų)\s+(?:numer|eilut)/iu.test(value)) return null;
  return value;
}
