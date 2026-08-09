export const LOADING_FAILURE_REASONS = [
  'Atšauktas užsakymas',
  'Nėra prekių',
  'Netilpo',
] as const;

export type LoadingFailureReason = (typeof LOADING_FAILURE_REASONS)[number];

export function isLoadingFailureReason(value: string | null | undefined): value is LoadingFailureReason {
  return LOADING_FAILURE_REASONS.includes(value as LoadingFailureReason);
}
