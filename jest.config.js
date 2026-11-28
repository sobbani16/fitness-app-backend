module.exports = {
  globalSetup: '<rootDir>/tests/globalSetup.js',
  setupFiles: ['<rootDir>/tests/setup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
};
