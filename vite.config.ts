import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { AddressInfo } from 'node:net';
import { isRelayPath, parseRelayTarget, RELAY_PREFIX } from './src/lib/platform/relay-host.ts';

/**
 * 内置软件通道（D99 / D112）。
 *
 * 部分服务商端点不允许浏览器 CORS 直连（如 opencode.ai 的 OPTIONS 预检直接 404，
 * 浏览器侧表现为 TypeError: Failed to fetch，与 Key 无关）。这类请求由
 * src/lib/platform/http.ts 的 applyProxyPrefix 换成逻辑前缀
 * /llm-proxy/<host>/<path>，这里按前缀里的 host 动态转发——哪个服务商需要转发
 * 完全由配置里的 useProxy 决定，不再是 opencode.ai 专属。
 *
 * Vite 的静态 proxy 表只能指向固定目标，做不到按运行时 host 路由，所以自己实现中间件。
 */

/**
 * 不转发给上游的请求头：逐跳头、由 Node 重算的长度/编码、以及不该出现在
 * 服务商请求里的浏览器上下文（Cookie 会把应用自身的 Cookie 泄露出去）。
 * 用黑名单而非白名单——白名单会漏掉 anthropic-version、openai-organization
 * 这类厂商自定义头，且以后每来一个新头都要改这里。
 */
const RELAY_SKIP_REQUEST_HEADERS = new Set([
	'host',
	'connection',
	'keep-alive',
	'proxy-connection',
	'transfer-encoding',
	'upgrade',
	'trailer',
	'content-length',
	'accept-encoding',
	'cookie',
	'cookie2',
	'origin',
	'referer'
]);

/** 该请求头是否转发给上游。 */
function forwardableRequestHeader(name: string): boolean {
	return !RELAY_SKIP_REQUEST_HEADERS.has(name) && !name.startsWith('sec-');
}

/** 回写时必须丢弃的响应头：undici 已解压并重编帧，原样透传会让浏览器解析失败。 */
const RELAY_RESPONSE_SKIP_HEADERS = new Set([
	'content-encoding',
	'content-length',
	'transfer-encoding',
	'connection',
	'keep-alive'
]);

/** 通道转发中间件：命中前缀则代理到 https://<host>/…，否则交给下一个中间件。 */
async function relayLlmRequest(
	req: IncomingMessage,
	res: ServerResponse,
	next: () => void
): Promise<void> {
	const url = req.url ?? '';
	if (!isRelayPath(url)) {
		next();
		return;
	}
	// 前缀之后的剩余部分整体就是「路径?查询」，无需拆开再拼回去。
	const target = parseRelayTarget(url);
	if (target === null) {
		res.statusCode = 400;
		res.end('invalid relay host');
		return;
	}

	const method = req.method ?? 'GET';
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value !== undefined && forwardableRequestHeader(name)) {
			headers[name] = Array.isArray(value) ? value.join(', ') : value;
		}
	}
	// 浏览器提前断开时取消上游请求（writableEnded 表示我们已经正常写完）。
	const controller = new AbortController();
	res.on('close', () => {
		if (!res.writableEnded) {
			controller.abort();
		}
	});

	try {
		// 先整体读干请求体再发上游：否则 IncomingMessage 的关闭时机不好掌握。
		const chunks: Buffer[] = [];
		if (method !== 'GET' && method !== 'HEAD') {
			for await (const chunk of req) {
				chunks.push(chunk as Buffer);
			}
		}
		const upstream = await fetch(target, {
			method,
			headers,
			body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
			redirect: 'manual',
			signal: controller.signal
		});

		res.statusCode = upstream.status;
		upstream.headers.forEach((value, name) => {
			if (name !== 'location' && !RELAY_RESPONSE_SKIP_HEADERS.has(name)) {
				res.setHeader(name, value);
			}
		});
		// 同源重定向改回通道前缀：否则浏览器会自己去跟进跨源地址，
		// 只留下一个裸 CORS 报错，比现在这样难查得多。
		const location = upstream.headers.get('location');
		if (location !== null) {
			const redirected = new URL(location, target);
			res.setHeader(
				'location',
				redirected.origin === new URL(target).origin
					? `${RELAY_PREFIX}${redirected.host}${redirected.pathname}${redirected.search}`
					: location
			);
		}
		if (upstream.body === null) {
			res.end();
			return;
		}
		await pipeline(
			Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>),
			res
		);
	} catch (err) {
		// 客户端中断（停止生成）与上游不可达都走这里：必须吞掉，
		// 否则 async handler 的 reject 会变成 unhandled rejection 打死 dev 服务器。
		controller.abort();
		if (res.headersSent) {
			res.destroy();
			return;
		}
		res.statusCode = 502;
		res.end(`内置通道转发失败：${err instanceof Error ? err.message : String(err)}`);
	}
}

/** dev 与 preview 都挂同一套通道转发；静态网页部署没有中间件，勾选通道的服务不可用。 */
function llmRelay(): Plugin {
	const handler = (req: IncomingMessage, res: ServerResponse, next: () => void): void =>
		void relayLlmRequest(req, res, next);
	return {
		name: 'cosbox-llm-relay',
		// 必须同步注册且抢在 Vite 内置中间件之前：否则前缀请求会命中
		// SPA fallback 拿回 HTML，退化成 D109 修掉的「Unexpected token '<'」。
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use(handler);
		},
		configurePreviewServer(server) {
			server.middlewares.use(handler);
		}
	};
}

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
	plugins: [sveltekit(), llmRelay(), warmupFirstRequest()],
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
			'@tauri-apps/plugin-process',
			'@tauri-apps/plugin-http'
		]
	},
	server: {
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
