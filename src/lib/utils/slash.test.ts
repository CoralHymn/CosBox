import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import type { CharacterState } from '../core/types';
import { applySlashCommand, parseSlashCommand } from './slash';

const initial = createInitialState();

describe('parseSlashCommand', () => {
	it('非斜杠输入返回 null', () => {
		expect(parseSlashCommand('早上好')).toBeNull();
		expect(parseSlashCommand('')).toBeNull();
	});

	it('解析 /goto /time /checkpoint /help', () => {
		expect(parseSlashCommand('/goto 食堂')).toEqual({ kind: 'goto', query: '食堂' });
		expect(parseSlashCommand('/time +30')).toEqual({ kind: 'time', minutes: 30 });
		expect(parseSlashCommand('/time -15')).toEqual({ kind: 'time', minutes: -15 });
		expect(parseSlashCommand('/time 30分钟')).toEqual({ kind: 'time', minutes: 30 });
		expect(parseSlashCommand('/time abc')).toEqual({ kind: 'time', minutes: Number.NaN });
		expect(parseSlashCommand('/checkpoint 值得回退')).toEqual({
			kind: 'checkpoint',
			desc: '值得回退'
		});
		expect(parseSlashCommand('/help')).toEqual({ kind: 'help' });
	});

	it('解析 /wear 的裸衣物名与 槽位=衣物 形态', () => {
		expect(parseSlashCommand('/wear 黑色卫衣')).toEqual({
			kind: 'wear',
			assignments: [{ item: '黑色卫衣', raw: '黑色卫衣' }]
		});
		expect(parseSlashCommand('/wear 上衣=黑色卫衣 袜子=无')).toEqual({
			kind: 'wear',
			assignments: [
				{ slot: 'top', item: '黑色卫衣', raw: '上衣=黑色卫衣' },
				{ slot: 'socks', item: null, raw: '袜子=无' }
			]
		});
	});

	it('未知命令返回 unknown', () => {
		expect(parseSlashCommand('/fly')).toEqual({ kind: 'unknown', name: 'fly' });
	});
});

describe('applySlashCommand', () => {
	it('/goto 按名称匹配地点库', () => {
		const result = applySlashCommand(initial, { kind: 'goto', query: '食堂' });
		expect(result.error).toBeUndefined();
		expect(result.message).toContain('学校 > 食堂');
		expect(result.patch?.location?.id).toBe('cafeteria');
	});

	it('/goto 支持 分类>名称 与唯一分类', () => {
		expect(applySlashCommand(initial, { kind: 'goto', query: '学校 > 食堂' }).patch?.location?.id).toBe(
			'cafeteria'
		);
		const custom: CharacterState = {
			...initial,
			places: [{ id: 'sea', category: '校外', name: '海边', description: '浪很大' }]
		};
		expect(applySlashCommand(custom, { kind: 'goto', query: '校外' }).patch?.location?.name).toBe(
			'海边'
		);
	});

	it('/goto 空查询或找不到时报错', () => {
		expect(applySlashCommand(initial, { kind: 'goto', query: '  ' }).error).toContain('需要地点名称');
		expect(applySlashCommand(initial, { kind: 'goto', query: '月球' }).error).toContain('未找到地点');
	});

	it('/wear 裸衣物名自动推断槽位', () => {
		const result = applySlashCommand(initial, {
			kind: 'wear',
			assignments: [{ item: '黑色卫衣', raw: '黑色卫衣' }]
		});
		expect(result.patch?.outfit?.top).toBe('黑色卫衣');
		expect(result.message).toContain('上衣');
	});

	it('/wear 显式槽位、多件合并、脱掉', () => {
		const result = applySlashCommand(initial, {
			kind: 'wear',
			assignments: [
				{ slot: 'top', item: '白色衬衫', raw: '上衣=白色衬衫' },
				{ slot: 'socks', item: null, raw: '袜子=无' }
			]
		});
		expect(result.patch?.outfit).toEqual({ top: '白色衬衫', socks: null });
		expect(result.message).toContain('袜子 → 无');
	});

	it('/wear 空参数、未知衣物、未知槽位、类型冲突均报错', () => {
		expect(applySlashCommand(initial, { kind: 'wear', assignments: [] }).error).toContain('需要衣物');
		expect(
			applySlashCommand(initial, { kind: 'wear', assignments: [{ item: '脑补披风', raw: '脑补披风' }] })
				.error
		).toContain('衣柜中没有');
		expect(
			applySlashCommand(initial, { kind: 'wear', assignments: [{ item: '黑色卫衣', raw: '翅膀=黑色卫衣' }] })
				.error
		).toContain('未知槽位');
		expect(
			applySlashCommand(initial, {
				kind: 'wear',
				assignments: [{ slot: 'headwear', item: '白色棉质内裤', raw: '帽子=白色棉质内裤' }]
			}).error
		).toContain('不能穿在');
		expect(
			applySlashCommand(initial, { kind: 'wear', assignments: [{ item: '蝴蝶结发带', raw: '蝴蝶结发带' }] })
				.error
		).toContain('无法确定');
		expect(
			applySlashCommand(initial, { kind: 'wear', assignments: [{ item: null, raw: '脱' }] }).error
		).toContain('需要指定槽位');
	});

	it('/wear 显式槽位允许 accessory 类衣物', () => {
		const result = applySlashCommand(initial, {
			kind: 'wear',
			assignments: [{ slot: 'headwear', item: '蝴蝶结发带', raw: '帽子=蝴蝶结发带' }]
		});
		expect(result.patch?.outfit?.headwear).toBe('蝴蝶结发带');
	});

	it('/time 合法分钟数返回推进，非法报错', () => {
		expect(applySlashCommand(initial, { kind: 'time', minutes: 30 }).minutes).toBe(30);
		expect(applySlashCommand(initial, { kind: 'time', minutes: -15 }).message).toContain('回拨');
		expect(applySlashCommand(initial, { kind: 'time', minutes: Number.NaN }).error).toContain(
			'需要分钟数'
		);
	});

	it('/checkpoint 与 /help', () => {
		expect(applySlashCommand(initial, { kind: 'checkpoint', desc: '重要时刻' }).checkpointDesc).toBe(
			'重要时刻'
		);
		const help = applySlashCommand(initial, { kind: 'help' });
		expect(help.helpText).toContain('/goto');
		expect(help.helpText).toContain('/wear');
	});

	it('未知命令报错', () => {
		expect(applySlashCommand(initial, { kind: 'unknown', name: 'fly' }).error).toContain('未知命令 /fly');
	});
});
