import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { BackIcon, HomeIcon } from '@/components/app-icons';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { colors, fonts, spacing, type } from '@/ui/tokens';

export function StackBackButton({ fallback }: { readonly fallback?: Href }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const navigation = useLogicalStackNavigation(fallback);
  const showLabel = width >= 390;
  if (navigation.hideBack) return null;
  return (
    <Pressable accessibilityLabel="Atgal" accessibilityRole="button" onPress={() => router.replace(navigation.backTarget)} style={styles.action} testID="stack-back">
      <BackIcon size={25} />
      {showLabel ? <Text style={styles.label}>Atgal</Text> : null}
    </Pressable>
  );
}

export function StackHeaderActions() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const navigation = useLogicalStackNavigation();
  const showHome = !navigation.hideHome && navigation.homeTarget !== navigation.backTarget;
  if (width < 760 && !showHome) return null;
  return (
    <View style={styles.actions}>
      {width >= 760 ? <CloudSyncStatus compact /> : null}
      {showHome ? <Pressable accessibilityLabel="Pradžia" accessibilityRole="button" onPress={() => router.replace(navigation.homeTarget)} style={styles.action} testID="stack-home">
        <HomeIcon />
        {width >= 520 ? <Text style={styles.label}>Pradžia</Text> : null}
      </Pressable> : null}
    </View>
  );
}

function useLogicalStackNavigation(explicitFallback?: Href) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string | string[]; mode?: string | string[]; returnTo?: string | string[] }>();
  const { profile } = useLocalAccess();
  const homeTarget = roleHomePath(profile.role);
  const driverPrimary = profile.role === 'driver' && ['/history', '/statistics', '/settings'].includes(pathname);
  const roleRoot = pathname === homeTarget;
  const backTarget = explicitFallback ?? returnTarget(params.returnTo) ?? logicalParent(pathname, firstParam(params.id), firstParam(params.mode), homeTarget);
  return {
    backTarget,
    homeTarget,
    hideBack: driverPrimary || roleRoot,
    hideHome: driverPrimary || roleRoot,
  };
}

function logicalParent(pathname: string, routeId: string | undefined, mode: string | undefined, homeTarget: Href): Href {
  if (pathname === '/settings/locations') return '/settings';
  if (pathname.startsWith('/history/')) return '/history';
  if (/^\/route\/[^/]+\/alternatives$/.test(pathname) && routeId) return { pathname: '/route/[id]/review', params: { id: routeId } };
  if (/^\/route\/[^/]+\/review$/.test(pathname)) return '/import';
  if (/^\/route\/[^/]+\/overview$/.test(pathname)) return mode === 'management' ? '/route-management' as Href : '/history';
  if (/^\/route\/[^/]+\/(loading|delivery|result)$/.test(pathname)) return '/history';
  if (pathname === '/route-management' || pathname === '/financial-settings' || pathname === '/execute-route') return '/dispatcher';
  if (pathname === '/admin') return '/';
  if (pathname === '/import' || pathname === '/route/new') return homeTarget === '/' ? '/dispatcher' : homeTarget;
  if (pathname === '/fuel') return '/settings';
  return homeTarget;
}

function returnTarget(value: string | string[] | undefined): Href | null {
  const key = firstParam(value);
  const targets: Record<string, Href> = {
    home: '/', dispatcher: '/dispatcher', settings: '/settings', statistics: '/statistics',
    admin: '/admin', routes: '/history', 'route-management': '/route-management' as Href,
    'execute-route': '/execute-route' as Href, 'quality-control': '/quality-control' as Href,
    finance: '/finance' as Href, fleet: '/fleet' as Href, directory: '/directory' as Href,
  };
  return key ? targets[key] ?? null : null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  action: { minWidth: 52, minHeight: 52, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { ...type.bodyStrong, fontFamily: fonts.headingSemiBold, color: colors.brandNavy },
});
