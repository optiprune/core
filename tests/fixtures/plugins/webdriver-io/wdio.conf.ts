import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/specs/**/*.e2e.ts'],
  framework: 'mocha',
  reporters: ['spec'],
  services: ['chromedriver'],
  capabilities: [{ browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless'] } }],
};
