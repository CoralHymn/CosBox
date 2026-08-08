# CosBox

面向 AI 角色扮演的状态驱动叙事客户端。核心是「结构化角色状态」，而不是聊天软件：

- **状态是第一公民**：穿着（含帽子/内衣/内裤/袜子）/ 衣柜 / 当前地点 / 地点库 / 日程 / 属性都是结构化数据，不是消息附件。
- **LLM 精确感知状态**：Context Pipeline 把当前状态摘要、世界信息命中与（压缩后的）对话组装进系统提示。
- **内置类 Git 版本控制**：所有状态变更与对话都以增量快照存入 IndexedDB，支持任意点回溯与分支，无需外部 Git。

## 技术栈

- TypeScript（strict，零 `any`）
- SvelteKit（纯客户端渲染，SSR/Prerender 关闭）
- Svelte 5 Runes（`$state` / `$derived` / `$effect`）
- Dexie.js（IndexedDB）
- nanoid
- OpenAI-compatible API（内置离线 demo provider，可用 LiteLLM Proxy 等任意兼容端点）
- Vitest + Playwright

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

默认使用内置演示 LLM（离线可用，回应由状态摘要推导）。在「设置」页可直接选择主流服务商预设——
OpenAI、Anthropic Claude、Google Gemini、DeepSeek、Kimi、通义千问、智谱 GLM、GLM Coding Plan、
百度千帆、腾讯混元、零一万物、MiniMax、SiliconFlow、Mistral、xAI Grok、Groq、Cerebras、
OpenRouter、OpenCode GO、OpenCode Zen、Together AI、Ollama、LiteLLM Proxy、vLLM、Azure OpenAI——
自动填充兼容端点与常用模型候选；也可以选「自定义」填任意 OpenAI-compatible 端点。
OpenCode GO/Zen 的 API 不支持浏览器 CORS（OPTIONS 预检直接 404，直连会 `Failed to fetch`），
预设默认走 `/llm-proxy` 相对路径，由 `vite.config.ts` 的开发/预览代理转发到 opencode.ai；
`npm run dev` / `npm run preview` 下开箱即用，静态部署需自建同路径反向代理。
此外支持 Tavily / Serper / Brave 网络搜索，发送消息时可把实时结果注入 LLM 上下文。

## 脚本

| 命令                        | 说明                                          |
| --------------------------- | --------------------------------------------- |
| `npm run dev`               | 开发服务器                                    |
| `npm run build` / `preview` | 构建 / 预览产物                               |
| `npm run check`             | svelte-check 类型与诊断                       |
| `npm run lint` / `format`   | ESLint / Prettier                             |
| `npm test`                  | Vitest 单元测试                               |
| `npm run test:coverage`     | 单元测试 + 覆盖率（核心层 100% 语句/行/函数） |
| `npm run test:e2e`          | Playwright 端到端测试                         |

## 功能（P0–P5）

- P0 对话界面 + Snapshot 集成：每条消息都是版本图节点
- P1 角色状态编辑器 + 实时预览 + 自动 snapshot
- P1+ 地点库与衣柜：地点/衣物支持大类并可按分类折叠收纳（如「学校 > 食堂」「常服 > 白色衬衫」）；
  衣物带类型标签，换装槽位只从匹配类型的衣柜中挑选（不会把内裤套头上）；AI 知道全部地点与可选衣物（含穿后描述）
- P2 地图（地点字段）+ World Info + Context Pipeline 接 LLM
- P3 版本可视化 UI + checkout + 分支
- P4 课程 / 日程 + 时间推进
- P5 SillyTavern V3 角色卡导入导出

## 目录结构

```text
src/lib/
  core/          状态模型、快照版本图、错误体系（纯函数）
  db/            Dexie schema 与仓储（snapshots / worldInfo / kv）
  manager/       CharacterManager：状态变更唯一入口
  context/       World Info 触发、状态摘要、历史压缩、Context Pipeline
  llm/           OpenAI-compatible 客户端与离线 demo provider
  import-export/ chara_card_v3 映射
  stores/        Svelte 5 runes 响应式封装
  components/    UI 组件（显式 props，禁止 rest 透传）
```

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [DECISIONS.md](./DECISIONS.md)。
