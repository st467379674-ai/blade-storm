import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 320,
      binaryInterval: 520,
      ignored: [
        '**/.tmp/**',
        '**/.chrome/**',
        '**/dist/**',
        '**/*.tmpdir/**',
        '**/*.tmp/**',
        '**/.*.tmpdir/**',
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
