import { describe, expect, it } from 'vitest';
import { CosBoxDatabase, getDb } from './schema';

describe('schema', () => {
	it('可以创建独立数据库实例', () => {
		const db = new CosBoxDatabase(`test-schema-${Math.random().toString(36).slice(2)}`);
		expect(db.snapshots).toBeDefined();
		expect(db.worldInfo).toBeDefined();
		expect(db.kv).toBeDefined();
		return db.close();
	});

	it('getDb 返回共享单例', () => {
		const first = getDb();
		expect(getDb()).toBe(first);
		return first.close();
	});
});
