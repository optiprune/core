import { registerPlugin } from '@capacitor/core';
export const Fallback = registerPlugin('Fallback', { web: () => import('./web').then(m => new m.Web()) });
