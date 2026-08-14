import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScopedKv } from '../db/scoped-kv';
import type { WorkspaceData } from '../import-export/workspace';
import { SyncService } from './sync-service';
import type { SyncSettings } from './types';

const settings: SyncSettings = {
	enabled: true,
	serverUrl: 'https://sync.example.com/',
	serverKey: 'test-key'
};

function kvMock(): ScopedKv {
	return {
		get: vi.fn(async () => undefined),
		set: vi.fn(async () => {}),
		remove: vi.fn(async () => {})
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	} as unknown as Response;
}

const workspace: WorkspaceData = {
	profile: { name: '绫音', systemPrompt: null },
	developerMode: false,
	worldInfo: [],
	memories: [],
	config: {},
	headId: null,
	snapshots: []
};

const WS_URL = 'https://sync.example.com/api/workspace/ws-test';

describe('SyncService', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('未启用时不发起任何请求', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const service = new SyncService(kvMock());
		await service.load();
		service.start({
			getSettings: () => ({ ...settings, enabled: false }),
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply: vi.fn(),
			onChange: vi.fn()
		});
		service.notifyChanged();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('连接测试：成功与失败', async () => {
		const service = new SyncService(kvMock());
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(200, { ok: true, service: 'cosbox-sync' }))
		);
		expect(await service.testConnection(settings)).toEqual({ ok: true, message: '连接成功' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(500, {}))
		);
		expect((await service.testConnection(settings)).ok).toBe(false);
	});

	it('本地变更防抖后推送到服务器并记录时间戳（URL 带工作区 id）', async () => {
		vi.useFakeTimers();
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(200, null))
			.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
		vi.stubGlobal('fetch', fetchSpy);
		const kv = kvMock();
		const service = new SyncService(kv);
		await service.load();
		service.start({
			getSettings: () => settings,
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply: vi.fn(),
			onChange: vi.fn()
		});
		await vi.advanceTimersByTimeAsync(0);
		service.notifyChanged();
		await vi.advanceTimersByTimeAsync(1600);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const [url, init] = fetchSpy.mock.calls[1]!;
		expect(String(url)).toBe(WS_URL);
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer test-key');
		const body = JSON.parse(init!.body as string);
		expect(body.data).toEqual(workspace);
		expect(typeof body.updatedAt).toBe('number');
		expect(kv.set).toHaveBeenCalledWith('sync.lastUpdatedAt', expect.any(Number));
	});

	it('轮询发现远端较新时应用远端数据且不触发回推', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(200, { data: workspace, updatedAt: 2000 }));
		vi.stubGlobal('fetch', fetchSpy);
		const kv = kvMock();
		const service = new SyncService(kv);
		await service.load();
		const apply = vi.fn(async () => {});
		service.start({
			getSettings: () => settings,
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply,
			onChange: () => service.notifyChanged()
		});
		await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		expect(apply).toHaveBeenCalledWith(workspace);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0]![0])).toBe(WS_URL);
		expect(kv.set).toHaveBeenCalledWith('sync.lastUpdatedAt', 2000);
	});

	it('reloadForWorkspace：重置游标并立即拉取新工作区远端', async () => {
		const get = vi.fn(async () => undefined as number | undefined);
		get.mockResolvedValueOnce(100).mockResolvedValueOnce(200);
		const kv: ScopedKv = {
			get: get as unknown as ScopedKv['get'],
			set: vi.fn(async () => {}),
			remove: vi.fn(async () => {})
		};
		const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, null));
		vi.stubGlobal('fetch', fetchSpy);
		const service = new SyncService(kv);
		await service.load();
		expect(get).toHaveBeenCalledWith('sync.lastUpdatedAt');
		service.start({
			getSettings: () => settings,
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply: vi.fn(),
			onChange: vi.fn()
		});
		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
		await service.reloadForWorkspace();
		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('远端鉴权失败时不应用数据', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(401, { error: '密钥无效' }))
		);
		const service = new SyncService(kvMock());
		await service.load();
		const apply = vi.fn(async () => {});
		service.start({
			getSettings: () => settings,
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply,
			onChange: vi.fn()
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(apply).not.toHaveBeenCalled();
	});

	it('手动同步：先拉取再推送本地', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(200, null)) // start 的立即轮询 GET
			.mockResolvedValueOnce(jsonResponse(200, null)) // syncNow 的轮询 GET
			.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
		vi.stubGlobal('fetch', fetchSpy);
		const service = new SyncService(kvMock());
		await service.load();
		service.start({
			getSettings: () => settings,
			getWorkspaceId: () => 'ws-test',
			collect: () => workspace,
			apply: vi.fn(),
			onChange: vi.fn()
		});
		const result = await service.syncNow();
		expect(result.ok).toBe(true);
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(String(fetchSpy.mock.calls[2]![0])).toBe(WS_URL);
		expect(fetchSpy.mock.calls[2]![1]?.method).toBe('PUT');
	});
});
