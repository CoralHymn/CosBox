import { beforeEach, describe, expect, it, vi } from 'vitest';

// 文件级 mock：isTauri 与 HTTP 插件均可按测试控制（同 download.test.ts 模式）。
const tauriMock = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));
vi.mock('./updater', () => ({ isTauri: tauriMock.isTauri }));
const pluginFetch = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: pluginFetch }));

import { applyProxyPrefix, platformFetch, resolveProxyUrl } from './http';

describe('applyProxyPrefix', () => {
	it('开启通道时把绝对端点换成 /llm-proxy/<host>/ 逻辑前缀', () => {
		expect(applyProxyPrefix('https://opencode.ai/zen/go/v1/chat/completions', true)).toBe(
			'/llm-proxy/opencode.ai/zen/go/v1/chat/completions'
		);
	});

	it('端口与查询串一并带进前缀', () => {
		expect(applyProxyPrefix('https://127.0.0.1:8787/v1/models?a=1', true)).toBe(
			'/llm-proxy/127.0.0.1:8787/v1/models?a=1'
		);
	});

	it('未开启通道时原样返回（false 与缺失都算关闭）', () => {
		expect(applyProxyPrefix('https://opencode.ai/zen/v1/models', false)).toBe(
			'https://opencode.ai/zen/v1/models'
		);
		expect(applyProxyPrefix('https://opencode.ai/zen/v1/models', undefined)).toBe(
			'https://opencode.ai/zen/v1/models'
		);
	});

	it('http 端点与已是相对路径的地址不转发', () => {
		expect(applyProxyPrefix('http://localhost:11434/v1/models', true)).toBe(
			'http://localhost:11434/v1/models'
		);
		expect(applyProxyPrefix('/llm-proxy/opencode.ai/v1/models', true)).toBe(
			'/llm-proxy/opencode.ai/v1/models'
		);
	});

	it('绝对地址解析失败时原样返回', () => {
		expect(applyProxyPrefix('https://', true)).toBe('https://');
	});
});

describe('resolveProxyUrl', () => {
	it('把 /llm-proxy/<host>/ 前缀重写回真实端点（不再是 opencode.ai 专属）', () => {
		expect(resolveProxyUrl('/llm-proxy/opencode.ai/zen/go/v1/models')).toBe(
			'https://opencode.ai/zen/go/v1/models'
		);
		expect(resolveProxyUrl('/llm-proxy/api.example.com/v1/chat/completions')).toBe(
			'https://api.example.com/v1/chat/completions'
		);
	});

	it('绝对端点与其它相对路径原样保留', () => {
		expect(resolveProxyUrl('https://api.openai.com/v1/models')).toBe(
			'https://api.openai.com/v1/models'
		);
		expect(resolveProxyUrl('http://localhost:11434/v1/chat/completions')).toBe(
			'http://localhost:11434/v1/chat/completions'
		);
		expect(resolveProxyUrl('/api/health')).toBe('/api/health');
	});

	it('未迁移的老式前缀不做猜测，原样返回', () => {
		// /llm-proxy/zen/... 里第一段是路径不是 host；猜成任何目标都会静默打错端点。
		expect(resolveProxyUrl('/llm-proxy/zen/go/v1/models')).toBe('/llm-proxy/zen/go/v1/models');
	});
});

describe('applyProxyPrefix 与 resolveProxyUrl 互逆', () => {
	it('Tauri 侧「先加前缀再还原」不会改变真实端点', () => {
		const endpoints = [
			'https://opencode.ai/zen/go/v1/chat/completions',
			'https://api.example.com/v1/models?key=x'
		];
		for (const endpoint of endpoints) {
			expect(resolveProxyUrl(applyProxyPrefix(endpoint, true))).toBe(endpoint);
		}
	});
});

describe('platformFetch', () => {
	beforeEach(() => {
		pluginFetch.mockReset();
	});

	it('浏览器环境：直接走全局 fetch 且不改写 URL（/llm-proxy 交给 Vite 中间件）', async () => {
		tauriMock.isTauri.mockReturnValue(false);
		const nativeFetch = vi.fn().mockResolvedValue(new Response('{}'));
		vi.stubGlobal('fetch', nativeFetch);

		await platformFetch('/llm-proxy/opencode.ai/zen/go/v1/models', { method: 'GET' });

		expect(nativeFetch).toHaveBeenCalledWith('/llm-proxy/opencode.ai/zen/go/v1/models', {
			method: 'GET'
		});
		expect(pluginFetch).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('Tauri 环境：改用 HTTP 插件 fetch 并重写 /llm-proxy 前缀', async () => {
		tauriMock.isTauri.mockReturnValue(true);
		const nativeFetch = vi.fn();
		vi.stubGlobal('fetch', nativeFetch);
		pluginFetch.mockResolvedValue(new Response('{}'));

		await platformFetch('/llm-proxy/opencode.ai/zen/go/v1/models');

		expect(pluginFetch).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/models', undefined);
		expect(nativeFetch).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
