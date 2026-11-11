import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';

export function useHomeNavigation() {
  const router = useRouter();
  const { profile, actingDriver, setActingDriver } = useLocalAccess();

  return useCallback(async () => {
    if (actingDriver) await setActingDriver(null);
    if (profile.role === 'driver') {
      router.replace({ pathname: '/', params: { showDashboard: '1' } });
      return;
    }
    router.replace(roleHomePath(profile.role));
  }, [actingDriver, profile.role, router, setActingDriver]);
}
