import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import type { ChatMessageView, WorldInfoEntry } from '../core/types';
import { buildContext, buildToolGuidance, defaultSystemPrompt } from './pipeline';

function history(): ChatMessageView[] {
	return [
		{ id: '1', role: 'user', content: '早上好', timestamp: 1 },
		{ id: '2', role: 'assistant', content: '早上好呀', timestamp: 2 }
	];
}

function worldInfo(): WorldInfoEntry[] {
	return [
		{
			id: 'w1',
			keys: ['图书馆'],
			content: '图书馆是校园传说发生地。',
			enabled: true,
			priority: 100
		}
	];
}

describe('defaultSystemPrompt', () => {
	it('生成包含角色名的提示', () => {
		expect(defaultSystemPrompt('绫音')).toContain('「绫音」');
		expect(defaultSystemPrompt('绫音')).toContain('当前状态');
	});
});

describe('buildToolGuidance', () => {
	it('包含状态工具名称与调用说明', () => {
		const text = buildToolGuidance();
		expect(text).toContain('【工具使用】');
		expect(text).toContain('goto_location');
		expect(text).toContain('set_outfit');
		expect(text).toContain('advance_time');
		expect(text).toContain('set_attribute');
	});
});

describe('buildContext', () => {
	it('组装系统消息：基础提示 + 状态摘要 + 世界信息命中', () => {
		const conversation = [
			{ id: '1', role: 'user' as const, content: '我们去图书馆吧', timestamp: 1 },
			{ id: '2', role: 'assistant' as const, content: '好啊', timestamp: 2 }
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: worldInfo(),
			characterName: '绫音'
		});
		expect(bundle.systemMessage).toContain('「绫音」');
		expect(bundle.systemMessage).toContain('时间：周一 08:00');
		expect(bundle.systemMessage).toContain('图书馆是校园传说发生地。');
		expect(bundle.worldInfoHits).toHaveLength(1);
		expect(bundle.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(bundle.compressedCount).toBe(0);
	});

	it('无命中时不注入世界设定块', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: worldInfo()
		});
		expect(bundle.systemMessage).not.toContain('【世界设定】');
		expect(bundle.worldInfoHits).toEqual([]);
	});

	it('角色名回退到 attributes.name', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: []
		});
		expect(bundle.systemMessage).toContain('「绫音」');
	});

	it('自定义 systemPrompt 覆盖默认模板', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: [],
			systemPrompt: '自定义规则'
		});
		expect(bundle.systemMessage.startsWith('自定义规则')).toBe(true);
		expect(bundle.systemMessage).not.toContain('你是「');
	});

	it('历史压缩生效并体现在消息数组', () => {
		const conversation = [
			{ id: '1', role: 'user' as const, content: 'a', timestamp: 1 },
			{ id: '2', role: 'user' as const, content: 'b', timestamp: 2 },
			{ id: '3', role: 'user' as const, content: 'c', timestamp: 3 }
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: [],
			historyOptions: { maxMessages: 1 }
		});
		expect(bundle.compressedCount).toBe(2);
		expect(bundle.messages[0]!.role).toBe('system');
		expect(bundle.messages[0]!.content).toContain('已压缩');
	});

	it('有搜索结果时注入【网络搜索结果】块', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: [],
			searchResults: [{ title: '樱花学园官网', url: 'https://example.com', snippet: '学园简介' }]
		});
		expect(bundle.systemMessage).toContain('【网络搜索结果】');
		expect(bundle.systemMessage).toContain('樱花学园官网');
		expect(bundle.systemMessage).toContain('https://example.com');
		expect(bundle.searchResults).toHaveLength(1);
	});

	it('无搜索结果时不注入搜索块', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: []
		});
		expect(bundle.systemMessage).not.toContain('【网络搜索结果】');
		expect(bundle.searchResults).toEqual([]);
	});

	it('skipContext 消息不进入发送消息数组，也不触发世界信息', () => {
		const conversation: ChatMessageView[] = [
			{
				id: 'help',
				role: 'system',
				content: '可用 RP 快捷命令：/goto 地点 /wear 槽位=衣物',
				timestamp: 0,
				skipContext: true
			},
			{ id: '1', role: 'user', content: '我们去图书馆吧', timestamp: 1 }
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: [
				{
					id: 'w-help',
					keys: ['RP 快捷命令'],
					content: '不应触发',
					enabled: true,
					priority: 100
				},
				{
					id: 'w-lib',
					keys: ['图书馆'],
					content: '图书馆是校园传说发生地。',
					enabled: true,
					priority: 100
				}
			]
		});
		expect(bundle.messages.map((m) => m.role)).toEqual(['user']);
		expect(bundle.messages[0]!.content).toBe('我们去图书馆吧');
		expect(bundle.systemMessage).not.toContain('不应触发');
		expect(bundle.systemMessage).toContain('图书馆是校园传说发生地。');
		expect(bundle.history.map((m) => m.id)).toEqual(['1']);
	});

	it('启用状态工具时系统提示注入工具使用说明', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: [],
			enableStateTools: true
		});
		expect(bundle.systemMessage).toContain('【工具使用】');
		expect(bundle.systemMessage).toContain('set_outfit');
	});

	it('未启用状态工具时不注入工具说明', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: []
		});
		expect(bundle.systemMessage).not.toContain('【工具使用】');
	});
});
