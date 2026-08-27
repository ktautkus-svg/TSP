import { createContext, useContext } from 'react';
import type { ActingDriver } from '@/application/auth/local-access';
import type { EmployeeProfile } from '@/infrastructure/auth/employee-session';

export type LocalAccessContextValue = {
  username: string;
  profile: EmployeeProfile;
  online: boolean;
  logout: () => Promise<void>;
  /** Set only for admin/dispatcher: the driver this device is currently operating as, if any. */
  actingDriver: ActingDriver | null;
  setActingDriver: (driver: ActingDriver | null) => Promise<void>;
};

export const LocalAccessContext = createContext<LocalAccessContextValue | null>(null);

export function useLocalAccess(): LocalAccessContextValue {
  const value = useContext(LocalAccessContext);
  if (!value) throw new Error('Prisijungimo būsena nepasiekiama.');
  return value;
}
