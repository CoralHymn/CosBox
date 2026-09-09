/**
 * 跨平台 fetch 适配层（D104 / D112）。
 *
 * 有些服务商端点不允许浏览器 CORS 直连（如 opencode.ai 的 OPTIONS 预检直接
 * 404，浏览器侧表现为 TypeError: Failed to fetch，与 Key 无关）。这类端点经
 * 「内置软件通道」转发：baseUrl 仍存真实绝对地址，另用 useProxy 标记需要转发，
 * 请求前由 applyProxyPrefix 换成逻辑前缀 /llm-proxy/<host>/<path>。
 *
 * 前缀按平台各自落地（哪个服务商需要转发完全由配置决定，不再是某家专属）：
 * - 浏览器（dev / preview）：vite.config.ts 的 llmRelay 中间件按前缀里的 host
 *   动态转发（见 D99）。静态网页部署没有这层中间件，勾选通道的服务不可用。
 * - Tauri 打包版（桌面 / Android）：打包产物没有 Vite 中间件，前缀会命中 SPA
 *   fallback 返回 HTML（报「Unexpected token '<'」）。这里改用
 *   tauri-plugin-http 的 fetch：请求由 Rust 侧 reqwest 发出，不经过 WebView 的
 *   CORS 检查；同时把前缀重写回真实端点。
 */

import { isTauri } from './updater';
import { parseRelayTarget } from './relay-host';

/**
 * 真实端点 → 通道前缀：仅当该服务开启内置通道时生效。
 * 第二个参数刻意不设默认值，新增调用点必须显式表态要不要转发。
 * 已是相对路径、或目标是 http（本地服务，本就无 CORS 问题）时原样返回。
 */
export function applyProxyPrefix(url: string, useProxy: boolean | undefined): string {
	if (useProxy !== true || !/^https:\/\//i.test(url)) {
		return url;
	}
	try {
		const target = new URL(url);
		return `/llm-proxy/${target.host}${target.pathname}${target.search}`;
	} catch {
		return url;
	}
}

/** 通道前缀 → 真实端点；非前缀地址与畸形 host 原样返回。 */
export function resolveProxyUrl(url: string): string {
	return parseRelayTarget(url) ?? url;
}

/** 插件 fetch 的加载缓存：Tauri 环境下只动态导入一次。 */
let tauriFetchPromise: Promise<typeof fetch> | null = null;

async function loadTauriFetch(): Promise<typeof fetch> {
	tauriFetchPromise ??= import('@tauri-apps/plugin-http').then((m) => m.fetch);
	return tauriFetchPromise;
}

/**
 * 平台自适应 fetch：浏览器用原生 fetch；Tauri 打包版用 HTTP 插件
 * （Rust 侧发出，无 CORS 限制）。仅接受字符串 URL（LLM / 搜索客户端
 * 的调用形态），支持 AbortSignal（打断生成 / 流式思考）。
 */
export async function platformFetch(url: string, init?: RequestInit): Promise<Response> {
	if (!isTauri()) {
		return fetch(url, init);
	}
	const doFetch = await loadTauriFetch();
	return doFetch(resolveProxyUrl(url), init);
}
