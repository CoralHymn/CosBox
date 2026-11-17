import { describe, expect, it } from 'vitest';
import { DemoLlmClient } from '../llm/demo-provider';
import { STATE_TOOLS } from '../llm/state-tools';
import { DEFAULT_LLM_CONFIG } from '../llm/types';
import { DEMO_CHIPS, demoChipDone } from './demo';

describe('演示剧本', () => {
	it('七个动作与离线模型的分支一一对应', async () => {
		const client = new DemoLlmClient();
		const system = [
			'【当前状态】',
			'时间：周五 18:40',
			'地点：学校 > 社团活动室',
			'穿着：帽子：未穿；上衣：白色衬衫；下装：深灰长裤；袜子：未穿；鞋：帆布鞋；配饰：未穿',
			'属性：name:林夏，age:21，展板状态:未完成',
			'【世界书】三天后是校庆，入口装置今晚要立起来'
		].join('\n');
		const calls: string[] = [];
		for (const chip of DEMO_CHIPS) {
			const result = await client.chatWithTools(
				[
					{ role: 'system', content: system },
					{ role: 'user', content: chip.text }
				],
				STATE_TOOLS,
				DEFAULT_LLM_CONFIG
			);
			calls.push(result.toolCalls[0]?.name ?? 'none');
		}
		expect(calls).toEqual([
			'none',
			'goto_location',
			'set_outfit',
			'advance_time',
			'goto_location',
			'set_attribute',
			'set_attribute'
		]);
	});

	it('进度只认脚本原句，自由输入不会误推进', () => {
		const conversation = [
			{ role: 'assistant', content: '开场' },
			{ role: 'user', content: DEMO_CHIPS[0]!.text },
			{ role: 'user', content: '随便说点什么' },
			{ role: 'user', content: DEMO_CHIPS[2]!.text }
		];
		expect(demoChipDone(conversation)).toEqual([true, false, true, false, false, false, false]);
	});

	it('全部完成时每一步都为 true', () => {
		const conversation = DEMO_CHIPS.map((chip) => ({ role: 'user', content: chip.text }));
		expect(demoChipDone(conversation)).toEqual([true, true, true, true, true, true, true]);
	});
});
