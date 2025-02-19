import type { Config } from 'jest';
// @jest ^29.6.0
// @types/jest ^29.5.0
// @testing-library/jest-dom ^5.16.5

const config: Config = {
  // Use ts-jest preset for TypeScript support
  preset: 'ts-jest',

  // Set jsdom environment for DOM testing
  testEnvironment: 'jsdom',

  // Setup files to run before tests
  setupFilesAfterEnv: [
    '@testing-library/jest-dom'
  ],

  // File extensions to consider for tests
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
    'jsx',
    'json'
  ],

  // Transform TypeScript files
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },

  // Module name mapping for imports
  moduleNameMapper: {
    // Alias for src directory
    '^@/(.*)$': '<rootDir>/src/$1',
    // Handle style imports
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // Handle image imports
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/tests/__mocks__/fileMock.js'
  },

  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
    '<rootDir>/tests/**/*.{spec,test}.{ts,tsx}'
  ],

  // Coverage configuration
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'lcov',
    'json'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/vite-env.d.ts',
    '!src/main.tsx',
    '!src/App.tsx'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Watch plugins for better development experience
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],

  // TypeScript configuration
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json'
    }
  },

  // Performance and execution settings
  maxWorkers: '50%',
  timers: 'modern',
  verbose: true,
  testTimeout: 10000,

  // Reporters for CI/CD integration
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports/junit',
      outputName: 'jest-junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ]
};

export default config;