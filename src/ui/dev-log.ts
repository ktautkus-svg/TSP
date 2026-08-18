/** Development-only diagnostic logging. Centralises the eslint no-console exception. */
export function devWarn(event: string, ...details: unknown[]): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console -- dev-only diagnostics
  console.warn(event, ...details);
}
