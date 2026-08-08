import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * opencode.ai（OpenCode GO/Zen）的 API 不支持浏览器 CORS：OPTIONS 预检直接 404，
 * 浏览器直连会以 TypeError: Failed to fetch 失败（与 Key 无关）。
 * 这里把开发/预览服务器的 /llm-proxy 前缀转发到 opencode.ai，
 * 预设使用相对 baseUrl（见 src/lib/llm/providers.ts），开箱即用。
 */
const llmProxy = {
	'/llm-proxy': {
		target: 'https://opencode.ai',
		changeOrigin: true,
		rewrite: (path: string) => path.replace(/^\/llm-proxy/, '')
	}
};

export default defineConfig({
	plugins: [sveltekit()],
	server: { proxy: llmProxy },
	preview: { proxy: llmProxy },
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
