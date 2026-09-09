import { describe, expect, it } from 'vitest';
import type { SnapshotNode } from '../core/types';
import { zipEntries } from '../utils/zip';
import { parseWorkspace, serializeWorkspace, type WorkspaceData } from './workspace';

function makeWorkspace(): WorkspaceData {
	const root: SnapshotNode = {
		id: 'root',
		timestamp: 1,
		parentId: null,
		metadata: { type: 'root', desc: '初始状态' },
		delta: null
	};
	return {
		profile: {
			name: '绫音',
			systemPrompt: '你是绫音',
			characterPrompt: '16 岁高中生',
			userPrompt: '用户是同学',
			worldPrompt: '现代虚拟学园',
			stylePrompt: '余华式白描'
		},
		developerMode: true,
		worldInfo: [{ id: 'w1', keys: ['图书馆'], content: '校园传说', enabled: true, priority: 10 }],
		memories: [
			{
				id: 'm1',
				content: '记得带伞',
				category: '其他',
				keywords: ['下雨'],
				importance: 3,
				pinned: false,
				source: 'manual',
				createdAt: 1,
				updatedAt: 1,
				lastUsedAt: 0,
				useCount: 0
			}
		],
		config: {
			places: [{ id: 'p1', category: '学校', name: '食堂', description: 'x' }],
			wardrobe: [{ id: 'c1', category: '常服', kind: 'top', name: '衬衫', description: 'x' }],
			scheduleEntries: [{ id: 's1', day: 0, start: 480, end: 540, title: '晨会' }]
		},
		headId: 'root',
		snapshots: [root],
		workspaceName: '我的故事'
	};
}

function zipWith(files: Record<string, string>): Uint8Array {
	return zipEntries(
		Object.entries(files).map(([name, content]) => ({
			name,
			data: new TextEncoder().encode(content)
		}))
	);
}

const MANIFEST = JSON.stringify({ app: 'cosbox', version: 1, exportedAt: 'x' });

function goodFiles(): Record<string, string> {
	return {
		'manifest.json': MANIFEST,
		'profile.json': JSON.stringify({ name: '绫音', systemPrompt: '你是绫音' }),
		'developer.json': 'true',
		'world-info.json': '[]',
		'config.json': '{}',
		'snapshots.json': JSON.stringify({ headId: null, nodes: [] })
	};
}

describe('workspace', () => {
	it('序列化 → 解析往返（含完整数据与 v2 记忆/名称）', () => {
		const data = makeWorkspace();
		const parsed = parseWorkspace(serializeWorkspace(data));
		expect(parsed).toEqual(data);
	});

	it('v1 文件兼容：无 memories.json 时记忆为空、无名称', () => {
		const parsed = parseWorkspace(zipWith(goodFiles()));
		expect(parsed.memories).toEqual([]);
		expect(parsed.workspaceName).toBeUndefined();
		expect(parsed.headId).toBeNull();
	});

	it('serializeWorkspace 兼容缺失 memories / workspaceName 字段', () => {
		const data = makeWorkspace();
		delete (data as Partial<WorkspaceData>).memories;
		delete (data as Partial<WorkspaceData>).workspaceName;
		const parsed = parseWorkspace(serializeWorkspace(data));
		expect(parsed.memories).toEqual([]);
		expect(parsed.workspaceName).toBeUndefined();
	});

	it('headId 为 null 时往返', () => {
		const data = makeWorkspace();
		data.headId = null;
		expect(parseWorkspace(serializeWorkspace(data)).headId).toBeNull();
	});

	it('非 ZIP 抛错', () => {
		expect(() => parseWorkspace(new Uint8Array([1, 2, 3]))).toThrow('不是有效的 ZIP');
	});

	it('缺 manifest / 非 CosBox / 版本不支持', () => {
		const noManifest = { ...goodFiles() };
		delete noManifest['manifest.json'];
		expect(() => parseWorkspace(zipWith(noManifest))).toThrow('缺少 manifest.json');

		expect(() =>
			parseWorkspace(
				zipWith({ ...goodFiles(), 'manifest.json': JSON.stringify({ app: 'other', version: 1 }) })
			)
		).toThrow('不是 CosBox 工作区文件');

		expect(() =>
			parseWorkspace(
				zipWith({ ...goodFiles(), 'manifest.json': JSON.stringify({ app: 'cosbox', version: 3 }) })
			)
		).toThrow('不支持的工作区版本');
	});

	it('profile 缺失或结构非法', () => {
		const missing = { ...goodFiles() };
		delete missing['profile.json'];
		expect(() => parseWorkspace(zipWith(missing))).toThrow('缺少 profile.json');
		expect(() => parseWorkspace(zipWith({ ...goodFiles(), 'profile.json': '[]' }))).toThrow(
			'不是对象'
		);
	});

	it('developer 缺失或非布尔', () => {
		const missing = { ...goodFiles() };
		delete missing['developer.json'];
		expect(() => parseWorkspace(zipWith(missing))).toThrow('缺少 developer.json');
		expect(() => parseWorkspace(zipWith({ ...goodFiles(), 'developer.json': '"yes"' }))).toThrow(
			'不是布尔值'
		);
	});

	it('world-info 缺失或非数组', () => {
		const missing = { ...goodFiles() };
		delete missing['world-info.json'];
		expect(() => parseWorkspace(zipWith(missing))).toThrow('缺少 world-info.json');
		expect(() => parseWorkspace(zipWith({ ...goodFiles(), 'world-info.json': '{}' }))).toThrow(
			'不是数组'
		);
	});

	it('config 缺失', () => {
		const missing = { ...goodFiles() };
		delete missing['config.json'];
		expect(() => parseWorkspace(zipWith(missing))).toThrow('缺少 config.json');
	});

	it('snapshots 缺失 / 缺 nodes / headId 非法', () => {
		const missing = { ...goodFiles() };
		delete missing['snapshots.json'];
		expect(() => parseWorkspace(zipWith(missing))).toThrow('缺少 snapshots.json');

		expect(() =>
			parseWorkspace(
				zipWith({ ...goodFiles(), 'snapshots.json': JSON.stringify({ headId: null }) })
			)
		).toThrow('缺少 nodes');

		expect(() =>
			parseWorkspace(
				zipWith({ ...goodFiles(), 'snapshots.json': JSON.stringify({ headId: 3, nodes: [] }) })
			)
		).toThrow('headId 非法');
	});
});
