import { registerPlugin } from '@capacitor/core';
export interface EventPlugin {
  addListener(eventName: 'myPluginEvent' | 'deadEvent', listener: (data: unknown) => void): Promise<void>;
}
export const Events = registerPlugin<EventPlugin>('Events');
export function listen() {
  void Events.addListener('myPluginEvent', () => undefined);
  void Events.addListener('deadEvent', () => undefined);
}
