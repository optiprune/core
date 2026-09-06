import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Fixture Extension',
    description: 'A discoverable WXT extension fixture',
    permissions: ['storage'],
    host_permissions: ['https://example.com/*'],
  },
  modules: [],
});
