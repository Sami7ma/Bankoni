// Minimal Jest setup for PURE TypeScript modules (formatters, tokens, helpers).
// It deliberately does not render React Native components; modal, keyboard and
// back-button behavior can only be verified on a device or emulator.
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/**/__tests__/**/*.test.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/dist/'],
    transform: {
        '^.+\\.(ts|tsx|js)$': ['babel-jest', { configFile: './babel.config.js' }],
    },
};
