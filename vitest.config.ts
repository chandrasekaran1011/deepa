import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        testTimeout: 10000,
    },
    resolve: {
        alias: {
            '#src': resolve(__dirname, 'src'),
        },
    },
});
