/** Integration test: menjalankan aplikasi Nest penuh terhadap database DATABASE_URL_TEST */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  globalSetup: '<rootDir>/global-setup.ts',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30000,
};
