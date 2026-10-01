export const DEMO_USERNAME = 'test1';
export const DEMO_PIN = '123456';
export const DEMO_DRIVER_ID = 'demo-driver-test1';
export const DEMO_DISPLAY_NAME = 'Demonstracinis vairuotojas';
export const DEMO_DATABASE_NAME = 'deliveries-demo-test1.db';
export const REAL_DATABASE_NAME = 'deliveries.db';
export const DEMO_DATABASE_MARKER = 'demo-driver-test1';

/** The published demo PIN must never authenticate a real account, whatever the username is. */
export function isPublicDemoPin(pin: string): boolean {
  return pin.trim() === DEMO_PIN;
}

/** Only the dedicated demo username plus the published PIN enters the isolated driver. */
export function isDemoDriverLogin(username: string, pin: string): boolean {
  return username.trim().toLocaleLowerCase('lt-LT') === DEMO_USERNAME && isPublicDemoPin(pin);
}
