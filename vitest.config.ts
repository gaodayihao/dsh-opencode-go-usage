import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    environmentMatchGlobs: [
      // Host-half tests stay on the plain node environment.
      ['src/api.test.ts', 'node'],
      ['src/config.test.ts', 'node'],
      ['src/service.test.ts', 'node'],
      ['src/provider.test.ts', 'node'],
    ],
  },
})
