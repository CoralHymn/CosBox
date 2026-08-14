import type { ScopedKv } from '../db/scoped-kv';
import type { WorkspaceData } from '../import-export/workspace';
import type { SyncSettings, SyncWorkspacePayload } from './types';

/** 工作区作用域 kv 中保存的「上次成功同步的时间戳」。 */
const LAST_SYNC_KEY = 'sync.lastUpdatedAt';
/** 本地变更后推送的防抖时间。 */
const PUSH_DEBOUNCE_MS = 1500;
/** 轮询远端更新的间隔（近似实时）。 */
const POLL_INTERVAL_MS = 5000;
/** 网络请求超时。 */
const REQUEST_TIMEOUT_MS = 10000;

/** 同步服务依赖：设置读取、工作区定位、数据收集、远端数据应用、变更通知。 */
export interface SyncDeps {
	getSettings: () => SyncSettings;
	/** 当前工作区 id（服务端按工作区分槽）。 */
	getWorkspaceId: () => string;
	/** 收集当前完整工作区数据（不含模型配置与 Key），允许异步收集。 */
	collect: () => WorkspaceData | Promise<WorkspaceData>;
	/** 应用远端工作区数据（整体恢复本地）。 */
	apply: (data: WorkspaceData) => Promise<void>;
	/** 本地数据变化通知（触发防抖推送）。 */
	onChange: () => void;
}

/** 同步操作结果（供设置页展示）。 */
export interface SyncResult {
	ok: boolean;
	message: string;
}

/**
 * 远程数据同步服务：
 * - 本地变更防抖推送（约 1.5s）到服务器；
 * - 定时轮询远端（约 5s），远端较新时整体应用（较新一方胜出）；
 * - 未启用时不发起任何请求；同步数据不含模型配置与 API Key。
 */
export class SyncService {
	private lastSyncedAt = 0;
	private dirty = false;
	private suppressPush = false;
	private running = false;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private pushTimer: ReturnType<typeof setTimeout> | undefined;
	private deps: SyncDeps | undefined;

	constructor(private readonly kv: ScopedKv) {}

	/** 从 kv 恢复上次同步时间戳。 */
	async load(): Promise<void> {
		this.lastSyncedAt = (await this.kv.get<number>(LAST_SYNC_KEY)) ?? 0;
	}

	/**
	 * 切换工作区后重装：读取新工作区的同步游标、丢弃旧脏标记，
	 * 已启动则立即拉取一次远端（应用期间沿用 suppressPush 防回环）。
	 */
	async reloadForWorkspace(): Promise<void> {
		this.lastSyncedAt = (await this.kv.get<number>(LAST_SYNC_KEY)) ?? 0;
		this.dirty = false;
		if (this.pushTimer !== undefined) {
			clearTimeout(this.pushTimer);
			this.pushTimer = undefined;
		}
		if (this.running) {
			void this.poll();
		}
	}

	/** 开始轮询（启用时才真正运行）。 */
	start(deps: SyncDeps): void {
		this.deps = deps;
		if (this.running) {
			return;
		}
		if (!deps.getSettings().enabled) {
			return;
		}
		this.running = true;
		this.pollTimer = setInterval(() => {
			void this.poll();
		}, POLL_INTERVAL_MS);
		void this.poll();
	}

	/** 停止轮询与待推送。 */
	stop(): void {
		this.running = false;
		if (this.pollTimer !== undefined) {
			clearInterval(this.pollTimer);
		}
		if (this.pushTimer !== undefined) {
			clearTimeout(this.pushTimer);
		}
		this.pollTimer = undefined;
		this.pushTimer = undefined;
	}

	/** 本地数据变化：防抖后推送。 */
	notifyChanged(): void {
		if (!this.running || this.suppressPush || this.deps === undefined) {
			return;
		}
		this.dirty = true;
		if (this.pushTimer !== undefined) {
			clearTimeout(this.pushTimer);
		}
		this.pushTimer = setTimeout(() => {
			void this.push();
		}, PUSH_DEBOUNCE_MS);
	}

	/** 连接测试：调用 /api/health。 */
	async testConnection(settings: SyncSettings): Promise<SyncResult> {
		const base = normalizeBase(settings.serverUrl);
		if (base === '') {
			return { ok: false, message: '请先填写服务器地址' };
		}
		try {
			const res = await fetch(`${base}/api/health`, {
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!res.ok) {
				return { ok: false, message: `服务器返回 ${res.status}` };
			}
			const body: unknown = await res.json().catch(() => null);
			if (body !== null && typeof body === 'object' && (body as { ok?: unknown }).ok === true) {
				return { ok: true, message: '连接成功' };
			}
			return { ok: false, message: '响应格式异常，可能不是 CosBox 同步服务' };
		} catch (err) {
			return {
				ok: false,
				message: err instanceof Error ? err.message : '无法连接服务器'
			};
		}
	}

	/** 手动立即同步：先拉取远端（较新则应用），再把本地推送到服务器。 */
	async syncNow(): Promise<SyncResult> {
		if (this.deps === undefined) {
			return { ok: false, message: '同步服务未初始化' };
		}
		if (!this.deps.getSettings().enabled) {
			return { ok: false, message: '请先启用远程同步' };
		}
		await this.poll();
		await this.push(true);
		return { ok: true, message: '同步完成' };
	}

	private async poll(): Promise<void> {
		if (this.deps === undefined || !this.deps.getSettings().enabled) {
			return;
		}
		const server = await this.fetchWorkspace();
		if (server !== null && server.updatedAt > this.lastSyncedAt) {
			this.suppressPush = true;
			try {
				await this.deps.apply(server.data);
				this.lastSyncedAt = server.updatedAt;
				await this.kv.set(LAST_SYNC_KEY, this.lastSyncedAt);
			} finally {
				this.suppressPush = false;
			}
		}
		if (this.dirty) {
			await this.push();
		}
	}

	private async push(force = false): Promise<void> {
		if (this.deps === undefined || !this.deps.getSettings().enabled) {
			return;
		}
		if (!force && !this.dirty) {
			return;
		}
		const payload: SyncWorkspacePayload = {
			data: await this.deps.collect(),
			updatedAt: Date.now()
		};
		const base = normalizeBase(this.deps.getSettings().serverUrl);
		if (base === '') {
			return;
		}
		try {
			const res = await fetch(`${this.workspaceUrl(base)}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.deps.getSettings().serverKey}`
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!res.ok) {
				return;
			}
			this.lastSyncedAt = payload.updatedAt;
			this.dirty = false;
			if (this.pushTimer !== undefined) {
				clearTimeout(this.pushTimer);
			}
			this.pushTimer = undefined;
			await this.kv.set(LAST_SYNC_KEY, this.lastSyncedAt);
		} catch {
			// 静默失败：保留 dirty，下次轮询/变更时重试。
		}
	}

	private async fetchWorkspace(): Promise<SyncWorkspacePayload | null> {
		const deps = this.deps;
		if (deps === undefined) {
			return null;
		}
		const base = normalizeBase(deps.getSettings().serverUrl);
		if (base === '') {
			return null;
		}
		try {
			const res = await fetch(this.workspaceUrl(base), {
				headers: { Authorization: `Bearer ${deps.getSettings().serverKey}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!res.ok) {
				return null;
			}
			const body: unknown = await res.json().catch(() => null);
			if (
				body === null ||
				typeof body !== 'object' ||
				typeof (body as SyncWorkspacePayload).updatedAt !== 'number'
			) {
				return null;
			}
			return body as SyncWorkspacePayload;
		} catch {
			return null;
		}
	}

	/** 当前工作区的同步端点（服务端按工作区分槽，D108）。 */
	private workspaceUrl(base: string): string {
		const workspaceId = this.deps?.getWorkspaceId() ?? 'default';
		return `${base}/api/workspace/${encodeURIComponent(workspaceId)}`;
	}
}

/** 去掉服务器地址末尾斜杠。 */
function normalizeBase(url: string): string {
	return url.trim().replace(/\/+$/, '');
}
