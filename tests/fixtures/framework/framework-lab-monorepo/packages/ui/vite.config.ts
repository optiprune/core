import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import Unocss from 'unocss/vite';
import { createUnplugin } from 'unplugin';
const fixturePlugin = createUnplugin(() => ({ name: 'fixture-virtual', resolveId: id => id === 'virtual:fixture' ? id : undefined, load: id => id === 'virtual:fixture' ? 'export const virtualValue = 1' : undefined }));
export default defineConfig({ plugins: [react(), Unocss(), fixturePlugin.vite()] });
