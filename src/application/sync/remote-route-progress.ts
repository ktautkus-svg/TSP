const STATUS_RANK: Record<string, number> = {
  planned: 1,
  loading: 2,
  loaded: 3,
  in_progress: 4,
  completed: 5,
};

export type LocalRouteProgress = {
  start_odometer?: number | null;
  end_odometer?: number | null;
  status?: string | null;
};

/**
 * The other device already recorded an odometer this device never got.
 * Opening the iPad can make the local timestamp newer without adding that
 * reading, and a completed cloud copy must not be treated as the missing
 * reading — a live local route still has to stay deferred.
 */
export function remoteProgressMissingLocally(local: LocalRouteProgress | null, remote: Record<string, unknown>): boolean {
  if (!local) return false;
  const remoteRank = STATUS_RANK[String(remote.status ?? '')] ?? 0;
  if (remoteRank >= STATUS_RANK.completed) return false;
  if (local.start_odometer == null && remote.start_odometer != null) return true;
  return local.end_odometer == null && remote.end_odometer != null;
}
