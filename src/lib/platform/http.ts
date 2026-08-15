/**
 * 跨平台 fetch 适配层（D104）。
 *
 * 浏览器（npm run dev / preview / 静态部署）：直接用原生 fetch——
 * OpenCode GO/Zen 等 opencode.ai 端点不支持浏览器 CORS，dev/preview 由
 * vite.config.ts 的 /llm-proxy 代理转发（见 D99）。
 *
 * Tauri 打包版（桌面 / Android）：原生 fetch 仍受 WebView CORS 限制，且
 * 打包产物没有 Vite 代理——/llm-proxy 会命中 SPA fallback 返回 HTML，
 * 报「Unexpected token '<'」。这里改用 tauri-plugin-http 的 fetch：请求
 * 由 Rust 侧 reqwest 发出，不经过 WebView 的 CORS 检查；同时把
 * /llm-proxy 前缀重写回真实端点 https://opencode.ai。
 */

import { isTauri } from './updater';

const LLM_PROXY_PREFIX = '/llm-proxy/';
const LLM_PROXY_TARGET = 'https://opencode.ai';

/** Tauri 打包环境没有 Vite 代理：把 /llm-proxy 前缀重写回真实端点。 */
export function resolveProxyUrl(url: string): string {
	if (url.startsWith(LLM_PROXY_PREFIX)) {
		return LLM_PROXY_TARGET + '/' + url.slice(LLM_PROXY_PREFIX.length);
	}
	return url;
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
