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
 * The other device already recorded odometer or moved the route further.
 * A newer local timestamp from merely opening the iPad must not hide that.
 */
export function remoteProgressMissingLocally(local: LocalRouteProgress | null, remote: Record<string, unknown>): boolean {
  if (!local) return true;
  if (local.start_odometer == null && remote.start_odometer != null) return true;
  if (local.end_odometer == null && remote.end_odometer != null) return true;
  const localRank = STATUS_RANK[String(local.status ?? '')] ?? 0;
  const remoteRank = STATUS_RANK[String(remote.status ?? '')] ?? 0;
  return remoteRank > localRank && localRank < STATUS_RANK.completed;
}
