const { defineConfig } = require('@playwright/test');
const port = process.env.SONIN_TEST_PORT || '3001';
const baseURL = `http://localhost:${port}`;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  use: { baseURL, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: `"${process.execPath}" --openssl-legacy-provider server/index.js`,
    url: `${baseURL}/api/rooms`,
    env: { PORT: port },
    reuseExistingServer: !process.env.CI
  }
});