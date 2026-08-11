import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { roleLabel, sessionStateLabel } from '../../src/application/auth/employee-permissions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const accountMenuSource = readFileSync(resolve(root, 'src/components/account-menu-sheet.tsx'), 'utf8');
const homeSource = readFileSync(resolve(root, 'src/app/index.tsx'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'src/app/settings/index.tsx'), 'utf8');
const accessGateSource = readFileSync(resolve(root, 'src/components/local-access-gate.tsx'), 'utf8');
const adminSource = readFileSync(resolve(root, 'src/app/admin.tsx'), 'utf8');

describe('employee role and session-state labels', () => {
  it('labels every employee role in Lithuanian', () => {
    expect(roleLabel('admin')).toBe('Administratorius');
    expect(roleLabel('dispatcher')).toBe('Dispečeris');
    expect(roleLabel('driver')).toBe('Vairuotojas');
  });

  it('distinguishes a server-verified session from a cached offline session', () => {
    expect(sessionStateLabel(true)).toEqual({ label: 'Prisijungta prie serverio', tone: 'success' });
    expect(sessionStateLabel(false)).toEqual({ label: 'Vietinis režimas (neprisijungus)', tone: 'warning' });
  });
});

describe('account menu sheet', () => {
  it('shows who is signed in, their role and whether the session is server-verified', () => {
    expect(accountMenuSource).toContain('profile.displayName');
    expect(accountMenuSource).toContain('@{profile.username}');
    expect(accountMenuSource).toContain('roleLabel(profile.role)');
    expect(accountMenuSource).toContain('sessionState.label');
  });

  it('offers switch account, settings and logout as distinct actions', () => {
    expect(accountMenuSource).toContain('account-menu-switch');
    expect(accountMenuSource).toContain('account-menu-settings');
    expect(accountMenuSource).toContain('account-menu-logout');
    expect(accountMenuSource).toContain('Keisti paskyrą?');
  });

  it('is reachable from the home screen header profile button', () => {
    expect(homeSource).toContain('AccountMenuSheet');
    expect(homeSource).toContain('onMenuPress={() => setAccountMenuOpen(true)}');
  });
});

describe('settings account section', () => {
  it('shows the current account, role, sign-in state and a switch-account action alongside logout', () => {
    expect(settingsSource).toContain('testID="switch-account-button"');
    expect(settingsSource).toContain('testID="logout-button"');
    expect(settingsSource).toContain('roleLabel(profile.role)');
    expect(settingsSource).toContain('sessionStateLabel(online)');
  });
});

describe('logout clears device-local identity state', () => {
  it('resets the cached username and display name so a new sign-in does not show the previous user', () => {
    expect(accessGateSource).toContain('setUsername(\'\');');
    expect(accessGateSource).toContain('setDisplayName(\'\');');
  });
});

describe('shared role labels', () => {
  it('the admin panel reuses the shared role label instead of a local duplicate', () => {
    expect(adminSource).toContain("roleLabel(profile.role)");
    expect(adminSource).not.toContain('function roleLabel');
  });
});
