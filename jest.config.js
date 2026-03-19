module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
  modulePathIgnorePatterns: [
    '<rootDir>/Visual Studio Code-2.app/',
    '<rootDir>/dotenv/',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/Visual Studio Code-2.app/',
    '<rootDir>/dotenv/',
  ],
};
