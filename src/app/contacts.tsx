import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { callPhone } from '@/application/operations/call-phone';
import { FoundationScreen } from '@/components/foundation-screen';
import { OperationalContactRepository } from '@/database/repositories/operational-contact-repository';
import { employeeApi, type EmployeeProfile } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type DirectoryContact = {
  id: string;
  employeeId: string;
  name: string;
  role: EmployeeProfile['role'];
  phone: string;
  email: string | null;
  isEmergency: boolean;
};

const ROLE_LABELS: Record<EmployeeProfile['role'], string> = {
  admin: 'Administracija', dispatcher: 'Dispečeris', driver: 'Vairuotojas', quality: 'Kokybės kontrolė',
};

export default function ContactsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile } = useLocalAccess();
  const repository = useMemo(() => new OperationalContactRepository(db), [db]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [missing, setMissing] = useState<EmployeeProfile[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await employeeApi<{ contacts: DirectoryContact[] }>('/api/operations/contacts');
    setContacts(response.contacts);
    for (const contact of response.contacts) {
      await repository.save({
        id: contact.id,
        kind: contact.role === 'admin' ? 'administration' : contact.role === 'dispatcher' ? 'dispatcher' : 'other',
        name: contact.name,
        roleLabel: ROLE_LABELS[contact.role],
        phone: contact.phone,
        isEmergency: contact.isEmergency,
      });
    }
    if (profile.role === 'admin' || profile.role === 'dispatcher') {
      const users = await employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users');
      setMissing(users.users.filter((user) => !user.disabled && !user.phone));
    } else setMissing([]);
  }, [profile.role, repository]);

  useFocusEffect(useCallback(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Kontaktų atkurti nepavyko.'));
  }, [load]));

  return <FoundationScreen contentMaxWidth={920} description="Kontaktai imami iš sukurtų darbuotojų sąrašo. Vardas ir numeris čia nekuriami antrą kartą." showFoundationNotice={false} title="Kontaktai ir ryšys">
    <View style={styles.infoCard}>
      <Text style={styles.infoTitle}>Vienas kontaktų šaltinis</Text>
      <Text style={styles.infoText}>Norėdami pakeisti vardą ar telefoną, redaguokite darbuotoją. Pakeitimas automatiškai atsiras šiame sąraše ir vairuotojo maršrute.</Text>
      <Text style={styles.infoText}>Kol jo nėra, maršrutą vis tiek galima vykdyti – trūkstamas kritinis kontaktas darbo nestabdo.</Text>
    </View>
    {contacts.map((contact) => <View key={contact.id} style={styles.card} testID={`saved-contact-${contact.id}`}>
      <View style={styles.copy}>
        <Text style={styles.name}>{contact.name}{contact.isEmergency ? ' · kritinis' : ''}</Text>
        <Text style={styles.meta}>{ROLE_LABELS[contact.role]}{contact.email ? ` · ${contact.email}` : ''}</Text>
        <Text style={styles.phone}>{contact.phone}</Text>
      </View>
      <Pressable style={styles.callButton} onPress={() => { void callPhone(contact.phone).catch((error) => Alert.alert('Skambinti nepavyko', error instanceof Error ? error.message : 'Bandykite dar kartą.')); }} testID={`call-contact-${contact.id}`}>
        <Text style={styles.callText}>Skambinti</Text>
      </Pressable>
    </View>)}
    {missing.length > 0 ? <View style={styles.missingCard}>
      <Text style={styles.missingTitle}>Trūksta telefono ({missing.length})</Text>
      {missing.map((employee) => <Text key={employee.id} style={styles.missingRow}>{employee.displayName} · {ROLE_LABELS[employee.role]}</Text>)}
      <Pressable onPress={() => router.push({ pathname: '/admin', params: { section: 'employees', returnTo: 'contacts' } } as Href)} style={styles.editButton}>
        <Text style={styles.editText}>Atidaryti darbuotojų sąrašą</Text>
      </Pressable>
    </View> : null}
    {contacts.length === 0 && !message ? <View style={styles.emptyCard}><Text style={styles.name}>Kontaktų su telefonu nėra</Text><Text style={styles.meta}>Telefonus įveskite prie jau sukurtų darbuotojų.</Text></View> : null}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </FoundationScreen>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  infoCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.info, gap: spacing.xs },
  infoTitle: { ...type.sectionTitle, color: colors.text },
  infoText: { ...type.body, color: colors.textSecondary },
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  copy: { flex: 1, minWidth: 220, gap: 2 },
  name: { ...type.cardTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  phone: { ...type.bodyStrong, color: colors.info },
  callButton: { minHeight: 46, minWidth: 120, borderRadius: radius.md, backgroundColor: colors.actionRoute, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  callText: { ...type.button, color: colors.textInverse },
  missingCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft, gap: spacing.sm },
  missingTitle: { ...type.sectionTitle, color: colors.warning },
  missingRow: { ...type.bodyStrong, color: colors.text },
  editButton: { minHeight: 46, alignSelf: 'flex-start', borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  editText: { ...type.button, color: colors.textInverse },
  emptyCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  message: { ...type.bodyStrong, color: colors.danger, backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.md },
});
