import { describe, expect, it } from 'vitest';
import { getCreditGroups, OPEN_SOURCE_CREDITS } from './credits';

describe('开源协议声明数据', () => {
	it('至少包含直接依赖、参考项目与非开源参考三个分组', () => {
		const groups = getCreditGroups();
		expect(groups.map((group) => group.label)).toEqual([
			'直接依赖',
			'参考 / 调研的开源项目',
			'非开源设计参考'
		]);
		for (const group of groups) {
			expect(group.items.length).toBeGreaterThan(0);
		}
	});

	it('每条记录字段完整且链接为合法 http(s) 地址', () => {
		for (const item of OPEN_SOURCE_CREDITS) {
			expect(item.name.trim()).not.toBe('');
			expect(item.license.trim()).not.toBe('');
			expect(item.usage.trim()).not.toBe('');
			expect(item.url).toMatch(/^https?:\/\//);
		}
	});

	it('项目名称在声明中不重复', () => {
		const names = OPEN_SOURCE_CREDITS.map((item) => item.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
