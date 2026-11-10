import { defineConfig, devices } from '@playwright/test';

// End-to-end: the built site, served the way GitHub Pages serves it (under /fm-deal-scanner/).
const PORT = 4173;
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/fm-deal-scanner/`,
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 },
      // Start capture shares a stand-in screen, with no picker
      launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'] },
    },
  }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/fm-deal-scanner/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
