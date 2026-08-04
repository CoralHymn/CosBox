import { describe, expect, it } from 'vitest';
import {
	CosBoxError,
	ImportError,
	LlmError,
	SearchError,
	SnapshotError,
	StateValidationError,
	StorageError,
	toUserMessage
} from './errors';

describe('错误体系', () => {
	it('CosBoxError 带稳定 code 与正确的 name', () => {
		const err = new SnapshotError('坏了');
		expect(err).toBeInstanceOf(CosBoxError);
		expect(err.name).toBe('SnapshotError');
		expect(err.code).toBe('SNAPSHOT');
	});

	it('各子类 code 正确', () => {
		expect(new StateValidationError('x').code).toBe('STATE_INVALID');
		expect(new StorageError('x').code).toBe('STORAGE');
		expect(new LlmError('x', 500).code).toBe('LLM');
		expect(new LlmError('x', 500).status).toBe(500);
		expect(new LlmError('x').status).toBeUndefined();
		expect(new SearchError('x').code).toBe('SEARCH');
		expect(new ImportError('x').code).toBe('IMPORT');
		expect(new CosBoxError('x').code).toBe('COSBOX_ERROR');
	});

	it('toUserMessage 返回可读文案且不泄露堆栈', () => {
		expect(toUserMessage(new SnapshotError('快照不存在'))).toBe('快照不存在');
		expect(toUserMessage(new Error('普通错误'))).toBe('普通错误');
		expect(toUserMessage('字符串错误')).toBe('发生未知错误，请重试');
		expect(toUserMessage(null)).toBe('发生未知错误，请重试');
	});
});
