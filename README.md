# CosBox

让 Agent 能力真正为「聊天」与互动叙事服务。

CosBox 是一款开箱即用的 AI 角色扮演客户端，也是一个以“状态机”为核心的互动叙事引擎。

普通的 AI 聊天把一切塞进无休止的上下文追加里，时间全靠模型胡诌，地点全凭脑补，换个衣服或者走个神，下文就彻底遗忘；酒馆（SillyTavern）功能虽然丰富，但繁琐的配置和环境部署把绝大多数人拒之门外。

CosBox 的解法是：**把故事看作一个随时间推移演进的状态机。**
时间、地点、人物穿着、甚至环境属性（例如“展板是否倒下”）都是结构化的硬数据，通过模型工具调用（Tool Call）直接驱动前端界面与状态变更。

---

## 核心特性

- **结构化状态机与 Agent 联动**：时间流逝、地点转移、衣橱换装与属性变更全部走标准结构化调用。你输入“我们去食堂”，地点即时更新；输入“换上黑色卫衣”，全身着装槽位与衣柜立刻联动响应。
- **Git 风格的快照版本图（Snapshot Graph）**：每一次对话与状态变更都是一个不可变的快照节点。支持分支切换、就地改写、一键 checkout 回滚，选错剧情分支随时能够重来，无需借助外部 Git。
- **分层记忆与上下文压缩**：
  - 临时工作记忆 + 语义关键词唤醒的长期记忆库（支持置顶与重要度评分）。
  - 基于关键词触发的 World Info（世界观设定百科）。
  - 达到上下文阈值时自动压缩历史提要，长篇叙事下人设与世界观依然稳定。
- **开箱即用与绝对隐私**：
  - 内置离线剧本，免配置、免填 Key，初次打开即可体验完整的状态驱动与分支回滚。
  - 纯本地运行：基于 IndexedDB（Dexie.js）实现本地多工作区隔离，无中心服务器收集对话或密钥。
  - 直连主流模型：支持填入任意 OpenAI 兼容格式端点（DeepSeek、Claude、OpenAI、SiliconFlow、Ollama 等），请求直接从本地端发出。
- **跨平台支持**：统一代码库，支持纯 Web 静态部署，以及基于 Tauri 2 构建的桌面端（Windows）与移动端（Android）。

---

## 快速上手

### 本地开发

```bash
npm install
npm run dev        # 启动本地开发服务，访问 http://localhost:5173
npm run tauri dev  # 启动 Tauri 桌面端调试
```

首次打开默认加载离线演示剧本，可以直接通过操作气泡体验完整的状态机联动与时间线回滚。

### 接入大模型

在应用内「设置 → 模型服务」中添加你的 API 端点：
- 支持 20 余家主流服务商的开箱预设（DeepSeek、Claude、OpenAI、Kimi、GLM、通义千问、OpenRouter、SiliconFlow、Ollama 等）。
- 也支持选择「自定义」，填入任意 OpenAI 兼容的 BaseURL 与 Key。
- 浏览器 Web 环境下，跨域受限的端点可在 dev 模式由 Vite 动态代理转发，或在部署环境配置反向代理；Tauri 桌面端走底层原生网络，无跨域限制。

---

## 脚本命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Web 开发服务器 |
| `npm run build` | 构建 Web 静态生产产物 |
| `npm run check` | svelte-check 类型与模板诊断 |
| `npm run lint` / `format` | ESLint 检查 / Prettier 格式化 |
| `npm test` | Vitest 核心业务逻辑单元测试 |
| `npm run test:e2e` | Playwright 端到端自动化测试 |
| `npm run tauri dev` | 启动 Tauri 桌面开发壳 |
| `npm run tauri build` | 构建 Windows 安装包（NSIS / MSI） |
| `npm run tauri android build` | 构建 Android 安装包（APK / AAB） |

---

## 技术架构

- **前端架构**：SvelteKit（SPA 模式，纯客户端渲染）+ Svelte 5 Runes (`$state` / `$derived` / `$effect`)，轻量且低开销。
- **本地存储**：Dexie.js（IndexedDB），按工作区隔离存储状态快照、角色档案与记忆。
- **应用壳**：Tauri 2，为桌面端与移动端提供原生容器、原生 HTTP 插件与自动更新能力。
- **可选数据同步**：`server/` 目录下提供了一个轻量级 Node.js 同步服务，支持多端数据分槽同步。

```text
src/lib/
  core/          核心状态模型、快照图与回滚逻辑（纯函数）
  db/            Dexie schema、多工作区划分与持久化
  manager/       CharacterManager：状态变更与快照调度入口
  context/       上下文流水线：状态摘要拼装、记忆召回、历史压缩
  memory/        长期记忆提取与关键词匹配
  llm/           OpenAI 兼容客户端、离线演示驱动器、工具调用执行器
  platform/      运行环境适配（Web 全年龄安全模式 / 桌面端完整模式、Tauri 原生接口）
  components/    Svelte 5 组件与交互动效
```

---

## 运行环境差异

- **Web 版**：面向公开部署与全年龄访问，自动隐藏敏感服饰槽位与相关词条，系统提示词同步收敛。
- **桌面版（Tauri）**：面向本地私人使用，保留完整的槽位支持与无限制的状态操作。
- 两者底层快照数据格式一致，导出与工作区数据完全通用。

---

## 许可协议

本项目采用 MIT 许可证。详见 [LICENSE](./LICENSE)。
