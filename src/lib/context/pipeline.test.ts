import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import type { ChatMessageView, WorldInfoEntry } from '../core/types';
import type { MemoryEntry } from '../memory/types';
import {
	buildContext,
	buildPerTurnToolReminder,
	buildToolGuidance,
	defaultSystemPrompt,
	TIME_MARKER_GUIDANCE
} from './pipeline';

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
	it('以强指令语气列出状态工具与触发时机', () => {
		const text = buildToolGuidance();
		expect(text).toContain('【工具使用】');
		expect(text).toContain('必须');
		expect(text).toContain('立即调用');
		expect(text).toContain('不允许只口头描述');
		expect(text).toContain('tool_calls 字段');
		expect(text).toContain('思考过程（reasoning）');
		expect(text).toContain('goto_location');
		expect(text).toContain('set_outfit');
		expect(text).toContain('advance_time');
		expect(text).toContain('set_attribute');
		expect(text).toContain('先发出 tool_calls');
		expect(text).toContain('并行');
		expect(text).toContain('未调用工具 = 状态未同步');
	});
});

describe('buildPerTurnToolReminder', () => {
	it('始终包含通用状态同步提醒', () => {
		const text = buildPerTurnToolReminder(undefined);
		expect(text).toContain('<system-reminder>');
		expect(text).toContain('tool_calls');
		expect(text).toContain('输出正文前');
		expect(text).toContain('不属于剧情内容');
	});

	it('用户发言命中时间流逝时追加 advance_time 针对性提醒', () => {
		const text = buildPerTurnToolReminder('我排了几分钟队，终于拿到饭了');
		expect(text).toContain('advance_time');
		expect(text).toContain('涉及时间流逝');
	});

	it('「时间快进到第二天早上」命中时间提醒', () => {
		const text = buildPerTurnToolReminder('（时间快进到第二天早上）');
		expect(text).toContain('advance_time');
		expect(text).toContain('涉及时间流逝');
	});

	it('「过了一天/第二天」命中时间提醒', () => {
		expect(buildPerTurnToolReminder('过了一天，又是新的一天')).toContain('advance_time');
		expect(buildPerTurnToolReminder('第二天早上')).toContain('advance_time');
	});

	it('用户发言命中地点变化时追加 goto_location 提醒', () => {
		const text = buildPerTurnToolReminder('我们回宿舍吧');
		expect(text).toContain('goto_location');
		expect(text).toContain('涉及地点变化');
	});

	it('「我们到食堂了」命中地点提醒', () => {
		const text = buildPerTurnToolReminder('我们到食堂了');
		expect(text).toContain('goto_location');
		expect(text).toContain('涉及地点变化');
	});

	it('用户发言命中穿着变化时追加 set_outfit 提醒', () => {
		const text = buildPerTurnToolReminder('快把衬衫穿上');
		expect(text).toContain('set_outfit');
		expect(text).toContain('涉及穿着变化');
	});

	it('无命中时只保留通用提醒', () => {
		const text = buildPerTurnToolReminder('今天天气真好');
		expect(text).not.toContain('advance_time');
		expect(text).not.toContain('goto_location');
		expect(text).not.toContain('set_outfit');
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

	it('分段 assistant 消息展开为 思考+正文 / 工具反馈 / 思考+正文 的发送序列', () => {
		const conversation: ChatMessageView[] = [
			{ id: 'u1', role: 'user', content: '好了快穿上吧', timestamp: 1 },
			{
				id: 'a1',
				role: 'assistant',
				content: '（手忙脚乱地扣好扣子）呼——这下不会着凉了。',
				timestamp: 2,
				segments: [
					{ kind: 'thinking', content: '先调用 set_outfit 换装' },
					{ kind: 'text', content: '（愣了一下）我、我马上穿！' },
					{ kind: 'tool', content: '已把上衣更换为「白色衬衫」', toolName: 'set_outfit' },
					{ kind: 'thinking', content: '穿好了，回应一下' },
					{ kind: 'text', content: '（手忙脚乱地扣好扣子）呼——这下不会着凉了。' }
				]
			}
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: []
		});
		const roles = bundle.messages.map((message) => message.role);
		expect(roles).toEqual(['user', 'assistant', 'system', 'assistant']);
		expect(bundle.messages[1]).toMatchObject({
			role: 'assistant',
			content: '（愣了一下）我、我马上穿！',
			reasoning: '先调用 set_outfit 换装'
		});
		expect(bundle.messages[2]).toMatchObject({
			role: 'system',
			content: '【工具调用】set_outfit：已把上衣更换为「白色衬衫」'
		});
		expect(bundle.messages[3]).toMatchObject({
			role: 'assistant',
			content: '（手忙脚乱地扣好扣子）呼——这下不会着凉了。',
			reasoning: '穿好了，回应一下'
		});
	});

	it('交错思考/正文（无工具段）展开为两条 assistant，不覆盖内容', () => {
		const conversation: ChatMessageView[] = [
			{ id: 'u1', role: 'user', content: '然后呢？', timestamp: 1 },
			{
				id: 'a1',
				role: 'assistant',
				content: '第一段正文第二段正文',
				timestamp: 2,
				segments: [
					{ kind: 'thinking', content: '第一段思考' },
					{ kind: 'text', content: '第一段正文' },
					{ kind: 'thinking', content: '第二段思考' },
					{ kind: 'text', content: '第二段正文' }
				]
			}
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: []
		});
		const roles = bundle.messages.map((message) => message.role);
		expect(roles).toEqual(['user', 'assistant', 'assistant']);
		expect(bundle.messages[1]).toMatchObject({
			role: 'assistant',
			content: '第一段正文',
			reasoning: '第一段思考'
		});
		expect(bundle.messages[2]).toMatchObject({
			role: 'assistant',
			content: '第二段正文',
			reasoning: '第二段思考'
		});
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
		// 每轮提醒附在最后一条用户消息（opencode 式），而非系统消息。
		const userMessage = bundle.messages.find((message) => message.role === 'user');
		expect(userMessage?.content).toContain('<system-reminder>');
	});

	it('启用状态工具且用户发言命中状态信号时注入针对性提醒', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: [{ id: '1', role: 'user' as const, content: '我们回宿舍吧', timestamp: 1 }],
			worldInfo: [],
			enableStateTools: true
		});
		expect(bundle.systemMessage).not.toContain('<system-reminder>');
		const userMessage = bundle.messages.find((message) => message.role === 'user');
		expect(userMessage?.content).toContain('<system-reminder>');
		expect(userMessage?.content).toContain('goto_location');
	});

	it('skipContext 的系统消息不参与每轮提醒的用户发言判定', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: [
				{
					id: 'help',
					role: 'system',
					content: '可用 RP 快捷命令：/wear 槽位=衣物',
					timestamp: 0,
					skipContext: true
				},
				{ id: '1', role: 'user' as const, content: '今天天气真好', timestamp: 1 }
			],
			worldInfo: [],
			enableStateTools: true
		});
		const userMessage = bundle.messages.find((message) => message.role === 'user');
		expect(userMessage?.content).toContain('<system-reminder>');
		expect(userMessage?.content).not.toContain('涉及穿着变化');
	});

	it('未启用状态工具时不注入工具说明', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: []
		});
		expect(bundle.systemMessage).not.toContain('【工具使用】');
		expect(bundle.systemMessage).not.toContain('<system-reminder>');
		expect(bundle.messages.find((message) => message.role === 'user')?.content).not.toContain(
			'<system-reminder>'
		);
	});

	it('注入工具执行反馈块', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: [],
			toolFeedback:
				'【工具执行反馈】以下工具已成功调用并立即生效，当前状态已同步更新：\n- set_outfit(slot=上衣, item=白色衬衫) → 已把上衣更换为「白色衬衫」'
		});
		expect(bundle.systemMessage).toContain('【工具执行反馈】');
		expect(bundle.systemMessage).toContain('set_outfit(slot=上衣, item=白色衬衫)');
	});

	it('系统提示注入时间元数据防复述规则', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: []
		});
		expect(bundle.systemMessage).toContain(TIME_MARKER_GUIDANCE);
		expect(bundle.systemMessage).toContain('【世界时间：');
	});

	it('带世界时间的消息正文保持纯净并透传 worldTime', () => {
		const conversation: ChatMessageView[] = [
			{
				id: '1',
				role: 'user',
				content: '好了快穿上吧',
				timestamp: 1,
				worldTime: { day: 0, hour: 9, minute: 0 }
			}
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: []
		});
		expect(bundle.messages[0]!.content).toBe('好了快穿上吧');
		expect(bundle.messages[0]!.worldTime).toEqual({ day: 0, hour: 9, minute: 0 });
	});

	it('assistant 消息的思考原样回传为 reasoning（DeepSeek V4 多轮兼容）', () => {
		const conversation: ChatMessageView[] = [
			{
				id: '1',
				role: 'assistant',
				content: '回答',
				timestamp: 1,
				thinking: '上一轮思考'
			}
		];
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: []
		});
		expect(bundle.messages[0]!.reasoning).toBe('上一轮思考');
	});

	it('工具执行反馈为空时不注入', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: history(),
			worldInfo: [],
			toolFeedback: '   '
		});
		expect(bundle.systemMessage).not.toContain('【工具执行反馈】');
	});

	it('按关键词召回长期记忆并注入【长期记忆】块', () => {
		const conversation = [
			{ id: '1', role: 'user' as const, content: '晚上要打雷了，我有点怕', timestamp: 1 },
			{ id: '2', role: 'assistant' as const, content: '别怕', timestamp: 2 }
		];
		const hit: MemoryEntry = {
			id: 'm1',
			content: '绫音怕打雷，打雷时会躲进主角怀里',
			category: '角色偏好',
			keywords: ['打雷'],
			importance: 4,
			pinned: false,
			source: 'extract',
			createdAt: 1,
			updatedAt: 1,
			lastUsedAt: 0,
			useCount: 0
		};
		const miss: MemoryEntry = {
			...hit,
			id: 'm2',
			content: '绫音喜欢草莓蛋糕',
			keywords: ['草莓']
		};
		const bundle = buildContext({
			state: createInitialState(),
			conversation,
			worldInfo: [],
			memories: [miss, hit],
			memoryLimit: 5
		});
		expect(bundle.systemMessage).toContain('【长期记忆】');
		expect(bundle.systemMessage).toContain('绫音怕打雷');
		expect(bundle.systemMessage).not.toContain('草莓蛋糕');
		expect(bundle.recalledMemories.map((entry) => entry.id)).toEqual(['m1']);
	});

	it('记忆关闭（空数组）时注入块不出现', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: [],
			worldInfo: [],
			memories: []
		});
		expect(bundle.systemMessage).not.toContain('【长期记忆】');
		expect(bundle.recalledMemories).toEqual([]);
	});
});
