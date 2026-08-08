import { describe, expect, it } from 'vitest';
import { extractTextToolCalls, stripTextToolCalls } from './text-tools';

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

	it('工具名后换行再接括号正文时不误判为调用', () => {
		expect(extractTextToolCalls('我应该调用 goto_location\n（温柔地笑了笑）我们走吧。')).toEqual(
			[]
		);
	});

	it('解析正文里的纯文本 JSON 工具调用（{"tool","args"}）', () => {
		expect(extractTextToolCalls('{"tool":"advance_time","args":{"minutes":30}}')).toEqual([
			{ id: 'text_call_0', name: 'advance_time', arguments: { minutes: 30 } }
		]);
	});

	it('解析纯文本 JSON 的 {"name","arguments"} 形态', () => {
		expect(
			extractTextToolCalls('{"name":"set_outfit","arguments":{"slot":"top","item":"白色衬衫"}}')
		).toEqual([
			{
				id: 'text_call_0',
				name: 'set_outfit',
				arguments: { slot: 'top', item: '白色衬衫' }
			}
		]);
	});

	it('解析 OpenAI 风格 {"function":{"name","arguments"}}（arguments 为 JSON 字符串）', () => {
		expect(
			extractTextToolCalls(
				'{"function":{"name":"goto_location","arguments":"{\\"name\\":\\"食堂\\"}"}}'
			)
		).toEqual([{ id: 'text_call_0', name: 'goto_location', arguments: { name: '食堂' } }]);
	});

	it('JSON 对象缺 args 或工具名非法时不解析', () => {
		expect(extractTextToolCalls('{"tool":"advance_time"}')).toEqual([]);
		expect(extractTextToolCalls('{"tool":"fly_to_moon","args":{"x":1}}')).toEqual([]);
		expect(extractTextToolCalls('（她打开地图看了看）{我们出发吧}')).toEqual([]);
	});
});

describe('stripTextToolCalls', () => {
	it('剔除「工具名(参数)」调用语法并保留其余正文', () => {
		expect(stripTextToolCalls('好的。goto_location(name=食堂) 这就出发。')).toBe(
			'好的。 这就出发。'
		);
	});

	it('剔除 JSON 形态的工具调用，保留普通花括号文本', () => {
		expect(
			stripTextToolCalls('{"tool":"advance_time","args":{"minutes":30}}\n（她笑了笑）{出发咯}')
		).toBe('（她笑了笑）{出发咯}');
	});

	it('无法解析为调用的语法不剔除', () => {
		expect(stripTextToolCalls('她轻声说：goto_location 是什么呢？')).toBe(
			'她轻声说：goto_location 是什么呢？'
		);
	});
});
