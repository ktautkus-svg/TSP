import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MailMessageSummary } from '@/domain/mail-excel';
import { employeeApi } from '@/infrastructure/auth/employee-session';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

type MailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  message: string | null;
};

export function GmailExcelPicker({
  busy,
  demo,
  onImported,
}: {
  busy: boolean;
  demo: boolean;
  onImported: (fileName: string, bytes: Uint8Array) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [filename, setFilename] = useState('');
  const [date, setDate] = useState('');
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [takingId, setTakingId] = useState<string | null>(null);
  const oauthOutcome = useRef<'connected' | 'error' | null>(null);

  const loadStatus = useCallback(async () => {
    if (demo) return null;
    try {
      const next = await employeeApi<MailStatus>('/api/mail/status');
      setStatus(next);
      if (next.connected) setNotice(null);
      return next;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Pašto būsenos nepavyko patikrinti.');
      return null;
    }
  }, [demo]);

  useEffect(() => {
    if (open) void loadStatus();
  }, [loadStatus, open]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const receiveOauthResult = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; status?: unknown } | null;
      if (data?.type !== 'firo:gmail-oauth') return;
      if (data.status === 'connected' || data.status === 'error') oauthOutcome.current = data.status;
    };
    window.addEventListener('message', receiveOauthResult);
    return () => window.removeEventListener('message', receiveOauthResult);
  }, []);

  const connect = async () => {
    const popup = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.open('', 'firo-gmail-oauth', 'popup,width=540,height=720')
      : null;
    if (Platform.OS === 'web' && !popup) {
      setNotice('Naršyklė užblokavo Google prisijungimo langą. Leiskite FIRO atidaryti iššokantį langą ir bandykite dar kartą.');
      return;
    }
    if (popup) {
      popup.document.title = 'Jungiamasi prie Gmail';
      popup.document.body.textContent = 'Atidaromas Google prisijungimas…';
    }
    setWorking(true);
    setNotice(null);
    oauthOutcome.current = null;
    try {
      const result = await employeeApi<{ url: string }>('/api/mail/connect', { method: 'POST', body: '{}' });
      if (popup) {
        popup.location.replace(result.url);
        const connected = await waitForGmailConnection(loadStatus, oauthOutcome);
        if (connected) {
          setNotice('Gmail sėkmingai prijungtas. Dabar galite ieškoti Excel priedų.');
        } else {
          setNotice('Gmail prijungti nepavyko arba prisijungimas buvo nutrauktas. Bandykite dar kartą.');
        }
      } else {
        await Linking.openURL(result.url);
        setNotice('Patvirtinę Google lange grįžkite į FIRO ir atverkite el. pašto importą dar kartą.');
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setNotice(error instanceof Error ? error.message : 'Gmail prisijungimas nepavyko.');
    } finally {
      setWorking(false);
    }
  };

  const search = async () => {
    setWorking(true);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (from.trim()) params.set('from', from.trim());
      if (subject.trim()) params.set('subject', subject.trim());
      if (filename.trim()) params.set('filename', filename.trim());
      if (date.trim()) params.set('date', date.trim());
      const query = params.toString();
      const result = await employeeApi<{ messages: MailMessageSummary[] }>(`/api/mail/messages${query ? `?${query}` : ''}`);
      setMessages(result.messages);
      if (result.messages.length === 0) setNotice('Laiškų su Excel priedais nerasta.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Laiškų paieška nepavyko.');
    } finally {
      setWorking(false);
    }
  };

  const choose = async (messageId: string, attachmentId: string, fileName: string) => {
    setWorking(true);
    setTakingId(attachmentId);
    setNotice(null);
    try {
      const result = await employeeApi<{ fileName: string; bytesBase64: string }>(
        `/api/mail/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}?filename=${encodeURIComponent(fileName)}`,
      );
      await onImported(result.fileName || fileName, base64ToBytes(result.bytesBase64));
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Excel priedo nepavyko paimti.');
    } finally {
      setWorking(false);
      setTakingId(null);
    }
  };

  return <View style={styles.wrap}>
    <Pressable disabled={busy || working} onPress={() => setOpen((current) => !current)} style={styles.openButton} testID="import-from-email">
      <Text style={styles.openTitle}>Importuoti iš el. pašto</Text>
      <Text style={styles.openHint}>Gmail · tik šios paskyros Excel priedai</Text>
    </Pressable>
    {open ? <View style={styles.panel} testID="gmail-import-panel">
      {/* Kept above the fold: a failure shown under the list reads as "nothing happened". */}
      {notice ? <Text accessibilityRole="alert" style={styles.notice} testID="gmail-notice">{notice}</Text> : null}
      <Text style={styles.note}>Jungiamasi tik prie prisijungusio darbuotojo Gmail. Kitas naudotojas, net ir su ribotomis teisėmis, mato tik savo laiškus. Laiško turinys nerodomas.</Text>
      {demo ? <Text style={styles.notice}>Demonstracinė paskyra neturi el. pašto ir nemato tikrų laiškų.</Text> : null}
      {!demo && status && !status.configured ? <Text style={styles.notice}>{status.message}</Text> : null}
      {!demo && status?.configured && !status.connected ? <Pressable disabled={working} onPress={() => void connect()} style={styles.action} testID="gmail-connect">
        <Text style={styles.actionText}>Prisijungti prie Gmail</Text>
      </Pressable> : null}
      {!demo && status?.connected ? <>
        <Text style={styles.connected}>Prijungta: {status.email}</Text>
        <TextInput value={from} onChangeText={setFrom} placeholder="Siuntėjas" placeholderTextColor={colors.textSubtle} style={styles.input} testID="gmail-search-from" />
        <TextInput value={subject} onChangeText={setSubject} placeholder="Tema" placeholderTextColor={colors.textSubtle} style={styles.input} testID="gmail-search-subject" />
        <TextInput value={filename} onChangeText={setFilename} placeholder="Failo pavadinimas" placeholderTextColor={colors.textSubtle} style={styles.input} testID="gmail-search-filename" />
        <TextInput value={date} onChangeText={setDate} placeholder="Data YYYY-MM-DD" placeholderTextColor={colors.textSubtle} style={styles.input} testID="gmail-search-date" />
        <Pressable disabled={working} onPress={() => void search()} style={styles.action} testID="gmail-search">
          {working ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.actionText}>Ieškoti Excel priedų</Text>}
        </Pressable>
        {messages.map((message) => <View key={message.id} style={styles.message}>
          <Text style={styles.messageTitle}>{message.subject || '(be temos)'}</Text>
          <Text style={styles.messageMeta}>{message.from} · {message.date}</Text>
          {message.attachments.map((attachment) => <Pressable
            key={attachment.id}
            accessibilityRole="button"
            disabled={working || busy}
            onPress={() => void choose(message.id, attachment.id, attachment.filename)}
            style={({ pressed }) => [styles.attachment, pressed && styles.attachmentPressed, (working || busy) && styles.attachmentDisabled]}
            testID={`gmail-attachment-${attachment.id}`}>
            <Text style={styles.attachmentText}>{attachment.filename}</Text>
            <Text style={styles.attachmentAction}>{takingId === attachment.id ? 'Imama…' : 'Importuoti'}</Text>
          </Pressable>)}
        </View>)}
        <Pressable onPress={() => void employeeApi('/api/mail/disconnect', { method: 'POST', body: '{}' }).then(() => loadStatus())} style={styles.quiet}>
          <Text style={styles.quietText}>Atjungti šį paštą</Text>
        </Pressable>
      </> : null}
    </View> : null}
  </View>;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function waitForGmailConnection(
  loadStatus: () => Promise<MailStatus | null>,
  outcome: { current: 'connected' | 'error' | null },
): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const current = await loadStatus();
    if (current?.connected) return true;
    if (outcome.current === 'error') return false;
  }
  return false;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  wrap: { width: '100%', gap: spacing.sm },
  openButton: { minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  openTitle: { ...type.button, color: colors.text },
  openHint: { ...type.secondary, color: colors.textMuted },
  panel: { width: '100%', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  note: { ...type.secondary, color: colors.textMuted },
  notice: { ...type.secondary, color: colors.text },
  connected: { ...type.secondary, color: colors.text },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.background },
  action: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.brandNavy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  actionText: { ...type.button, color: colors.textInverse },
  message: { gap: spacing.xs, paddingTop: spacing.sm },
  messageTitle: { ...type.bodyStrong, color: colors.text },
  messageMeta: { ...type.secondary, color: colors.textMuted },
  attachment: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md },
  attachmentPressed: { opacity: 0.7 },
  attachmentDisabled: { opacity: 0.5 },
  attachmentText: { ...type.body, color: colors.text, flexShrink: 1 },
  attachmentAction: { ...type.label, color: colors.info },
  quiet: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  quietText: { ...type.secondary, color: colors.textMuted },
});
