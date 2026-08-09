import { createContext, useContext } from 'react';
import type { EmployeeProfile } from '@/infrastructure/auth/employee-session';

export type LocalAccessContextValue = {
  username: string;
  profile: EmployeeProfile;
  online: boolean;
  logout: () => Promise<void>;
};

export const LocalAccessContext = createContext<LocalAccessContextValue | null>(null);

export function useLocalAccess(): LocalAccessContextValue {
  const value = useContext(LocalAccessContext);
  if (!value) throw new Error('Prisijungimo būsena nepasiekiama.');
  return value;
}
