import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { callPhone } from '@/application/operations/call-phone';
import { FoundationScreen } from '@/components/foundation-screen';
import { employeeApi, type ServerClientDirectoryEntry } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type Filter = 'all' | 'missing' | 'complete';

export default function ClientsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [clients, setClients] = useState<ServerClientDirectoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('missing');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await employeeApi<{ clients: ServerClientDirectoryEntry[] }>('/api/admin/clients');
    setClients(response.clients);
  }, []);

  useFocusEffect(useCallback(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Klientų katalogo atkurti nepavyko.'));
  }, [load]));

  const missingCount = clients.filter((client) => !client.phone && !client.email).length;
  const visible = clients.filter((client) => filter === 'all'
    || (filter === 'missing' ? !client.phone && !client.email : Boolean(client.phone || client.email)));

  const beginEdit = (client: ServerClientDirectoryEntry) => {
    setEditingId(client.id);
    setContactPerson(client.contactPerson ?? '');
    setPhone(client.phone ?? '');
    setEmail(client.email ?? '');
    setMessage(null);
  };

  const save = async () => {
    if (!editingId || busy) return;
    setBusy(true);
    try {
      await employeeApi(`/api/admin/clients/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ contactPerson, phone, email }),
      });
      setEditingId(null);
      setMessage('Kliento kontaktai išsaugoti.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kontakto išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return <FoundationScreen
    contentMaxWidth={1040}
    description="Pavadinimai ir adresai kaupiami automatiškai iš realiai priskirtų maršrutų. Kontaktus pildykite tik tada, kai juos žinote."
    showFoundationNotice={false}
    title="Klientai">
    <View style={styles.summary}>
      <View><Text style={styles.summaryValue}>{clients.length}</Text><Text style={styles.summaryLabel}>KLIENTŲ</Text></View>
      <View><Text style={[styles.summaryValue, missingCount > 0 && styles.warningValue]}>{missingCount}</Text><Text style={styles.summaryLabel}>TRŪKSTA KONTAKTŲ</Text></View>
    </View>
    <View style={styles.filters}>
      {([
        ['missing', `Trūksta (${missingCount})`],
        ['all', `Visi (${clients.length})`],
        ['complete', `Su kontaktais (${clients.length - missingCount})`],
      ] as const).map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
        <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text>
      </Pressable>)}
    </View>
    {visible.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Įrašų nėra</Text><Text style={styles.meta}>Klientai atsiras priskyrus maršrutus, kuriuose yra gavėjo pavadinimas arba adresas.</Text></View> : null}
    {visible.map((client) => <View key={client.id} style={styles.card} testID={`client-${client.id}`}>
      <View style={styles.cardTop}>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{client.name}</Text>
          <Text style={styles.address}>{client.address}</Text>
          <Text style={styles.meta}>{client.visitCount} {client.visitCount === 1 ? 'maršrutas' : 'maršrutai'} · paskutinį kartą {formatDate(client.lastDeliveredAt ?? client.lastSeenAt)}</Text>
        </View>
        <View style={[styles.status, (client.phone || client.email) ? styles.statusComplete : styles.statusMissing]}>
          <Text style={(client.phone || client.email) ? styles.statusCompleteText : styles.statusMissingText}>{client.phone || client.email ? 'Kontaktas yra' : 'Trūksta'}</Text>
        </View>
      </View>
      {editingId === client.id ? <View style={styles.editor}>
        <TextInput value={contactPerson} onChangeText={setContactPerson} style={styles.input} placeholder="Kontaktinis asmuo (jei žinomas)" placeholderTextColor={colors.textMuted} />
        <TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad" placeholder="Telefonas" placeholderTextColor={colors.textMuted} />
        <TextInput value={email} onChangeText={setEmail} style={styles.input} keyboardType="email-address" autoCapitalize="none" placeholder="El. paštas" placeholderTextColor={colors.textMuted} />
        <View style={styles.actions}>
          <Pressable onPress={() => setEditingId(null)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
          <Pressable disabled={busy} onPress={() => { void save(); }} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Saugoma…' : 'Išsaugoti'}</Text></Pressable>
        </View>
      </View> : <View style={styles.actions}>
        {client.phone ? <Pressable onPress={() => { void callPhone(client.phone!).catch((error) => Alert.alert('Skambinti nepavyko', error instanceof Error ? error.message : 'Bandykite dar kartą.')); }} style={styles.callButton}><Text style={styles.callText}>Skambinti</Text></Pressable> : null}
        <Pressable onPress={() => beginEdit(client)} style={styles.secondaryButton}><Text style={styles.secondaryText}>{client.phone || client.email ? 'Redaguoti kontaktą' : 'Įvesti kontaktą'}</Text></Pressable>
      </View>}
    </View>)}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </FoundationScreen>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString('lt-LT');
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center' },
  summaryValue: { ...type.readout, color: colors.textInverse, fontSize: 28 },
  warningValue: { color: '#FFD37A' },
  summaryLabel: { ...type.label, color: colors.borderStrong },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filter: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.info, borderColor: colors.info },
  filterText: { ...type.secondaryStrong, color: colors.text },
  filterTextActive: { color: colors.textInverse },
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md },
  empty: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  cardTop: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'flex-start' },
  cardCopy: { flex: 1, minWidth: 220, gap: 3 },
  cardTitle: { ...type.sectionTitle, color: colors.text },
  address: { ...type.bodyStrong, color: colors.textSecondary },
  meta: { ...type.secondary, color: colors.textMuted },
  status: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusComplete: { backgroundColor: colors.accentSoft },
  statusMissing: { backgroundColor: colors.warningSoft },
  statusCompleteText: { ...type.secondaryStrong, color: colors.accentStrong },
  statusMissingText: { ...type.secondaryStrong, color: colors.warning },
  editor: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.md },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryButton: { minHeight: 46, minWidth: 140, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 46, minWidth: 140, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  secondaryText: { ...type.button, color: colors.textSecondary },
  callButton: { minHeight: 46, minWidth: 120, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.info },
  callText: { ...type.button, color: colors.textInverse },
  disabled: { opacity: 0.55 },
  message: { ...type.bodyStrong, color: colors.info },
});
