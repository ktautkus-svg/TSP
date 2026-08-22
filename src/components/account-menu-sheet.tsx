import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleLabel, sessionStateLabel } from '@/application/auth/employee-permissions';
import { GroupedMenuRow, GroupedMenuSection } from '@/components/grouped-menu';
import { MenuArtwork } from '@/components/menu-artwork';
import { StatusBadge } from '@/components/ui-primitives';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

export function AccountMenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { profile, online, logout } = useLocalAccess();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sessionState = sessionStateLabel(online);

  function openSettings() {
    onClose();
    router.push('/settings' as Href);
  }

  function openTripSheets() {
    onClose();
    router.push({ pathname: '/trip-sheet', params: { returnTo: 'home' } } as Href);
  }

  function confirmSwitchAccount() {
    Alert.alert(
      'Keisti paskyrą?',
      'Būsite atjungti nuo šios paskyros, kad galėtumėte prisijungti kitu darbuotojo vardu.',
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Keisti paskyrą', style: 'destructive', onPress: () => { onClose(); void logout(); } },
      ],
    );
  }

  function confirmLogout() {
    Alert.alert(
      'Atsijungti?',
      'Kitą kartą reikės įvesti prisijungimo vardą ir PIN.',
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Atsijungti', style: 'destructive', onPress: () => { onClose(); void logout(); } },
      ],
    );
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <Pressable accessibilityLabel="Uždaryti paskyros meniu" style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={() => undefined} testID="account-menu-sheet">
          <View style={styles.handle} />
          <View style={styles.identity}>
            <Text style={styles.name}>{profile.displayName}</Text>
            <Text style={styles.username}>@{profile.username}</Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={roleLabel(profile.role)} tone="neutral" />
              <StatusBadge label={sessionState.label} tone={sessionState.tone} />
            </View>
          </View>

          <GroupedMenuSection label="DARBO ĮRANKIAI">
            <GroupedMenuRow icon={<MenuArtwork kind="trip-sheet" />} onPress={openTripSheets} testID="account-menu-trip-sheets" title="Kelionės lapai" tone="success" />
            {profile.role !== 'quality' ? <GroupedMenuRow icon={<MenuArtwork kind="settings" />} onPress={openSettings} testID="account-menu-settings" title="Nustatymai" /> : null}
          </GroupedMenuSection>
          <GroupedMenuSection label="PASKYRA">
            <GroupedMenuRow description="Prisijungti kitu darbuotojo vardu." icon={<MenuArtwork kind="account" />} onPress={confirmSwitchAccount} testID="account-menu-switch" title="Keisti paskyrą" />
            <GroupedMenuRow icon={<MenuArtwork kind="logout" />} onPress={confirmLogout} testID="account-menu-logout" title="Atsijungti" tone="danger" />
          </GroupedMenuSection>

          <Pressable style={styles.close} onPress={onClose}><Text style={styles.closeText}>Uždaryti</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,20,15,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, marginTop: spacing.xs },
  identity: { gap: spacing.xs },
  name: { ...type.sectionTitle, color: colors.text },
  username: { ...type.secondary, color: colors.textMuted },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  close: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { ...type.secondaryStrong, color: colors.textMuted },
});
