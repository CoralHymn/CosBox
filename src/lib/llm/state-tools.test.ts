import { describe, expect, it, vi } from 'vitest';
import { applyStateDelta, addMinutes, createInitialState } from '../core/state';
import type { StatePatch } from '../core/types';
import {
	STATE_TOOLS,
	advanceTimeTool,
	executeStateTool,
	gotoLocationTool,
	setAttributeTool,
	setOutfitTool,
	type StateToolContext
} from './state-tools';
import type { ToolCall } from './types';

function makeContext(initial = createInitialState()): StateToolContext {
	let state = initial;
	return {
		getState: () => state,
		update: vi.fn(async (patch: StatePatch) => {
			state = applyStateDelta(state, patch);
		}),
		advanceTime: vi.fn(async (minutes: number) => {
			state = {
				...state,
				schedule: { ...state.schedule, time: addMinutes(state.schedule.time, minutes) }
			};
		})
	};
}

function call(name: string, args: Record<string, unknown>): ToolCall {
	return { id: 'call-1', name, arguments: args };
}

describe('gotoLocationTool', () => {
	it('locationId 匹配地点库时切换并返回分类标签', async () => {
		const ctx = makeContext();
		const output = await gotoLocationTool.execute(
			call('goto_location', { locationId: 'cafeteria' }).arguments,
			ctx
		);
		expect(output).toContain('学校 > 食堂');
		expect(ctx.getState().location.name).toBe('食堂');
		expect(ctx.update).toHaveBeenCalledWith(
			expect.objectContaining({ location: expect.objectContaining({ name: '食堂' }) }),
			{ desc: expect.stringContaining('食堂') }
		);
	});

	it('没有 locationId 时用 name 创建自定义地点', async () => {
		const ctx = makeContext();
		const output = await gotoLocationTool.execute(
			call('goto_location', { name: '校门口小吃摊', category: '校外', description: '炸串很香' })
				.arguments,
			ctx
		);
		expect(output).toContain('校外 > 校门口小吃摊');
		expect(ctx.getState().location).toEqual({
			id: '校门口小吃摊',
			category: '校外',
			name: '校门口小吃摊',
			description: '炸串很香'
		});
	});

	it('name 匹配地点库时使用库内完整数据（分类/描述）', async () => {
		const ctx = makeContext();
		const output = await gotoLocationTool.execute(
			call('goto_location', { name: '食堂' }).arguments,
			ctx
		);
		expect(output).toContain('学校 > 食堂');
		expect(ctx.getState().location.id).toBe('cafeteria');
		expect(ctx.getState().location.category).toBe('学校');
		expect(ctx.getState().location.description).toContain('热闹');
	});

	it('缺少 name 与 locationId 时抛错', async () => {
		const ctx = makeContext();
		await expect(
			gotoLocationTool.execute(call('goto_location', {}).arguments, ctx)
		).rejects.toThrow('需要 locationId 或 name');
	});
});

describe('advanceTimeTool', () => {
	it('推进分钟并返回新时间文本', async () => {
		const ctx = makeContext();
		const output = await advanceTimeTool.execute(
			call('advance_time', { minutes: 30 }).arguments,
			ctx
		);
		expect(output).toContain('周一 08:30');
		expect(ctx.getState().schedule.time.minute).toBe(30);
	});

	it('非法分钟数抛错', async () => {
		const ctx = makeContext();
		await expect(
			advanceTimeTool.execute(call('advance_time', { minutes: 'x' }).arguments, ctx)
		).rejects.toThrow('需要有效的 minutes');
	});
});

describe('setOutfitTool', () => {
	it('衣柜中的衣物按槽位穿上', async () => {
		const ctx = makeContext();
		const output = await setOutfitTool.execute(
			call('set_outfit', { slot: 'top', item: '黑色卫衣' }).arguments,
			ctx
		);
		expect(output).toContain('上衣');
		expect(ctx.getState().outfit.top).toBe('黑色卫衣');
	});

	it('item 为 null 时脱掉该槽位', async () => {
		const ctx = makeContext();
		await setOutfitTool.execute(call('set_outfit', { slot: 'socks', item: null }).arguments, ctx);
		expect(ctx.getState().outfit.socks).toBeNull();
	});

	it('衣柜中不存在的衣物抛错', async () => {
		const ctx = makeContext();
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'top', item: '脑补披风' }).arguments, ctx)
		).rejects.toThrow('衣柜中没有');
	});

	it('未知槽位抛错', async () => {
		const ctx = makeContext();
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'wings', item: '黑色卫衣' }).arguments, ctx)
		).rejects.toThrow('未知槽位');
	});

	it('item 类型非法抛错', async () => {
		const ctx = makeContext();
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'top', item: 42 }).arguments, ctx)
		).rejects.toThrow('item 必须是衣物名称或 null');
	});

	it('接受中文槽位别名（如「上衣」）', async () => {
		const ctx = makeContext();
		await setOutfitTool.execute(
			call('set_outfit', { slot: '上衣', item: '黑色卫衣' }).arguments,
			ctx
		);
		expect(ctx.getState().outfit.top).toBe('黑色卫衣');
	});

	it('item 为「无/脱/null/NONE」时脱掉该槽位', async () => {
		for (const value of ['无', '脱', 'null', 'NONE']) {
			const ctx = makeContext();
			await setOutfitTool.execute(call('set_outfit', { slot: 'top', item: value }).arguments, ctx);
			expect(ctx.getState().outfit.top).toBeNull();
		}
	});

	it('衣柜名称唯一子串匹配时自动补全为精确名', async () => {
		const ctx = makeContext();
		await setOutfitTool.execute(call('set_outfit', { slot: 'top', item: '衬衫' }).arguments, ctx);
		expect(ctx.getState().outfit.top).toBe('白色衬衫');
	});

	it('模糊匹配有歧义时给出候选衣物', async () => {
		const ctx = makeContext();
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'top', item: '白色' }).arguments, ctx)
		).rejects.toThrow('歧义');
		expect(ctx.getState().outfit.top).toBe('白色衬衫');
	});

	it('衣柜中不存在时错误信息列出该槽位可选衣物', async () => {
		const ctx = makeContext();
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'top', item: '脑补披风' }).arguments, ctx)
		).rejects.toThrow('可选的上衣：');
		await expect(
			setOutfitTool.execute(call('set_outfit', { slot: 'top', item: '脑补披风' }).arguments, ctx)
		).rejects.toThrow('白色衬衫');
	});
});

describe('setAttributeTool', () => {
	it('字符串数字自动转为 number', async () => {
		const ctx = makeContext();
		await setAttributeTool.execute(
			call('set_attribute', { key: 'money', value: '999' }).arguments,
			ctx
		);
		expect(ctx.getState().attributes.money).toBe(999);
	});

	it('布尔字符串自动转换', async () => {
		const ctx = makeContext();
		await setAttributeTool.execute(
			call('set_attribute', { key: 'awake', value: 'true' }).arguments,
			ctx
		);
		expect(ctx.getState().attributes.awake).toBe(true);
		await setAttributeTool.execute(
			call('set_attribute', { key: 'sleepy', value: 'false' }).arguments,
			ctx
		);
		expect(ctx.getState().attributes.sleepy).toBe(false);
	});

	it('原始数字与字符串原样保留', async () => {
		const ctx = makeContext();
		await setAttributeTool.execute(
			call('set_attribute', { key: 'mood', value: '开心' }).arguments,
			ctx
		);
		expect(ctx.getState().attributes.mood).toBe('开心');
		await setAttributeTool.execute(call('set_attribute', { key: 'age', value: 18 }).arguments, ctx);
		expect(ctx.getState().attributes.age).toBe(18);
	});

	it('空 key 或非法 value 抛错', async () => {
		const ctx = makeContext();
		await expect(
			setAttributeTool.execute(call('set_attribute', { key: ' ', value: 'x' }).arguments, ctx)
		).rejects.toThrow('非空 key');
		await expect(
			setAttributeTool.execute(call('set_attribute', { key: 'x', value: undefined }).arguments, ctx)
		).rejects.toThrow('value 必须是');
	});
});

describe('STATE_TOOLS / executeStateTool', () => {
	it('注册了四个状态工具且 schema 齐全', () => {
		expect(STATE_TOOLS.map((tool) => tool.name)).toEqual([
			'goto_location',
			'advance_time',
			'set_outfit',
			'set_attribute'
		]);
		for (const tool of STATE_TOOLS) {
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.parameters.type).toBe('object');
		}
	});

	it('执行成功返回结果文本', async () => {
		const ctx = makeContext();
		const result = await executeStateTool(
			STATE_TOOLS,
			call('goto_location', { name: '图书馆' }),
			ctx
		);
		expect(result.name).toBe('goto_location');
		expect(result.output).toContain('图书馆');
		expect(ctx.getState().location.name).toBe('图书馆');
	});

	it('未知工具返回错误文本', async () => {
		const result = await executeStateTool(STATE_TOOLS, call('fly', {}), makeContext());
		expect(result.output).toBe('未知工具：fly');
	});

	it('工具抛错被捕获为「工具执行失败」文本', async () => {
		const result = await executeStateTool(
			STATE_TOOLS,
			call('set_outfit', { slot: 'top', item: '不存在的衣服' }),
			makeContext()
		);
		expect(result.output).toContain('工具执行失败：');
		expect(result.output).toContain('衣柜中没有');
	});
});
