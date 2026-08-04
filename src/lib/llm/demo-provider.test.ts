import { describe, expect, it } from 'vitest';
import { DemoLlmClient, buildDemoReply, extractLine } from './demo-provider';
import { DEFAULT_LLM_CONFIG, type ChatMessage } from './types';

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
		const reply = await client.chat(messages('你好'), DEFAULT_LLM_CONFIG);
		expect(reply).toContain('演示模式回应');
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
		const reply = await client.chat(messages('hi'), DEFAULT_LLM_CONFIG, controller.signal);
		expect(reply).toContain('演示模式回应');
	});
});
