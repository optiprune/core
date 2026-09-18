import { registerPlugin } from '@capacitor/core';
export interface ActiveOptions { label: string; }
export interface DeprecatedOptions { oldFlag: boolean; }
export enum Status { Ready = 'ready', Failed = 'failed', Removed = 'removed' }
export interface TypingPlugin { run(options: ActiveOptions): Promise<Status>; }
export const Typings = registerPlugin<TypingPlugin>('Typings');
