import type { SQLiteDatabase } from 'expo-sqlite';

import { isUsablePhone, normalizePhone } from '@/domain/phone';
import {
  OPERATIONAL_CONTACT_KINDS,
  type OperationalContact,
  type OperationalContactKind,
} from '@/domain/vehicle-and-trip';

type ContactRow = {
  id: string;
  kind: OperationalContactKind;
  name: string;
  role_label: string | null;
  phone: string;
  is_emergency: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function mapContact(row: ContactRow): OperationalContact {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    roleLabel: row.role_label,
    phone: row.phone,
    isEmergency: row.is_emergency === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OperationalContactRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(): Promise<OperationalContact[]> {
    const rows = await this.db.getAllAsync<ContactRow>(
      `SELECT * FROM operational_contacts
       ORDER BY is_emergency DESC, sort_order ASC, created_at ASC`,
    );
    return rows.map(mapContact);
  }

  async save(input: {
    id?: string;
    kind: OperationalContactKind;
    name: string;
    roleLabel?: string | null;
    phone: string;
    isEmergency: boolean;
    sortOrder?: number;
  }, now = new Date().toISOString()): Promise<OperationalContact> {
    if (!OPERATIONAL_CONTACT_KINDS.includes(input.kind)) {
      throw new Error('Neteisinga kontakto rūšis.');
    }
    const name = input.name.trim();
    const phone = normalizePhone(input.phone);
    if (!name) throw new Error('Įveskite kontakto vardą.');
    if (!isUsablePhone(phone)) throw new Error('Įveskite veikiantį telefono numerį.');
    const existing = input.id
      ? await this.db.getFirstAsync<ContactRow>('SELECT * FROM operational_contacts WHERE id = ?', input.id)
      : null;
    const id = existing?.id ?? input.id ?? `contact-${Date.now().toString(36)}`;
    await this.db.runAsync(
      `INSERT INTO operational_contacts (
         id, kind, name, role_label, phone, is_emergency, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         role_label = excluded.role_label,
         phone = excluded.phone,
         is_emergency = excluded.is_emergency,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
      id,
      input.kind,
      name,
      input.roleLabel?.trim() || null,
      phone,
      input.isEmergency ? 1 : 0,
      input.sortOrder ?? existing?.sort_order ?? 0,
      existing?.created_at ?? now,
      now,
    );
    const saved = await this.db.getFirstAsync<ContactRow>('SELECT * FROM operational_contacts WHERE id = ?', id);
    return mapContact(saved!);
  }

  async remove(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM operational_contacts WHERE id = ?', id);
  }
}
