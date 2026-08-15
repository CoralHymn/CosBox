import { beforeEach, describe, expect, it, vi } from 'vitest';

// 文件级 mock：isTauri 与 HTTP 插件均可按测试控制（同 download.test.ts 模式）。
const tauriMock = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));
vi.mock('./updater', () => ({ isTauri: tauriMock.isTauri }));
const pluginFetch = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: pluginFetch }));

import { platformFetch, resolveProxyUrl } from './http';

describe('resolveProxyUrl', () => {
	it('把 /llm-proxy 前缀重写回 opencode.ai 真实端点', () => {
		expect(resolveProxyUrl('/llm-proxy/zen/go/v1/models')).toBe(
			'https://opencode.ai/zen/go/v1/models'
		);
		expect(resolveProxyUrl('/llm-proxy/zen/v1/chat/completions')).toBe(
			'https://opencode.ai/zen/v1/chat/completions'
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
});

describe('platformFetch', () => {
	beforeEach(() => {
		pluginFetch.mockReset();
	});

	it('浏览器环境：直接走全局 fetch 且不改写 URL（/llm-proxy 交给 Vite 代理）', async () => {
		tauriMock.isTauri.mockReturnValue(false);
		const nativeFetch = vi.fn().mockResolvedValue(new Response('{}'));
		vi.stubGlobal('fetch', nativeFetch);

		await platformFetch('/llm-proxy/zen/go/v1/models', { method: 'GET' });

		expect(nativeFetch).toHaveBeenCalledWith('/llm-proxy/zen/go/v1/models', { method: 'GET' });
		expect(pluginFetch).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('Tauri 环境：改用 HTTP 插件 fetch 并重写 /llm-proxy 前缀', async () => {
		tauriMock.isTauri.mockReturnValue(true);
		const nativeFetch = vi.fn();
		vi.stubGlobal('fetch', nativeFetch);
		pluginFetch.mockResolvedValue(new Response('{}'));

		await platformFetch('/llm-proxy/zen/go/v1/models');

		expect(pluginFetch).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/models', undefined);
		expect(nativeFetch).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
