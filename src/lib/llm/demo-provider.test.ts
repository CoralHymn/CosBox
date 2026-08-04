import { describe, expect, it } from 'vitest';
import {
	DemoLlmClient,
	buildDemoSummary,
	buildDemoReply,
	buildDemoToolResult,
	extractLine,
	extractSearchTitle
} from './demo-provider';
import { STATE_TOOLS } from './state-tools';
import { DEFAULT_LLM_CONFIG, type ChatMessage, type StateToolSchema } from './types';

const systemMessage =
	'【当前状态】\n时间：周一 08:00（正在「晨会」）\n地点：学院正门（樱花道尽头）\n穿着：白色衬衫、深蓝百褶裙\n属性：name:绫音';

function messages(userContent: string): ChatMessage[] {
	return [
		{ role: 'system', content: systemMessage },
		{ role: 'user', content: userContent }
	];
}

describe('extractLine', () => {
	it('提取标签行内容', () => {
		expect(extractLine(systemMessage, '时间：')).toBe('周一 08:00（正在「晨会」）');
		expect(extractLine(systemMessage, '穿着：')).toBe('白色衬衫、深蓝百褶裙');
	});

	it('未找到或内容为空返回 null', () => {
		expect(extractLine(systemMessage, '不存在：')).toBeNull();
		expect(extractLine('【x】\n时间：   ', '时间：')).toBeNull();
	});
});

describe('extractSearchTitle', () => {
	it('提取搜索结果块中第一条 - 标题', () => {
		const system =
			'【网络搜索结果】\n- 樱花学园官网：学园简介（https://example.com）\n- 另一个结果：内容';
		expect(extractSearchTitle(system)).toBe('樱花学园官网');
	});

	it('无搜索块或无条目返回 null', () => {
		expect(extractSearchTitle('【当前状态】\n时间：周一')).toBeNull();
		expect(extractSearchTitle('【网络搜索结果】\n（无结果）')).toBeNull();
	});

	it('标题为空时返回 null', () => {
		expect(extractSearchTitle('【网络搜索结果】\n- ：只有冒号')).toBeNull();
	});
});

describe('buildDemoReply', () => {
	it('时间问题返回当前时间', () => {
		expect(buildDemoReply(messages('现在几点了？'))).toContain('周一 08:00');
	});

	it('地点问题返回当前地点', () => {
		expect(buildDemoReply(messages('你在哪里？'))).toContain('学院正门');
	});

	it('穿着问题返回当前穿着', () => {
		expect(buildDemoReply(messages('你今天穿什么？'))).toContain('白色衬衫');
	});

	it('系统消息含搜索结果时返回搜索回应', () => {
		const reply = buildDemoReply([
			{ role: 'system', content: '【网络搜索结果】\n- 樱花学园官网：简介' },
			{ role: 'user', content: '帮我查一下' }
		]);
		expect(reply).toContain('樱花学园官网');
	});

	it('状态行缺失时回退占位文案', () => {
		expect(
			buildDemoReply([
				{ role: 'system', content: '【当前状态】' },
				{ role: 'user', content: '现在几点了？' }
			])
		).toContain('现在');
		expect(
			buildDemoReply([
				{ role: 'system', content: '【当前状态】' },
				{ role: 'user', content: '你在哪里？' }
			])
		).toContain('老地方');
		expect(
			buildDemoReply([
				{ role: 'system', content: '【当前状态】' },
				{ role: 'user', content: '今天穿什么？' }
			])
		).toContain('平时那套');
	});

	it('默认回应引用用户输入并截断', () => {
		const reply = buildDemoReply(messages('x'.repeat(40)));
		expect(reply).toContain('演示模式回应');
		expect(reply).toContain('…');
	});

	it('无用户消息与空系统消息时仍安全', () => {
		expect(buildDemoReply([])).toContain('演示模式回应');
		expect(buildDemoReply([{ role: 'system', content: '' }])).toContain('演示模式回应');
	});
});

describe('DemoLlmClient', () => {
	it('chat 返回演示回应', async () => {
		const client = new DemoLlmClient();
		const result = await client.chat(messages('你好'), DEFAULT_LLM_CONFIG);
		expect(result.content).toContain('演示模式回应');
		expect(result.toolCalls).toEqual([]);
		expect(result.usage).toBeDefined();
		expect(result.usage!.promptTokens).toBeGreaterThan(0);
	});

	it('已中止的 signal 拒绝请求', async () => {
		const client = new DemoLlmClient();
		const controller = new AbortController();
		controller.abort();
		await expect(
			client.chat(messages('hi'), DEFAULT_LLM_CONFIG, controller.signal)
		).rejects.toThrow();
	});

	it('运行中中止 signal 也会拒绝请求', async () => {
		const client = new DemoLlmClient();
		const controller = new AbortController();
		const pending = client.chat(messages('hi'), DEFAULT_LLM_CONFIG, controller.signal);
		setTimeout(() => controller.abort(), 10);
		await expect(pending).rejects.toThrow();
	});

	it('未中止的 signal 正常完成并清理监听', async () => {
		const client = new DemoLlmClient();
		const controller = new AbortController();
		const result = await client.chat(messages('hi'), DEFAULT_LLM_CONFIG, controller.signal);
		expect(result.content).toContain('演示模式回应');
	});

	it('chatWithTools：用户想去食堂时返回 goto_location 工具调用', async () => {
		const client = new DemoLlmClient();
		const result = await client.chatWithTools(
			messages('我们去食堂吧'),
			STATE_TOOLS,
			DEFAULT_LLM_CONFIG
		);
		expect(result.content).toBeNull();
		expect(result.toolCalls).toEqual([
			{ id: 'call_demo_goto', name: 'goto_location', arguments: { name: '食堂' } }
		]);
	});

	it('chatWithTools：换装/时间关键词返回对应工具', async () => {
		const client = new DemoLlmClient();
		const outfit = await client.chatWithTools(
			messages('换上运动服'),
			STATE_TOOLS,
			DEFAULT_LLM_CONFIG
		);
		expect(outfit.toolCalls[0]!.name).toBe('set_outfit');
		const time = await client.chatWithTools(
			messages('半小时后见'),
			STATE_TOOLS,
			DEFAULT_LLM_CONFIG
		);
		expect(time.toolCalls[0]!.name).toBe('advance_time');
	});

	it('chatWithTools：工具不在列表中时不触发，回退为普通演示回复', async () => {
		const result = await buildDemoToolResult(messages('我们去食堂吧'), []);
		expect(result.toolCalls).toEqual([]);
		expect(result.content).toContain('演示模式回应');
	});

	it('chatWithTools：收到工具结果后返回确定性的收尾文本', async () => {
		const result = await buildDemoToolResult(
			[
				{ role: 'system', content: systemMessage },
				{ role: 'user', content: '我们去食堂吧' },
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'c1', name: 'goto_location', arguments: { name: '食堂' } }]
				},
				{
					role: 'tool',
					content: '已切换地点到「学校 > 食堂」',
					toolCallId: 'c1',
					name: 'goto_location'
				}
			],
			STATE_TOOLS
		);
		expect(result.toolCalls).toEqual([]);
		expect(result.content).toContain('过去吧');
	});

	it('chatWithTools：不同工具结果对应不同收尾文本', async () => {
		const cases: Array<[string, string]> = [
			['时间推进到 周一 09:00', '时间过得真快'],
			['已把上衣更换为「黑色卫衣」', '这套很适合'],
			['未知工具：fly', '我知道了']
		];
		for (const [output, expected] of cases) {
			const result = await buildDemoToolResult(
				[{ role: 'tool', content: output, toolCallId: 'c', name: 't' }],
				STATE_TOOLS
			);
			expect(result.content).toContain(expected);
			expect(result.toolCalls).toEqual([]);
		}
	});

	it('chatWithTools：未命中的工具列表与普通关键词返回纯文本', async () => {
		const tools: StateToolSchema[] = [
			{ name: 'x', description: 'x', parameters: { type: 'object', properties: {}, required: [] } }
		];
		const result = await buildDemoToolResult(messages('随便聊聊'), tools);
		expect(result.toolCalls).toEqual([]);
		expect(result.content).toContain('演示模式回应');
	});
});

describe('buildDemoSummary / summarize', () => {
	it('统计条数并引用最近用户消息', () => {
		const request: ChatMessage[] = [
			{ role: 'system', content: '摘要提示' },
			{
				role: 'user',
				content: '[user] 你好\n[assistant] 你好呀\n[user] 我们去食堂吧'
			}
		];
		const summary = buildDemoSummary(request);
		expect(summary).toContain('已将早前 3 条消息总结');
		expect(summary).toContain('我们去食堂吧');
	});

	it('无用户行时返回占位', () => {
		expect(buildDemoSummary([{ role: 'user', content: '[assistant] 只有回复' }])).toContain(
			'继续角色扮演即可'
		);
	});

	it('DemoLlmClient.summarize 返回摘要与用量', async () => {
		const client = new DemoLlmClient();
		const result = await client.summarize(
			[{ role: 'user', content: '[user] hi' }],
			DEFAULT_LLM_CONFIG
		);
		expect(result.summary).toContain('演示摘要');
		expect(result.usage).toBeDefined();
		expect(result.usage!.promptTokens).toBeGreaterThan(0);
	});

	it('询问「在想什么」时返回演示思考内容', async () => {
		const result = await buildDemoToolResult(messages('你现在在想什么？'), []);
		expect(result.thinking).toContain('（演示）让我先想想');
		expect(result.thinking).toContain('你现在在想什么');
	});

	it('普通消息不返回思考内容', async () => {
		const result = await buildDemoToolResult(messages('早上好'), []);
		expect(result.thinking).toBeUndefined();
	});
});
