import { registerPlugin } from '@capacitor/core';

export interface BridgeContract {
  liveMethod(): Promise<{ value: string }>;
  phantomBridge(): Promise<void>;
}

export const Bridge = registerPlugin<BridgeContract>('Bridge');
