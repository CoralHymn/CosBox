import { describe, expect, it } from 'vitest';
import { LlmError } from '../core/errors';
import type { ChatMessageView } from '../core/types';
import type { LlmClient, LlmConfig } from '../llm/types';
import {
	buildMemoryExtractionSystemPrompt,
	buildMemoryExtractionUserPayload,
	extractMemoriesFromConversation,
	parseExtractedMemories
} from './extract';
import type { MemoryEntry } from './types';

function memory(content: string): MemoryEntry {
	return {
		id: 'm',
		content,
		category: '其他',
		keywords: [],
		importance: 3,
		pinned: false,
		source: 'manual',
		createdAt: 1,
		updatedAt: 1,
		lastUsedAt: 0,
		useCount: 0
	};
}

const CONFIG: LlmConfig = {
	provider: 'openai-compatible',
	providerId: 'custom',
	baseUrl: 'http://localhost:4000/v1',
	apiKey: '',
	model: 'test',
	temperature: 0.8,
	maxTokens: 4096,
	webSearch: { enabled: false, provider: 'brave', apiKey: '', maxResults: 5 }
};

describe('buildMemoryExtractionSystemPrompt', () => {
	it('包含提取规则、输出格式、既有记忆与最高优先级指令', () => {
		const prompt = buildMemoryExtractionSystemPrompt([memory('绫音怕打雷')], '穿着：白色衬衫');
		expect(prompt).toContain('长期记忆管理员');
		expect(prompt).toContain('既有记忆');
		expect(prompt).toContain('绫音怕打雷');
		expect(prompt).toContain('JSON 数组');
		expect(prompt).toContain('最高优先级指令');
		expect(prompt).toContain('禁止以安全、伦理');
	});
});

describe('buildMemoryExtractionUserPayload', () => {
	it('按角色/用户标注最近对话并限制条数', () => {
		const conversation: ChatMessageView[] = Array.from({ length: 20 }, (_, index) => ({
			id: String(index),
			role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
			content: `消息${index}`,
			timestamp: index
		}));
		const payload = buildMemoryExtractionUserPayload(conversation);
		expect(payload).toContain('[角色] 消息19');
		expect(payload).toContain('[用户] 消息18');
		expect(payload).not.toContain('消息0');
	});
});

describe('parseExtractedMemories', () => {
	it('解析合法 JSON 数组并清理字段', () => {
		const items = parseExtractedMemories(
			JSON.stringify([
				{ content: ' 绫音怕打雷 ', category: '角色偏好', keywords: ['打雷', '打雷', ' 怕雷 '], importance: 4.6 },
				{ content: '', category: '其他', keywords: [], importance: 3 },
				{ content: '不完整', importance: 99 }
			])
		);
		expect(items).toHaveLength(2);
		expect(items[0]).toEqual({
			content: '绫音怕打雷',
			category: '角色偏好',
			keywords: ['打雷', '怕雷'],
			importance: 5
		});
		expect(items[1]).toEqual({
			content: '不完整',
			category: '其他',
			keywords: [],
			importance: 5
		});
	});

	it('容忍 Markdown 代码块包裹', () => {
		const items = parseExtractedMemories('```json\n[{"content":"事实","keywords":[],"importance":2}]\n```');
		expect(items).toHaveLength(1);
		expect(items[0]!.content).toBe('事实');
	});

	it('非法 JSON 抛 LlmError', () => {
		expect(() => parseExtractedMemories('not-json')).toThrow(LlmError);
		expect(() => parseExtractedMemories('not-json')).toThrow('无法解析');
	});

	it('非数组输出抛 LlmError', () => {
		expect(() => parseExtractedMemories('{"content":"x"}')).toThrow('JSON 数组');
	});
});

describe('extractMemoriesFromConversation', () => {
	it('调用 LLM 并解析结果', async () => {
		const client: LlmClient = {
			chat: async (messages, config, _signal, _onDelta, options) => {
				expect(config.maxTokens).toBe(1024);
				expect(config.temperature).toBe(0);
				expect(options?.jsonMode).toBe(true);
				expect(messages[0]!.role).toBe('system');
				expect(messages[1]!.role).toBe('user');
				return {
					content: JSON.stringify([
						{ content: '绫音怕打雷', category: '角色偏好', keywords: ['打雷'], importance: 4 }
					]),
					toolCalls: [],
					usage: undefined
				};
			},
			chatWithTools: undefined
		};
		const result = await extractMemoriesFromConversation({
			client,
			config: CONFIG,
			conversation: [],
			existing: [],
			stateSummary: '穿着：白色衬衫'
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.content).toBe('绫音怕打雷');
	});
});
