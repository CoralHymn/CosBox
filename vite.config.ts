import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		setupFiles: ['src/test/setup.ts'],
		coverage: {
			provider: 'v8',
			include: [
				'src/lib/core/**',
				'src/lib/context/**',
				'src/lib/db/**',
				'src/lib/manager/**',
				'src/lib/llm/**',
				'src/lib/import-export/**',
				'src/lib/utils/**'
			],
			thresholds: {
				lines: 100,
				functions: 100,
				statements: 100,
				branches: 90
			}
		}
	}
});
