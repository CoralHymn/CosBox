import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import type { AddressInfo } from 'node:net';

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

/**
 * 开发专用：SvelteKit dev 服务器对「进程内第一个请求」有一次性的重活
 * （实测 25-36s，期间零 CPU——是一次阻塞式的中间件/模块图初始化；
 * 无论请求什么路径都会触发，之后所有请求都是毫秒级）。浏览器首开恰好撞上
 * 它，表现为「ready 打印后还要等十几秒页面才出现」。
 * 这里在服务器一就绪就用内部请求预热掉这次成本，并推迟打印 Local 地址，
 * 用户看到地址时页面已可秒开。只影响 dev（apply: 'serve'），不影响 build。
 */
function warmupFirstRequest(): Plugin {
	return {
		name: 'cosbox-dev-first-request-warmup',
		apply: 'serve',
		configureServer(server) {
			const originalPrintUrls = server.printUrls.bind(server);
			let warmed = false;
			server.printUrls = () => {
				if (!warmed) {
					// 预热完成前不打印地址，避免用户过早打开浏览器去撞初始化。
					return;
				}
				originalPrintUrls();
			};
			server.httpServer?.once('listening', () => {
				const address = server.httpServer?.address();
				if (address === null || typeof address === 'string') {
					warmed = true;
					return;
				}
				const port = (address as AddressInfo).port;
				// 必须跟随服务器实际打印的地址（resolvedUrls.local），
				// 与用户浏览器访问的地址一致：写死 127.0.0.1 在默认 localhost
				// 监听（或端口被双绑）时会打到错误的服务器，预热形同虚设。
				const target = server.resolvedUrls?.local[0] ?? `http://localhost:${port}`;
				const start = Date.now();
				console.log('  ➜  正在预热首次加载（首次约 1-10s），完成后将打印访问地址…');
				void fetch(target)
					.then((res) => res.text())
					.then(() => {
						warmed = true;
						const seconds = Math.round((Date.now() - start) / 1000);
						console.log(`  ➜  预热完成（${seconds}s），打开页面将即时显示`);
						server.printUrls();
					})
					.catch(() => {
						warmed = true;
						server.printUrls();
					});
			});
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), warmupFirstRequest()],
	optimizeDeps: {
		// 预打包清单：全部静态导入依赖 + svelte 子路径（组件编译产物会 import
		// svelte/internal 等）+ Tauri 动态导入包。不列出的话，首屏模块加载时会
		// 逐个「发现新依赖 → 二次优化 → 整页重载」，首个浏览器被挂起十几秒、
		// 后续浏览器同一时间才出 UI（实测日志：dependencies optimized: dexie, nanoid）。
		include: [
			'dexie',
			'nanoid',
			'svelte',
			'svelte/reactivity',
			'@tauri-apps/api/core',
			'@tauri-apps/api/window',
			'@tauri-apps/plugin-updater',
			'@tauri-apps/plugin-process'
		]
	},
	server: {
		proxy: llmProxy,
		watch: {
			// 根因修复：dev 监视器会在首个请求时惰性地把整个项目树加入 chokidar
			// 递归监视（实测 1.9 万文件/3.7 千目录耗时 38-47s，单核跑满、句柄
			// 暴涨到 2.3 万+）。大头是 Rust/Android 构建产物目录，忽略后项目树
			// 缩小到 ~2 千文件，监视器初始化降至秒级。
			ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**']
		},
		warmup: {
			// 预热入口组件：与首次 HTML 预热并行，把首屏组件编译也消化在启动阶段。
			// 依赖已在 optimizeDeps.include 全部预打包，预热不会再触发二次优化。
			clientFiles: ['./src/routes/+layout.svelte', './src/routes/+page.svelte']
		}
	},
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
