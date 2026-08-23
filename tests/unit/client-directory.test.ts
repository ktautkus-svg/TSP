import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalClientAddress, clientDirectoryId } from '../../server/employee-auth-store';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('shared client and operational directories', () => {
  it('builds clients from assigned route recipients and addresses', () => {
    const store = read('server/employee-auth-store.ts');
    expect(store).toContain('async listClients()');
    expect(store).toContain('assignment.routeSnapshot.stops');
    expect(store).toContain('optionalText(stop.recipient)');
    expect(store).toContain('optionalText(stop.normalized_address)');
    expect(store).toContain('visitCount: Math.max(client.visits.size');
  });

  it('merges different recipient labels that point to the same physical address', () => {
    const fullName = 'Gynybos resursų agentūra / Panevėžio įgulos aptarnavimo centro valgykla';
    const shorterName = 'Panevėžio įgulos aptarnavimo centro valgykla';
    expect(clientDirectoryId(fullName, 'Pajuosčio pl. 73, 38190 Panevėžys, Lietuva'))
      .toBe(clientDirectoryId(shorterName, 'Pajuosčio pl.73, 38190 Panevėžys, Lietuva'));
    expect(canonicalClientAddress('Pajuosčio pl. 73, 38190 Panevėžys, Lietuva'))
      .toBe(canonicalClientAddress('Pajuosčio pl.73, 38190 Panevėžys, Lietuva'));
  });

  it('exposes a client screen that prioritizes missing contact details', () => {
    const screen = read('src/app/clients.tsx');
    const directory = read('src/app/directory.tsx');
    const home = read('src/app/index.tsx');
    expect(screen).toContain("useState<Filter>('missing')");
    expect(screen).toContain("'/api/admin/clients'");
    expect(screen).toContain('TRŪKSTA KONTAKTŲ');
    expect(directory).toContain('title="Klientai"');
    expect(home).toContain('title="Kontaktai"');
  });

  it('selects contacts and maintenance vehicles from existing shared lists', () => {
    const contacts = read('src/app/contacts.tsx');
    const vehicle = read('src/app/vehicle.tsx');
    expect(contacts).toContain("'/api/operations/contacts'");
    expect(contacts).not.toContain('contact-name');
    expect(vehicle).toContain("'/api/admin/vehicles'");
    expect(vehicle).toContain('select-maintenance-vehicle-');
  });
});
