import type { ConfigOverrides, SnapshotNode, WorldInfoEntry } from '../core/types';
import type { MemoryEntry } from '../memory/types';
import type { AppProfile } from '../stores/settings.svelte';
import { zipEntries, unzipEntries, type ZipEntry } from '../utils/zip';

/**
 * 工作区文件版本。
 * v1：manifest/profile/developer/world-info/config/snapshots（无记忆、无工作区名）。
 * v2：新增 memories.json 与 manifest.workspaceName；解析兼容 v1。
 */
export const WORKSPACE_VERSION = 2;
/** .cbox 文件内的应用标识。 */
export const WORKSPACE_APP = 'cosbox';

/** 工作区数据：除模型配置外的全部内容（不含 API Key 等敏感信息）。 */
export interface WorkspaceData {
	profile: AppProfile;
	developerMode: boolean;
	worldInfo: WorldInfoEntry[];
	/** 长期记忆（v1 文件解析时补空数组）。 */
	memories: MemoryEntry[];
	config: ConfigOverrides;
	headId: string | null;
	snapshots: SnapshotNode[];
	/** 导出时的工作区名称（导入为新工作区时作为默认名）。 */
	workspaceName?: string;
}

/** 把工作区数据打包为 .cbox（ZIP）字节。 */
export function serializeWorkspace(data: WorkspaceData): Uint8Array {
	const entries: ZipEntry[] = [
		{
			name: 'manifest.json',
			data: encodeText(
				JSON.stringify({
					app: WORKSPACE_APP,
					version: WORKSPACE_VERSION,
					exportedAt: new Date().toISOString(),
					...(data.workspaceName !== undefined ? { workspaceName: data.workspaceName } : {})
				})
			)
		},
		{ name: 'profile.json', data: encodeText(JSON.stringify(data.profile)) },
		{ name: 'developer.json', data: encodeText(JSON.stringify(data.developerMode)) },
		{ name: 'world-info.json', data: encodeText(JSON.stringify(data.worldInfo)) },
		{ name: 'memories.json', data: encodeText(JSON.stringify(data.memories ?? [])) },
		{ name: 'config.json', data: encodeText(JSON.stringify(data.config)) },
		{
			name: 'snapshots.json',
			data: encodeText(JSON.stringify({ headId: data.headId, nodes: data.snapshots }))
		}
	];
	return zipEntries(entries);
}

/** 解析 .cbox 工作区；非法内容抛错。v1 文件兼容（记忆按空数组）。 */
export function parseWorkspace(bytes: Uint8Array): WorkspaceData {
	const files = unzipEntries(bytes);
	const manifest = readJsonObject(files.get('manifest.json'), 'manifest.json');
	if (manifest.app !== WORKSPACE_APP) {
		throw new Error('不是 CosBox 工作区文件');
	}
	if (manifest.version !== WORKSPACE_VERSION && manifest.version !== 1) {
		throw new Error(`不支持的工作区版本：${String(manifest.version)}`);
	}
	const profile = readJsonObject(
		files.get('profile.json'),
		'profile.json'
	) as unknown as AppProfile;
	const developerMode = readJsonBoolean(files.get('developer.json'), 'developer.json');
	const worldInfo = readJsonArray(
		files.get('world-info.json'),
		'world-info.json'
	) as WorldInfoEntry[];
	// v2 的 memories.json 缺失视为空（兼容部分导出工具省略空数组）。
	const memories = (
		files.get('memories.json') === undefined
			? []
			: readJsonArray(files.get('memories.json'), 'memories.json')
	) as MemoryEntry[];
	const config = readJsonObject(
		files.get('config.json'),
		'config.json'
	) as unknown as ConfigOverrides;
	const snapshotsFile = readJsonObject(files.get('snapshots.json'), 'snapshots.json');
	if (!Array.isArray(snapshotsFile.nodes)) {
		throw new Error('snapshots.json 缺少 nodes 数组');
	}
	const headId =
		snapshotsFile.headId === null || snapshotsFile.headId === undefined
			? null
			: snapshotsFile.headId;
	if (headId !== null && typeof headId !== 'string') {
		throw new Error('snapshots.json 的 headId 非法');
	}
	const workspaceName =
		typeof manifest.workspaceName === 'string' && manifest.workspaceName.trim() !== ''
			? manifest.workspaceName
			: undefined;
	return {
		profile,
		developerMode,
		worldInfo,
		memories,
		config,
		headId,
		snapshots: snapshotsFile.nodes as SnapshotNode[],
		...(workspaceName !== undefined ? { workspaceName } : {})
	};
}

function encodeText(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function readJsonObject(file: Uint8Array | undefined, name: string): Record<string, unknown> {
	if (file === undefined) {
		throw new Error(`缺少 ${name}`);
	}
	const value = JSON.parse(new TextDecoder().decode(file));
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${name} 不是对象`);
	}
	return value as Record<string, unknown>;
}

function readJsonBoolean(file: Uint8Array | undefined, name: string): boolean {
	if (file === undefined) {
		throw new Error(`缺少 ${name}`);
	}
	const value = JSON.parse(new TextDecoder().decode(file));
	if (typeof value !== 'boolean') {
		throw new Error(`${name} 不是布尔值`);
	}
	return value;
}

function readJsonArray(file: Uint8Array | undefined, name: string): unknown[] {
	if (file === undefined) {
		throw new Error(`缺少 ${name}`);
	}
	const value = JSON.parse(new TextDecoder().decode(file));
	if (!Array.isArray(value)) {
		throw new Error(`${name} 不是数组`);
	}
	return value;
}
