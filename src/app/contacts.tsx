import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { callPhone } from '@/application/operations/call-phone';
import { FoundationScreen } from '@/components/foundation-screen';
import { OperationalContactRepository } from '@/database/repositories/operational-contact-repository';
import { isUsablePhone } from '@/domain/phone';
import {
  OPERATIONAL_CONTACT_KINDS,
  type OperationalContact,
  type OperationalContactKind,
} from '@/domain/vehicle-and-trip';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const KIND_LABELS: Record<OperationalContactKind, string> = {
  administration: 'Administracija',
  dispatcher: 'Dispečeris',
  warehouse: 'Sandėlis',
  other: 'Kitas',
};

export default function ContactsScreen() {
  const db = useSQLiteContext();
  const repository = useMemo(() => new OperationalContactRepository(db), [db]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [contacts, setContacts] = useState<OperationalContact[]>([]);
  const [name, setName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<OperationalContactKind>('administration');
  const [isEmergency, setIsEmergency] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setContacts(await repository.list());
  }, [repository]);

  useFocusEffect(useCallback(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Kontaktų atkurti nepavyko.'));
  }, [load]));

  const hasEmergency = contacts.some((contact) => contact.isEmergency && isUsablePhone(contact.phone));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await repository.save({ name, roleLabel, phone, kind, isEmergency: kind === 'administration' ? isEmergency : false });
      setName('');
      setRoleLabel('');
      setPhone('');
      setIsEmergency(true);
      setMessage('Kontaktas išsaugotas.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (contact: OperationalContact) => {
    Alert.alert('Pašalinti kontaktą?', `${contact.name} · ${contact.phone}`, [
      { text: 'Atšaukti', style: 'cancel' },
      { text: 'Pašalinti', style: 'destructive', onPress: () => { void (async () => {
        await repository.remove(contact.id);
        await load();
      })(); } },
    ]);
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Kontaktai ir ryšys"
      description="Kontaktų galima nesuvesti – darbas netrukdomas. Suvedus numerius, skambinti galima tiesiai iš maršruto.">
      {!hasEmergency ? <Text style={styles.hint}>Kritinis administracijos numeris dar nesuvestas. Kol jo nėra, maršrutą vis tiek galima vykdyti.</Text> : null}
      <View style={styles.card} testID="contact-editor">
        <Text style={styles.label}>Vardas</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Pvz. Tomas, dispečerinė" placeholderTextColor={colors.textMuted} testID="contact-name" />
        <Text style={styles.label}>Pareigos / rolė</Text>
        <TextInput value={roleLabel} onChangeText={setRoleLabel} style={styles.input} placeholder="Pvz. budintis administratorius" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Telefonas</Text>
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" style={styles.input} placeholder="+370..." placeholderTextColor={colors.textMuted} testID="contact-phone" />
        <Text style={styles.label}>Rūšis</Text>
        <View style={styles.options}>
          {OPERATIONAL_CONTACT_KINDS.map((value) => (
            <Pressable key={value} onPress={() => setKind(value)} style={[styles.option, kind === value && styles.optionSelected]}>
              <Text style={[styles.optionText, kind === value && styles.optionTextSelected]}>{KIND_LABELS[value]}</Text>
            </Pressable>
          ))}
        </View>
        {kind === 'administration' ? (
          <Pressable onPress={() => setIsEmergency((current) => !current)} style={styles.checkRow} testID="contact-emergency-toggle">
            <View style={[styles.checkbox, isEmergency && styles.checkboxActive]} />
            <Text style={styles.checkLabel}>Kritinis kontaktas maršruto ekrane</Text>
          </Pressable>
        ) : null}
        <Pressable disabled={busy} onPress={() => { void save(); }} style={[styles.button, busy && styles.disabled]} testID="save-contact">
          <Text style={styles.buttonText}>{busy ? 'Saugoma…' : 'Išsaugoti kontaktą'}</Text>
        </Pressable>
      </View>
      {contacts.map((contact) => (
        <View key={contact.id} style={styles.card} testID={`saved-contact-${contact.id}`}>
          <Text style={styles.name}>{contact.name}{contact.isEmergency ? ' · kritinis' : ''}</Text>
          <Text style={styles.meta}>{KIND_LABELS[contact.kind]}{contact.roleLabel ? ` · ${contact.roleLabel}` : ''}</Text>
          <Text style={styles.phone}>{contact.phone}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.callButton} onPress={() => { void callPhone(contact.phone).catch((error) => Alert.alert('Skambinti nepavyko', error instanceof Error ? error.message : 'Bandykite dar kartą.')); }} testID={`call-contact-${contact.id}`}>
              <Text style={styles.callText}>Skambinti</Text>
            </Pressable>
            <Pressable style={styles.removeButton} onPress={() => remove(contact)}>
              <Text style={styles.removeText}>Pašalinti</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  label: { ...type.cardTitle, color: colors.text },
  name: { ...type.cardTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  phone: { ...type.bodyStrong, color: colors.info },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.actionRoute, borderColor: colors.actionRoute },
  optionText: { ...type.secondaryStrong, color: colors.text },
  optionTextSelected: { color: colors.textInverse },
  checkRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong },
  checkboxActive: { backgroundColor: colors.actionRoute, borderColor: colors.actionRoute },
  checkLabel: { ...type.body, color: colors.text, flex: 1 },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  disabled: { opacity: 0.55 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  callButton: { minHeight: 44, minWidth: 120, borderRadius: radius.md, backgroundColor: colors.actionRoute, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  callText: { ...type.button, color: colors.textInverse },
  removeButton: { minHeight: 44, minWidth: 120, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  removeText: { ...type.button, color: colors.danger },
  block: { ...type.bodyStrong, color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  hint: { ...type.body, color: colors.textMuted },
  message: { color: colors.textMuted, lineHeight: 20 },
});
