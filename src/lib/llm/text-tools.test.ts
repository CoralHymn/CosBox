import { describe, expect, it } from 'vitest';
import { extractTextToolCalls } from './text-tools';

describe('extractTextToolCalls', () => {
	it('解析 advance_time(120) 位置参数', () => {
		expect(extractTextToolCalls('先调用 advance_time(120)')).toEqual([
			{ id: 'text_call_0', name: 'advance_time', arguments: { minutes: 120 } }
		]);
	});

	it('解析带键名与中文冒号的参数', () => {
		expect(extractTextToolCalls('advance_time(minutes：90)')).toEqual([
			{ id: 'text_call_0', name: 'advance_time', arguments: { minutes: 90 } }
		]);
	});

	it('解析 JSON 参数', () => {
		expect(extractTextToolCalls('advance_time({"minutes": 30})')).toEqual([
			{ id: 'text_call_0', name: 'advance_time', arguments: { minutes: 30 } }
		]);
	});

	it('解析 goto_location 位置参数与中文引号', () => {
		expect(extractTextToolCalls('goto_location(「食堂」)')).toEqual([
			{ id: 'text_call_0', name: 'goto_location', arguments: { name: '食堂' } }
		]);
	});

	it('解析 set_outfit 键值对', () => {
		expect(extractTextToolCalls('set_outfit(slot="top", item="白色衬衫")')).toEqual([
			{ id: 'text_call_0', name: 'set_outfit', arguments: { slot: 'top', item: '白色衬衫' } }
		]);
	});

	it('解析 set_attribute 键值对', () => {
		expect(extractTextToolCalls('set_attribute(key=mood, value=开心)')).toEqual([
			{ id: 'text_call_0', name: 'set_attribute', arguments: { key: 'mood', value: '开心' } }
		]);
	});

	it('缺参数或非调用语法时不解析', () => {
		expect(extractTextToolCalls('advance_time()')).toEqual([]);
		expect(extractTextToolCalls('我想推进时间，但没想好几分钟')).toEqual([]);
		expect(extractTextToolCalls('set_outfit(上衣, 白色衬衫)')).toEqual([]);
	});

	it('普通角色扮演文本不误判', () => {
		expect(extractTextToolCalls('（她看了看表，喃喃自语）时间过得真快啊。')).toEqual([]);
	});
});
