import { truncate } from '../utils/format';
import { estimateMessagesTokens, estimateTokens } from './model-info';
import type {
	ChatMessage,
	LlmChatResult,
	LlmClient,
	LlmConfig,
	LlmSummaryResult,
	StateToolSchema,
	ToolCall,
	TokenUsage
} from './types';

/**
 * 内置离线演示 LLM：无需网络即可体验完整链路。
 * 回应由系统消息中的状态摘要推导，保证确定性（e2e 可断言）。
 */
export class DemoLlmClient implements LlmClient {
	/** 模拟 250ms 延迟后返回演示回应（含估算用量）；支持 AbortSignal 取消。 */
	async chat(
		messages: ChatMessage[],
		_config: LlmConfig,
		signal?: AbortSignal,
		_onDelta?: (delta: string) => void,
		_options?: { jsonMode?: boolean }
	): Promise<LlmChatResult> {
		await delay(250, signal);
		void _onDelta;
		void _options;
		const content = buildDemoReply(messages);
		return {
			content,
			toolCalls: [],
			usage: demoUsage(messages, content),
			thinking: demoThinking(messages)
		};
	}

	/** 演示摘要：确定性文本，保证离线与 e2e 可断言。 */
	async summarize(
		request: ChatMessage[],
		_config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmSummaryResult> {
		await delay(250, signal);
		const summary = buildDemoSummary(request);
		return {
			summary,
			usage: {
				promptTokens: estimateMessagesTokens(request),
				completionTokens: estimateTokens(summary),
				cachedTokens: 0
			}
		};
	}

	/**
	 * 演示工具模式：根据用户输入关键词返回确定性的工具调用，
	 * 收到工具结果后返回一句确定性的收尾文本。工具必须在传入列表中，否则忽略。
	 */
	async chatWithTools(
		messages: ChatMessage[],
		tools: readonly StateToolSchema[],
		_config: LlmConfig,
		signal?: AbortSignal,
		_onDelta?: (delta: string) => void,
		_options?: { forceToolCall?: boolean; jsonMode?: boolean }
	): Promise<LlmChatResult> {
		await delay(250, signal);
		void _onDelta;
		void _options;
		return buildDemoToolResult(messages, tools);
	}
}

/** 生成演示工具模式的结果：先看工具结果，再看用户输入的触发词。 */
export function buildDemoToolResult(
	messages: ChatMessage[],
	tools: readonly StateToolSchema[]
): LlmChatResult {
	// AI 生成（地点/衣柜/日程）的确定性演示路径。
	const generation = buildDemoGenerationResult(messages, tools);
	if (generation !== null) {
		return generation;
	}
	const thinking = demoThinking(messages);
	const last = messages[messages.length - 1];
	if (last?.role === 'tool') {
		const content = buildDemoToolReply(last.content);
		return { content, toolCalls: [], usage: demoUsage(messages, content), thinking };
	}
	const text = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
	const toolCalls = pickDemoToolCall(text, tools);
	if (toolCalls.length > 0) {
		return { content: null, toolCalls, usage: demoUsage(messages, null), thinking };
	}
	const content = buildDemoReply(messages);
	return { content, toolCalls: [], usage: demoUsage(messages, content), thinking };
}

/** 从系统提示中识别生成任务类型；非生成任务返回 null。 */
export function detectGenerationKind(system: string): 'locations' | 'wardrobe' | 'schedule' | null {
	if (system.includes('【生成任务：地点库】')) {
		return 'locations';
	}
	if (system.includes('【生成任务：衣柜】')) {
		return 'wardrobe';
	}
	if (system.includes('【生成任务：日程表】')) {
		return 'schedule';
	}
	return null;
}

/** 演示生成流程：先返回 review_generation 工具调用，收到审查结果后输出最终 JSON。 */
function buildDemoGenerationResult(
	messages: ChatMessage[],
	tools: readonly StateToolSchema[]
): LlmChatResult | null {
	if (!tools.some((tool) => tool.name === 'review_generation')) {
		return null;
	}
	const system = messages.find((message) => message.role === 'system')?.content ?? '';
	const kind = detectGenerationKind(system);
	if (kind === null) {
		return null;
	}
	const items = demoGeneratedItems(kind, system);
	const last = messages[messages.length - 1];
	if (last?.role === 'tool') {
		const content = JSON.stringify(items);
		return { content, toolCalls: [], usage: demoUsage(messages, content), thinking: undefined };
	}
	return {
		content: null,
		toolCalls: [{ id: 'call_gen_review', name: 'review_generation', arguments: { items } }],
		usage: demoUsage(messages, null),
		thinking: undefined
	};
}

/** 按世界观与性别生成确定性的演示条目（无 id，由宿主补全）。 */
export function demoGeneratedItems(
	kind: 'locations' | 'wardrobe' | 'schedule',
	system: string
): Array<Record<string, unknown>> {
	if (kind === 'locations') {
		if (system.includes('【世界观：古代】')) {
			return [
				{ category: '书院', name: '讲堂', description: '先生授课的大厅，桌椅整齐排列' },
				{ category: '书院', name: '藏书阁', description: '收藏典籍的三层木楼，午后有斜阳洒进窗棂' },
				{ category: '集市', name: '药铺', description: '挂着杏林旗的药材铺子，药香扑鼻' },
				{ category: '集市', name: '茶肆', description: '支着布幌的街边茶铺，常有说书人讲古' },
				{ category: '城郊', name: '驿站', description: '官道边的换马之所，往来旅人歇脚' },
				{ category: '城郊', name: '马厩', description: '拴着几匹枣红马，草料味很重' }
			];
		}
		if (system.includes('【世界观：奇幻】')) {
			return [
				{ category: '魔法学院', name: '炼金室', description: '坩埚咕嘟作响，架子上摆满药剂瓶' },
				{ category: '魔法学院', name: '大讲堂', description: '穹顶绘着星图的授课大厅' },
				{ category: '冒险者公会', name: '任务板', description: '贴着悬赏委托的木板，人来人往' },
				{ category: '精灵森林', name: '树屋', description: '建在巨树枝干上的木屋，藤蔓缠绕' },
				{
					category: '精灵森林',
					name: '古树祭坛',
					description: '缠绕着发光符文的老树，是森林的圣地'
				}
			];
		}
		return [
			{ category: '学校', name: '食堂', description: '午间最热闹的地方，招牌是咖喱饭' },
			{ category: '学校', name: '图书馆', description: '安静的阅读空间，三楼据说有禁书区' },
			{
				category: '商业街',
				name: '中央商店街',
				description: '贯穿城区的主干商业街，两侧林立着潮流服饰店与奶茶店'
			},
			{
				category: '商业街',
				name: '云朵咖啡屋',
				description: '充满文艺气息的独立咖啡厅，招牌是手冲咖啡和芝士蛋糕'
			},
			{
				category: '市中心',
				name: '星辰购物广场',
				description: '十层高的综合购物中心，顶层设有电影院和美食街'
			},
			{
				category: '市中心',
				name: '城市历史博物馆',
				description: '展示城市百年变迁的展馆，设有互动体验区'
			},
			{
				category: '郊外',
				name: '银沙海滨浴场',
				description: '城郊海岸线的白色沙滩，夏季开放游泳与水上活动'
			},
			{
				category: '郊外',
				name: '汤之里温泉馆',
				description: '传统日式风格温泉旅馆，露天汤池可远眺山景'
			}
		];
	}
	if (kind === 'wardrobe') {
		const genderMatch = system.match(/角色性别：([^，\n]+)/);
		const gender = genderMatch?.[1]?.trim() ?? '女';
		if (gender.includes('男')) {
			return [
				{ category: '常服', kind: 'top', name: '白衬衫', description: '白色棉质衬衫，袖口整齐' },
				{ category: '常服', kind: 'bottom', name: '西裤', description: '深灰色直筒西裤，垂感很好' },
				{ category: '鞋', kind: 'shoes', name: '皮鞋', description: '黑色系带皮鞋，擦得发亮' }
			];
		}
		return [
			{
				category: '常服',
				kind: 'top',
				name: '白色连衣裙',
				description: '白色碎花连衣裙，及膝，裙摆很轻'
			},
			{
				category: '常服',
				kind: 'bottom',
				name: '百褶裙',
				description: '深蓝色百褶裙，走动时轻轻摆动'
			},
			{ category: '鞋', kind: 'shoes', name: '浅口单鞋', description: '米色浅口单鞋，鞋面带蝴蝶结' }
		];
	}
	return [
		{ day: 0, title: '武术课', start: '08:00', end: '09:30' },
		{ day: 0, title: '茶道课', start: '10:00', end: '11:00' },
		{ day: 1, title: '图书馆自习', start: '15:00', end: '16:30' },
		{ day: 2, title: '社团会议', start: '17:00', end: '18:00' }
	];
}

/** 演示思考：仅当用户询问「在想什么/思考」时返回确定性内容，便于 e2e 断言。 */
function demoThinking(messages: ChatMessage[]): string | undefined {
	const lastUser = [...messages].reverse().find((message) => message.role === 'user');
	const text = lastUser?.content ?? '';
	if (/思考|在想什么|怎么想|考虑/.test(text)) {
		return `（演示）让我先想想：对方刚说「${truncate(text, 24)}」，我应该结合当前状态回应。`;
	}
	return undefined;
}

/** 生成确定性的演示用量：prompt 按消息估算，completion 按输出文本估算。 */
function demoUsage(messages: ChatMessage[], content: string | null): TokenUsage {
	return {
		promptTokens: estimateMessagesTokens(messages),
		completionTokens: content === null ? 0 : estimateTokens(content),
		cachedTokens: 0
	};
}

/**
 * 生成确定性的演示摘要：统计请求里序列化的消息条数，并引用最近的用户消息。
 * 只用于离线演示，真实端点的摘要由模型生成。
 */
export function buildDemoSummary(messages: ChatMessage[]): string {
	const userContent =
		[...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
	const counted = userContent.match(/\[(user|assistant|system)\]/g)?.length ?? 0;
	const lastUserLine = [...userContent.split('\n')]
		.reverse()
		.find((line) => line.startsWith('[user] '));
	const tail =
		lastUserLine === undefined
			? '继续角色扮演即可'
			: `最近提到「${truncate(lastUserLine.replace('[user] ', ''), 24)}」`;
	return `（演示摘要）已将早前 ${counted} 条消息总结，${tail}。`;
}

/** 根据用户文本选择确定性的演示工具调用（仅当该工具在列表中）。 */
function pickDemoToolCall(text: string, tools: readonly StateToolSchema[]): ToolCall[] {
	if (/去食堂|食堂/.test(text) && tools.some((tool) => tool.name === 'goto_location')) {
		return [{ id: 'call_demo_goto', name: 'goto_location', arguments: { name: '食堂' } }];
	}
	if (/运动服|换装/.test(text) && tools.some((tool) => tool.name === 'set_outfit')) {
		return [
			{ id: 'call_demo_outfit', name: 'set_outfit', arguments: { slot: 'top', item: '黑色卫衣' } }
		];
	}
	if (/半小时后|时间推进/.test(text) && tools.some((tool) => tool.name === 'advance_time')) {
		return [{ id: 'call_demo_time', name: 'advance_time', arguments: { minutes: 30 } }];
	}
	return [];
}

/** 根据工具结果生成确定性的演示收尾文本。 */
function buildDemoToolReply(output: string): string {
	if (output.includes('已切换地点')) {
		return '（演示模式回应）好，那我们过去吧。';
	}
	if (output.includes('时间推进')) {
		return '（演示模式回应）时间过得真快。';
	}
	if (output.includes('更换为')) {
		return '（演示模式回应）嗯，这套很适合现在。';
	}
	return '（演示模式回应）好的，我知道了。';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		if (signal) {
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});
}

/** 从系统消息中提取以 label 开头的行内容。 */
export function extractLine(systemMessage: string, label: string): string | null {
	for (const line of systemMessage.split('\n')) {
		if (line.startsWith(label)) {
			return line.slice(label.length).trim() || null;
		}
	}
	return null;
}

/**
 * 生成确定性演示回应。
 * 依据最后一条用户消息的关键词与系统消息中的状态摘要，返回不同话术。
 */
export function buildDemoReply(messages: ChatMessage[]): string {
	const system = messages.find((message) => message.role === 'system')?.content ?? '';
	const lastUser = [...messages].reverse().find((message) => message.role === 'user');
	const text = lastUser?.content ?? '';

	if (system.includes('【网络搜索结果】')) {
		const title = extractSearchTitle(system);
		return `（演示模式回应）我查了一下网上的资料：${title ?? '相关内容'}。要我展开讲讲吗？`;
	}
	if (/时间|几点|什么时候|几点了/.test(text)) {
		const time = extractLine(system, '时间：') ?? '现在';
		return `（演示模式回应）现在${time}。你要来找我吗？`;
	}
	if (/哪里|在哪|位置|地点/.test(text)) {
		const location = extractLine(system, '地点：') ?? '老地方';
		return `（演示模式回应）我正在${location}，过来找我吧。`;
	}
	if (/穿|衣服|服装|打扮/.test(text)) {
		const outfit = extractLine(system, '穿着：') ?? '平时那套';
		return `（演示模式回应）我今天穿着${outfit}。好看吗？`;
	}
	return `（演示模式回应）嗯，我在听。你说「${truncate(text, 24)}」——接着说吧。`;
}

/** 从系统消息中提取第一条网络搜索结果的标题。 */
export function extractSearchTitle(systemMessage: string): string | null {
	const lines = systemMessage.split('\n');
	const markerIndex = lines.findIndex((line) => line === '【网络搜索结果】');
	if (markerIndex === -1) {
		return null;
	}
	for (let i = markerIndex + 1; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (line.startsWith('- ')) {
			const title = line.slice(2).split('：')[0]!.trim();
			return title === '' ? null : title;
		}
	}
	return null;
}
