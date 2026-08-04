import { describe, expect, it } from 'vitest';
import type { ChatMessage, TokenUsage } from './types';
import {
	estimateCost,
	estimateMessageTokens,
	estimateMessagesTokens,
	estimateTokens,
	findModelInfo,
	resolveContextWindow,
	sumUsage
} from './model-info';

describe('estimateTokens', () => {
	it('空文本为 0', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('CJK 字符 1 字符 1 token', () => {
		expect(estimateTokens('你好世界')).toBe(4);
	});

	it('英文按 4 字符 1 token 取整', () => {
		expect(estimateTokens('hello')).toBe(2);
	});

	it('极短非 CJK 文本至少 1 token', () => {
		expect(estimateTokens('a')).toBe(1);
	});

	it('混合文本按字符分别计', () => {
		expect(estimateTokens('你好abc')).toBe(3);
	});
});

describe('estimateMessageTokens / estimateMessagesTokens', () => {
	it('包含角色开销', () => {
		expect(estimateMessageTokens({ role: 'user', content: '你好' })).toBe(6);
	});

	it('包含工具调用开销', () => {
		const message: ChatMessage = {
			role: 'assistant',
			content: '',
			toolCalls: [{ id: 'c1', name: 'goto_location', arguments: {} }]
		};
		expect(estimateMessageTokens(message)).toBe(12);
	});

	it('汇总多条消息', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: '你是绫音' },
			{ role: 'user', content: '你好' }
		];
		expect(estimateMessagesTokens(messages)).toBe(
			estimateMessageTokens(messages[0]!) + estimateMessageTokens(messages[1]!)
		);
	});

	it('空数组为 0', () => {
		expect(estimateMessagesTokens([])).toBe(0);
	});
});

describe('sumUsage', () => {
	it('逐项相加', () => {
		const first: TokenUsage = { promptTokens: 10, completionTokens: 5, cachedTokens: 2 };
		const second: TokenUsage = { promptTokens: 3, completionTokens: 7, cachedTokens: 1 };
		expect(sumUsage(first, second)).toEqual({
			promptTokens: 13,
			completionTokens: 12,
			cachedTokens: 3
		});
	});
});

describe('findModelInfo', () => {
	it('精确匹配（忽略大小写与空白）', () => {
		expect(findModelInfo('  GPT-5.6-TERRA  ')?.pricing.input).toBe(2.5);
	});

	it('最长前缀匹配', () => {
		const info = findModelInfo('deepseek-v4-flash-0714');
		expect(info?.contextWindow).toBe(256_000);
	});

	it('包含匹配（如 OpenRouter 的 vendor/model 格式）', () => {
		expect(findModelInfo('openrouter/gpt-5.6-terra')?.pricing.output).toBe(15);
	});

	it('未知模型返回 undefined', () => {
		expect(findModelInfo('totally-unknown-model')).toBeUndefined();
	});

	it('空字符串返回 undefined', () => {
		expect(findModelInfo('   ')).toBeUndefined();
	});
});

describe('estimateCost', () => {
	it('未知模型返回 null', () => {
		expect(
			estimateCost({ promptTokens: 10, completionTokens: 0, cachedTokens: 0 }, undefined)
		).toBeNull();
	});

	it('按输入/输出价计算', () => {
		const info = findModelInfo('gpt-5.6-terra')!;
		const cost = estimateCost(
			{ promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 },
			info
		);
		expect(cost).toBe(17.5);
	});

	it('缓存 token 使用缓存价', () => {
		const info = findModelInfo('gpt-5.6-terra')!;
		const cost = estimateCost(
			{ promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 1_000_000 },
			info
		);
		expect(cost).toBe(0.25);
	});

	it('缓存价未知时按输入价计', () => {
		const info = findModelInfo('kimi-k3')!;
		const cost = estimateCost(
			{ promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 1_000_000 },
			info
		);
		expect(cost).toBe(3);
	});

	it('缓存 token 超过 prompt 时截断', () => {
		const info = findModelInfo('gpt-5.6-terra')!;
		const cost = estimateCost(
			{ promptTokens: 100_000, completionTokens: 0, cachedTokens: 1_000_000 },
			info
		);
		expect(cost).toBe(0.025);
	});

	it('小用量保留 6 位小数', () => {
		const info = findModelInfo('gpt-5.6-terra')!;
		const cost = estimateCost({ promptTokens: 10, completionTokens: 0, cachedTokens: 0 }, info);
		expect(cost).toBe(0.000025);
	});
});

describe('resolveContextWindow', () => {
	it('配置值优先', () => {
		expect(resolveContextWindow(65_536, 'unknown-model')).toBe(65_536);
	});

	it('配置缺失时查目录', () => {
		expect(resolveContextWindow(undefined, 'deepseek-v4-pro')).toBe(256_000);
	});

	it('配置为 0 时回退目录', () => {
		expect(resolveContextWindow(0, 'deepseek-v4-pro')).toBe(256_000);
	});

	it('配置为 null 时回退目录', () => {
		expect(resolveContextWindow(null, 'deepseek-v4-pro')).toBe(256_000);
	});

	it('均未知返回 null', () => {
		expect(resolveContextWindow(undefined, 'unknown-model')).toBeNull();
	});
});
