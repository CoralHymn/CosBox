/**
 * 开源协议声明数据。
 *
 * 本文件集中维护 CosBox 直接依赖、参考/调研过的开源项目，以及少量
 * 仅作为设计参考的闭源产品，供「设置 > 开源协议声明」展示。
 * 许可证信息以各项目官方仓库 / npm 元数据为准（2026-08 核对）。
 */

/** 条目分类：直接依赖 / 开源参考 / 非开源设计参考。 */
export type CreditCategory = 'dependency' | 'reference' | 'non-oss';

/** 开源协议声明单条记录。 */
export interface OpenSourceCredit {
	/** 项目或库的名称。 */
	name: string;
	/** 上游许可证名称或 SPDX 标识。 */
	license: string;
	/** 官方主页或仓库地址。 */
	url: string;
	/** 在本项目中的用途或参考点。 */
	usage: string;
	/** 所属分类。 */
	category: CreditCategory;
}

/** 按分类分组的标签。 */
export interface CreditGroup {
	/** 分组显示名。 */
	label: string;
	/** 组内条目。 */
	items: OpenSourceCredit[];
}

/** 全部开源协议声明条目。 */
export const OPEN_SOURCE_CREDITS: readonly OpenSourceCredit[] = [
	// ---------- 直接依赖 ----------
	{
		name: 'Svelte',
		license: 'MIT',
		url: 'https://svelte.dev',
		usage: 'UI 框架（Svelte 5 Runes）',
		category: 'dependency'
	},
	{
		name: 'SvelteKit',
		license: 'MIT',
		url: 'https://kit.svelte.dev',
		usage: '应用框架（纯客户端渲染）',
		category: 'dependency'
	},
	{
		name: '@sveltejs/adapter-static',
		license: 'MIT',
		url: 'https://kit.svelte.dev/docs/adapters#static',
		usage: '静态站点适配器（禁用 SSR）',
		category: 'dependency'
	},
	{
		name: 'Dexie.js',
		license: 'Apache-2.0',
		url: 'https://dexie.org',
		usage: 'IndexedDB 封装（快照 / 世界书 / KV 存储）',
		category: 'dependency'
	},
	{
		name: 'nanoid',
		license: 'MIT',
		url: 'https://github.com/ai/nanoid',
		usage: '快照与消息 ID 生成',
		category: 'dependency'
	},
	{
		name: 'Vite',
		license: 'MIT',
		url: 'https://vitejs.dev',
		usage: '开发服务器与构建工具（含内置软件通道的 /llm-proxy 动态转发中间件）',
		category: 'dependency'
	},
	{
		name: 'Vitest',
		license: 'MIT',
		url: 'https://vitest.dev',
		usage: '单元测试框架',
		category: 'dependency'
	},
	{
		name: 'Playwright',
		license: 'Apache-2.0',
		url: 'https://playwright.dev',
		usage: '端到端测试',
		category: 'dependency'
	},
	{
		name: 'ESLint',
		license: 'MIT',
		url: 'https://eslint.org',
		usage: '静态检查',
		category: 'dependency'
	},
	{
		name: 'Prettier',
		license: 'MIT',
		url: 'https://prettier.io',
		usage: '代码格式化',
		category: 'dependency'
	},
	{
		name: 'TypeScript',
		license: 'Apache-2.0',
		url: 'https://www.typescriptlang.org',
		usage: '开发语言（strict，零 any）',
		category: 'dependency'
	},
	{
		name: 'fake-indexeddb',
		license: 'Apache-2.0',
		url: 'https://github.com/dumbmatter/fakeIndexedDB',
		usage: '单元测试中的 IndexedDB 模拟',
		category: 'dependency'
	},
	{
		name: 'jsdom',
		license: 'MIT',
		url: 'https://github.com/jsdom/jsdom',
		usage: '单元测试 DOM 环境',
		category: 'dependency'
	},
	// ---------- 参考 / 调研过的开源项目 ----------
	{
		name: 'opencode',
		license: 'MIT',
		url: 'https://github.com/opencode-ai/opencode',
		usage: '工具调用循环、逐轮 system-reminder、上下文压缩与失败重试参考',
		category: 'reference'
	},
	{
		name: 'Chatbox',
		license: 'GPL-3.0',
		url: 'https://github.com/chatboxai/chatbox',
		usage: '消息时间纯 UI 展示、消息编辑、分支切换与上下文压缩参考',
		category: 'reference'
	},
	{
		name: 'SillyTavern',
		license: 'AGPL-3.0',
		url: 'https://github.com/SillyTavern/SillyTavern',
		usage: 'V3 角色卡导入导出规范',
		category: 'reference'
	},
	{
		name: 'LiteLLM',
		license: 'MIT（enterprise/ 目录除外）',
		url: 'https://github.com/BerriAI/litellm',
		usage: 'OpenAI 兼容网关接入参考',
		category: 'reference'
	},
	{
		name: 'Ollama',
		license: 'MIT',
		url: 'https://github.com/ollama/ollama',
		usage: '本地模型端点预设与上下文窗口探测',
		category: 'reference'
	},
	{
		name: 'vLLM',
		license: 'Apache-2.0',
		url: 'https://github.com/vllm-project/vllm',
		usage: '本地推理服务端点预设',
		category: 'reference'
	},
	{
		name: 'mem0',
		license: 'Apache-2.0',
		url: 'https://github.com/mem0ai/mem0',
		usage: '长期记忆提取 / 检索 / 合并模式参考',
		category: 'reference'
	},
	{
		name: 'Letta / MemGPT',
		license: 'Apache-2.0',
		url: 'https://github.com/letta-ai/letta',
		usage: '分层记忆（核心常驻 + 归档按需查询）参考',
		category: 'reference'
	},
	{
		name: 'LangMem',
		license: 'MIT',
		url: 'https://github.com/langchain-ai/langmem',
		usage: '记忆提取防抖批处理（ReflectionExecutor）参考',
		category: 'reference'
	},
	{
		name: 'Zep',
		license: 'Apache-2.0',
		url: 'https://github.com/getzep/zep',
		usage: '记忆注入边界与全量历史成本警告参考',
		category: 'reference'
	},
	{
		name: 'OpenAI Agents SDK',
		license: 'MIT',
		url: 'https://github.com/openai/openai-agents-python',
		usage: 'Agent 框架工具调用机制调研',
		category: 'reference'
	},
	{
		name: 'AG2',
		license: 'Apache-2.0',
		url: 'https://github.com/ag2ai/ag2',
		usage: 'Agent 框架工具调用机制调研',
		category: 'reference'
	},
	{
		name: 'Hermes Agent',
		license: 'MIT',
		url: 'https://github.com/NousResearch/hermes-agent',
		usage: 'Agent 框架工具调用机制调研',
		category: 'reference'
	},
	{
		name: 'LibreFang',
		license: 'MIT',
		url: 'https://github.com/librefang/librefang',
		usage: 'Agent 框架工具调用机制调研',
		category: 'reference'
	},
	{
		name: 'LangChain',
		license: 'MIT',
		url: 'https://github.com/langchain-ai/langchain',
		usage: '工具调用失败后重新调用模式参考',
		category: 'reference'
	},
	{
		name: 'OmniRoute',
		license: 'MIT',
		url: 'https://github.com/diegosouzapw/OmniRoute',
		usage: '工具调用失败处理与上下文压缩思路调研',
		category: 'reference'
	},
	{
		name: 'opencode-mem',
		license: '未标注（调研参考）',
		url: 'https://github.com/tickernelz/opencode-mem',
		usage: 'SQLite + 向量检索的 Agent 记忆插件调研',
		category: 'reference'
	},
	{
		name: 'awesome-design-md',
		license: 'MIT',
		url: 'https://github.com/VoltAgent/awesome-design-md',
		usage: '内置主题预设（Claude / Discord / The Verge）的设计分析参考',
		category: 'reference'
	},
	// ---------- 非开源设计参考 ----------
	{
		name: 'Claude Code',
		license: '闭源',
		url: 'https://www.anthropic.com/claude-code',
		usage: 'MEMORY.md 索引、过程文本展示等交互模式参考',
		category: 'non-oss'
	},
	{
		name: '宝塔面板（BT Panel）',
		license: '闭源',
		url: 'https://www.bt.cn',
		usage: '服务器一键安装脚本的交互方式参考',
		category: 'non-oss'
	}
];

/**
 * 按分类把声明条目分组，供设置页按顺序渲染。
 */
export function getCreditGroups(): CreditGroup[] {
	const groupOf = (category: CreditCategory, label: string): CreditGroup => ({
		label,
		items: OPEN_SOURCE_CREDITS.filter((item) => item.category === category)
	});
	return [
		groupOf('dependency', '直接依赖'),
		groupOf('reference', '参考 / 调研的开源项目'),
		groupOf('non-oss', '非开源设计参考')
	];
}
