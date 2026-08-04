import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import type { ClothingItem, LocationDef } from '../core/types';
import { buildAutocompleteSuggestions } from './autocomplete';

const initial = createInitialState();

describe('buildAutocompleteSuggestions', () => {
	it('非斜杠或空输入返回空列表', () => {
		expect(buildAutocompleteSuggestions('', initial.places, initial.outfit.wardrobe)).toEqual([]);
		expect(buildAutocompleteSuggestions('早上好', initial.places, initial.outfit.wardrobe)).toEqual(
			[]
		);
	});

	it('输入 / 显示全部命令，输入片段时过滤', () => {
		const all = buildAutocompleteSuggestions('/', initial.places, initial.outfit.wardrobe);
		expect(all.map((s) => s.label)).toEqual([
			'/goto 地点',
			'/wear 槽位=衣物',
			'/time 分钟',
			'/checkpoint 描述',
			'/help'
		]);
		expect(buildAutocompleteSuggestions('/go', initial.places, initial.outfit.wardrobe).map((s) => s.label)).toEqual([
			'/goto 地点'
		]);
	});

	it('输入完整命令词时不重复建议自身（/help 不再弹出）', () => {
		expect(buildAutocompleteSuggestions('/help', initial.places, initial.outfit.wardrobe)).toEqual(
			[]
		);
		expect(buildAutocompleteSuggestions('/goto', initial.places, initial.outfit.wardrobe).map((s) => s.label)).toEqual([
			'/goto 地点'
		]);
	});

	it('/goto 补地点：全部、按名称过滤、按分类过滤', () => {
		const all = buildAutocompleteSuggestions('/goto ', initial.places, initial.outfit.wardrobe);
		expect(all.length).toBe(initial.places.length);
		expect(all[0]!.label).toBe('学校 > 学院正门');
		const byName = buildAutocompleteSuggestions('/goto 食', initial.places, initial.outfit.wardrobe);
		expect(byName.map((s) => s.label)).toEqual(['学校 > 食堂']);
		expect(byName[0]!.detail).toContain('热闹');
		const byCategory = buildAutocompleteSuggestions(
			'/goto 游泳',
			initial.places,
			initial.outfit.wardrobe
		);
		expect(byCategory.map((s) => s.label)).toEqual(['学校 > 游泳馆']);
	});

	it('/goto 未分类地点只显示名称', () => {
		const places: LocationDef[] = [
			{ id: 'x', category: '', name: '海边', description: '浪很大' }
		];
		const result = buildAutocompleteSuggestions('/goto ', places, []);
		expect(result.map((s) => s.label)).toEqual(['海边']);
		expect(result[0]!.insert).toBe('海边');
	});

	it('/wear 先补槽位，支持片段过滤', () => {
		const slots = buildAutocompleteSuggestions('/wear ', initial.places, initial.outfit.wardrobe);
		expect(slots.map((s) => s.label)).toEqual([
			'帽子=',
			'上衣=',
			'内衣=',
			'内裤=',
			'下装=',
			'袜子=',
			'鞋='
		]);
		expect(slots[1]!.detail).toBe('top');
		const filtered = buildAutocompleteSuggestions('/wear 上', initial.places, initial.outfit.wardrobe);
		expect(filtered.map((s) => s.label)).toEqual(['上衣=']);
	});

	it('/wear 槽位= 补衣柜衣物（按类型过滤），并附「无（脱掉）」', () => {
		const tops = buildAutocompleteSuggestions('/wear 上衣=', initial.places, initial.outfit.wardrobe);
		expect(tops.map((s) => s.label)).toEqual(['无（脱掉）', '白色衬衫', '黑色卫衣']);
		expect(tops[1]!.insert).toBe('上衣=白色衬衫');
		expect(tops[0]!.insert).toBe('上衣=无');
		const filtered = buildAutocompleteSuggestions(
			'/wear 上衣=黑',
			initial.places,
			initial.outfit.wardrobe
		);
		expect(filtered.map((s) => s.label)).toEqual(['无（脱掉）', '黑色卫衣']);
		expect(filtered[1]!.insert).toBe('上衣=黑色卫衣');
		const socks = buildAutocompleteSuggestions('/wear 袜子=', initial.places, initial.outfit.wardrobe);
		expect(socks.map((s) => s.label)).toEqual(['无（脱掉）', '白色过膝袜']);
		expect(socks[0]!.insert).toBe('袜子=无');
	});

	it('/wear 支持多件输入时补全后续槽位', () => {
		const result = buildAutocompleteSuggestions(
			'/wear 上衣=黑色卫衣 袜',
			initial.places,
			initial.outfit.wardrobe
		);
		expect(result.map((s) => s.label)).toEqual(['袜子=']);
	});

	it('/wear 未知槽位不弹衣物建议', () => {
		expect(
			buildAutocompleteSuggestions('/wear 翅膀=', initial.places, initial.outfit.wardrobe)
		).toEqual([]);
	});

	it('/time 补快捷时长并按输入过滤', () => {
		expect(buildAutocompleteSuggestions('/time ', initial.places, initial.outfit.wardrobe).map((s) => s.label)).toEqual([
			'+30 分钟',
			'+60 分钟',
			'+120 分钟',
			'-15 分钟'
		]);
		expect(buildAutocompleteSuggestions('/time +1', initial.places, initial.outfit.wardrobe).map((s) => s.label)).toEqual([
			'+120 分钟'
		]);
	});

	it('/checkpoint 与未知命令不弹建议', () => {
		expect(
			buildAutocompleteSuggestions('/checkpoint ', initial.places, initial.outfit.wardrobe)
		).toEqual([]);
		expect(buildAutocompleteSuggestions('/fly ', initial.places, initial.outfit.wardrobe)).toEqual(
			[]
		);
	});

	it('衣柜条目 kind 缺省或 any 时任意槽位可用', () => {
		const wardrobe: ClothingItem[] = [
			{ id: 'a', category: '', name: '万用披风', description: '啥都能穿', kind: 'any' },
			{ id: 'b', category: '', name: '老式围巾', description: '未标注' }
		];
		const result = buildAutocompleteSuggestions('/wear 上衣=', initial.places, wardrobe);
		expect(result.map((s) => s.label)).toEqual(['无（脱掉）', '万用披风', '老式围巾']);
		const headwear = buildAutocompleteSuggestions('/wear 帽子=', initial.places, wardrobe);
		expect(headwear.map((s) => s.label)).toEqual(['无（脱掉）', '万用披风', '老式围巾']);
	});
});
