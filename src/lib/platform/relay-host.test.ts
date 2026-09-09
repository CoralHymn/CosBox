import { describe, expect, it } from 'vitest';
import { isRelayHost, isRelayPath, parseRelayTarget, RELAY_PREFIX } from './relay-host';

describe('RELAY_PREFIX / isRelayPath', () => {
	it('只认通道前缀开头的路径', () => {
		expect(RELAY_PREFIX).toBe('/llm-proxy/');
		expect(isRelayPath('/llm-proxy/opencode.ai/zen/v1/models')).toBe(true);
		expect(isRelayPath('/api/health')).toBe(false);
	});
});

describe('isRelayHost', () => {
	it('接受裸主机名、IP 与可选端口', () => {
		for (const host of ['opencode.ai', '127.0.0.1:8787', 'localhost:4000', 'a-b.example.com']) {
			expect(isRelayHost(host)).toBe(true);
		}
	});

	it('拒绝不含点也不含冒号的段（未迁移的老式前缀把这里当成了路径）', () => {
		expect(isRelayHost('')).toBe(false);
		expect(isRelayHost('zen')).toBe(false);
	});

	it('拒绝凭据、空标签、首尾连字符等畸形值', () => {
		for (const host of ['evil.com@real.com', 'a..b', '-bad.com', 'bad-.com', 'a.com:port']) {
			expect(isRelayHost(host)).toBe(false);
		}
	});
});

describe('parseRelayTarget', () => {
	it('把前缀还原成 https 目标，端口与查询串一并保留', () => {
		expect(parseRelayTarget('/llm-proxy/opencode.ai/zen/go/v1/models')).toBe(
			'https://opencode.ai/zen/go/v1/models'
		);
		expect(parseRelayTarget('/llm-proxy/127.0.0.1:8787/v1/chat/completions?a=1')).toBe(
			'https://127.0.0.1:8787/v1/chat/completions?a=1'
		);
		expect(parseRelayTarget('/llm-proxy/opencode.ai')).toBe('https://opencode.ai');
	});

	it('非前缀与畸形 host 返回 null，交给调用方决定怎么兜底', () => {
		expect(parseRelayTarget('/llm-proxy/zen/go/v1/models')).toBeNull();
		expect(parseRelayTarget('https://api.openai.com/v1/models')).toBeNull();
	});
});
