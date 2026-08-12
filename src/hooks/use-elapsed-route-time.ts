import { useEffect, useMemo, useState } from 'react';

export interface UseElapsedRouteTimeOptions {
  readonly startedAt: string | null;
}

export function useElapsedRouteTime({ startedAt }: UseElapsedRouteTimeOptions): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return useMemo(() => {
    if (!startedAt) return '0h 00m';
    const started = new Date(startedAt).getTime();
    if (!Number.isFinite(started)) return '0h 00m';
    const minutes = Math.max(0, Math.floor((now - started) / 60_000));
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }, [now, startedAt]);
}
