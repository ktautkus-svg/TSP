import { Linking } from 'react-native';

import { isUsablePhone, telUrl } from '@/domain/phone';

export async function callPhone(phone: string): Promise<void> {
  if (!isUsablePhone(phone)) throw new Error('Nėra veikiančio telefono numerio.');
  await Linking.openURL(telUrl(phone));
}
