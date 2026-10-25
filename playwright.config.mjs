// End-to-end test settings. Run with `npm run test:e2e`.
// Playwright starts the site with server.js, opens it in a real browser
// (Chromium), and clicks through it like a user would.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // Each test opens its own page, so tests can run side by side.
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Keep a screenshot and trace when a test fails, to see what went wrong.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node server.js`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
});
