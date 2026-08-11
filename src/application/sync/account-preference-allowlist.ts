/**
 * The only `app_preferences` keys that may ever leave this device.
 *
 * This list is deliberately tiny and deliberately a *list*, not a rule: there
 * is no pattern, prefix or "sync everything except…" here, because
 * `app_preferences` is a single key/value table that also holds the offline
 * PIN-unlock credential. Anything not named below stays on the device, so a
 * preference added in the future is device-local by default and cannot start
 * syncing by accident.
 *
 * Adding a key here is a security decision. The question to answer first is
 * "would the driver want this on their other device, and is it safe there?" —
 * not "is it convenient?".
 */
export const ACCOUNT_PREFERENCE_KEYS = [
  // Where routes end by default (warehouse or home) — a planning habit that
  // belongs to the person, not to the phone in their pocket.
  'last_route_end_kind',
  // Whether delivery time windows are treated as planning constraints.
  'last_planning_mode',
] as const;

export type AccountPreferenceKey = (typeof ACCOUNT_PREFERENCE_KEYS)[number];

/**
 * Key prefixes that must never sync even if someone adds them to the list
 * above by mistake. This is a second, independent gate: the allowlist says
 * what may travel, this says what may never travel under any circumstance.
 */
const NEVER_SYNC_PREFIXES = [
  // Offline unlock credential: username, salt, PIN hash, timestamp.
  'local_access_',
  // Service-worker version, last successful write, last restore — all describe
  // this installation, and restoring another device's values is meaningless.
  'pwa_',
];

/** Keys that are device-specific by product decision rather than by security. */
const DEVICE_SPECIFIC_KEYS = [
  // Light/dark is a property of the screen being looked at.
  'theme_preference',
  // Waze on the phone, Apple Maps on the iPad: this follows the hardware.
  'default_navigation_provider',
  // Sync bookkeeping and other runtime state.
  'route_cloud_sync_cursor',
  'last_pwa_restore_at',
];

export function isAccountPreferenceKey(key: string): key is AccountPreferenceKey {
  if (NEVER_SYNC_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  if (DEVICE_SPECIFIC_KEYS.includes(key)) return false;
  return (ACCOUNT_PREFERENCE_KEYS as readonly string[]).includes(key);
}
