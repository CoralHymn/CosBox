# CosBox

一个真正面向 AI 角色扮演的状态驱动叙事客户端。

我们讲穿着（帽子/内衣/内裤/袜子/配饰）、衣柜、地点、日程、属性变成结构化数据，作为系统提示词注入 LLM。
Context Pipeline 把状态摘要、世界信息命中、压缩后的对话和长期记忆装进系统提示，LLM 每次都清楚当前剧情状态。
所有状态变更和对话以增量快照存入 IndexedDB，构成类 Git 的版本图，任意节点可回溯，也能开分支、做 checkout，不需要外部 Git。

另有 LLM 自动提取的长期记忆（关键词召回、可置顶）、零依赖 Node 的远程同步服务器（按工作区分槽，本地变更约 1.5 秒内推送），以及 Tauri 2 双端打包壳（Windows NSIS/MSI 自动更新、Android APK/AAB）。

## 技术栈

- TypeScript（strict，零 `any`）
- SvelteKit（纯客户端渲染，SSR/Prerender 关闭）+ Svelte 5 Runes（`$state` / `$derived` / `$effect`）
- Dexie.js（IndexedDB）、nanoid
- OpenAI-compatible API（内置离线 demo provider，可用 LiteLLM Proxy 等任意兼容端点）
- Tauri 2（Windows WebView2 / Android WebView 打包壳，`updater` / `http` / `process` 插件）
- 零依赖 Node.js 同步服务器（`server/`，node --test 可测）
- Vitest + Playwright

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173（首次加载已预热，秒开）
npm run tauri dev  # Tauri 桌面壳（首次编译约 1–3 分钟）
```

默认使用内置演示 LLM（离线可用，回应由状态摘要推导）。「设置」页的模型服务支持 20 多家主流服务商：
OpenAI、Anthropic Claude、Google Gemini、DeepSeek、Kimi、通义千问、智谱 GLM、GLM Coding Plan、
百度千帆、腾讯混元、零一万物、MiniMax、SiliconFlow、Mistral、xAI Grok、Groq、Cerebras、
OpenRouter、OpenCode GO、OpenCode Zen、Command Code GOAT、Together AI、Ollama、LiteLLM Proxy、vLLM、Azure OpenAI。
选一个预设就自动填好兼容端点和常用模型候选；每个服务能挂多个模型，Key 只填一次，
统一绑定为「智能体」（对话与地点/衣柜/日程生成共用）；也可以选「自定义」填任意 OpenAI-compatible 端点。
状态同步判断交给 TypeSafe Jev 决策模型（System One），只返回校准概率，不消耗 LLM token。
内置演示（离线）同样能增删模型，误删后在「添加模型服务」里选回它即可直接保存。

有些端点不允许浏览器 CORS 直连（如 opencode.ai：OPTIONS 预检直接 404，直连会 `Failed to fetch`）。
这类端点由 `useProxy` 标记（OpenCode GO/Zen 预设已自带，Command Code 这类允许 CORS 的
保持直连）——baseUrl 仍存真实地址，请求前换成 `/llm-proxy/<host>/<path>`，
`npm run dev` / `npm run preview` 由 `vite.config.ts` 的中间件按 host 动态转发，
静态部署需自建同路径反向代理；Tauri 打包版走 `tauri-plugin-http`（Rust 侧发出请求，
没有 CORS 问题）。只有「自定义」端点会在设置页给出勾选框，预设不显示。
网络搜索支持 Tavily / Serper / Brave，发送消息时可以把实时结果注入 LLM 上下文。

数据同步：按 [server/README.md](./server/README.md) 部署同步服务器（有一键安装脚本，也支持手动和面板），
在「设置 → 数据同步」填入服务器地址与密钥即可。打包与签名流程见
[PACKAGING.md](./PACKAGING.md) 与 [ANDROID_SIGNING.md](./ANDROID_SIGNING.md)；
推送 `v*` tag 会触发 GitHub Actions 自动构建 Windows + Android 并创建 Release
（见 PACKAGING.md「GitHub Release 自动发布」）。
macOS / iOS 包无法在 Windows 构建，GitHub Actions 方案见 [APPLE_BUILD.md](./APPLE_BUILD.md)（待落地）。

## 脚本

| 命令                          | 说明                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                 | 开发服务器（含首屏预热，见 vite.config.ts）                                    |
| `npm run build` / `preview`   | 构建 / 预览产物                                                                |
| `npm run check`               | svelte-check 类型与诊断                                                        |
| `npm run lint` / `format`     | ESLint / Prettier                                                              |
| `npm run format:check`        | Prettier 检查                                                                  |
| `npm test` / `test:watch`     | Vitest 单元测试                                                                |
| `npm run test:coverage`       | 覆盖率（核心层语句/行/函数 100%，分支 ≥90%）                                   |
| `npm run test:server`         | 同步服务器单测（node --test，多工作区分槽）                                    |
| `npm run test:e2e`            | Playwright 端到端测试                                                          |
| `npm run tauri dev`           | Tauri 桌面开发壳（Windows）                                                    |
| `npm run tauri build`         | 打包 Windows 安装包（NSIS / MSI，带更新签名）                                  |
| `npm run tauri android dev`   | Android 开发（需 adb 连接真机/模拟器）                                         |
| `npm run tauri android build` | Android 发布构建（APK / AAB）                                                  |
| `dev.bat`                     | Windows 下快捷启动开发服务器                                                   |
| `pack.bat`                    | 版本一致性检查 + 桌面打包（需签名密钥）                                        |
| `check-version.bat`           | 校验四处版本号一致（package.json / Cargo.toml / tauri.conf.json / updater.ts） |

## 功能总览

### 核心叙事

- 对话界面 + Snapshot 集成：每条消息都是版本图节点；消息可原地改写（git commit --amend 语义）、
  重试、分支切换、批量删除；分支/快照可视化（新在上、旧在下），checkout 无副作用。
- 角色状态编辑器 + 实时预览 + 自动 snapshot；配置类编辑（地点库/衣柜/日程）不生成快照、不进版本历史。
- 地点库与衣柜：支持大类并按分类折叠收纳（如「学校 > 食堂」「常服 > 白色衬衫」）；衣物带类型标签，
  换装槽位只从匹配类型的衣柜中挑选（不会把内裤套头上）；AI 知道全部地点与可选衣物（含穿后描述）。
- RP 斜杠命令（`/goto` `/wear` `/time` `/checkpoint` `/help`）+ 自动补全弹窗，执行同样落快照。

### AI 对话

- 提示词独立标签页：系统提示词（回复规则 / 破甲词）、人物提示词、用户提示词、世界观提示词、
  风格提示词五段分开编辑，按顺序组装进系统消息；原「设置 → 角色档案 → 系统提示」已迁移到该页。
- 模型服务管理：多服务多模型、Key 只填一次、智能体统一绑定、模型列表拉取与连接测试；
  状态补执行由 TypeSafe Jev 决策模型判断。
- 默认开启流式输出、AI 自主状态工具与「低多边形星球」官方背景。
- Context Pipeline：状态摘要（穿着按槽位带标签、空槽位显式标注「未穿」）、World Info 关键词命中、
  长期记忆召回、阈值触发 LLM 摘要压缩（最近 20 条原样保留）、网络搜索注入。
- 流式输出：思考过程实时展示（`reasoning_content`，默认收起可展开）、生成可打断（发送/停止同按钮）、
  无数据看门狗与自动重试（思考耗尽 Max Tokens 有明确提示）。
- Agent 工具循环：`goto_location` / `advance_time` / `set_outfit` / `set_attribute` 结构化调用，
  每轮工具执行生成快照 + 持久化【工具调用】反馈消息；AI 一轮回复合并为单气泡分段展示。
- 工具双通道兜底：模型只把调用写进正文/思考而未发出结构化 `tool_calls` 时，从文本/JSON 形态解析并执行。
- LLM 状态确认：开启后由独立模型二次判断是否需要更新状态（剧情需要优先，不会因为安全顾虑跳过状态更新）。
- 上下文用量与费用估算（按对话角色模型展示，持久化）；开发者模式可查看完整提示词、预览输入框内容、
  导出最近会话日志；监控面板记录工具调用/补调重试/文本兜底等运行指标（图表 + 事件流）。

### 世界与数据

- 长期记忆功能区：LLM 自动提取（对话模型、固定消息数触发、防抖批处理）+ 关键词召回评分 + 置顶 +
  重要度，随上下文有界注入；手动增删改查。
- AI 生成：地点/衣柜/日程面板都能直接按世界观预设（现代/古代/奇幻，含禁词）生成候选列表，
  经 `review_generation` 审查循环修正后勾选导入。
- 分类折叠、拖拽排序（地点库/衣柜）、日程自动排序；地点库/衣柜/日程各支持导出 JSON 模板与导入合并。
- World Info 世界书（关键词触发、优先级）；SillyTavern V3 角色卡导入导出（往返映射稳定）。

### 多工作区与同步

- 启动进入工作区选择页（可选/新建/导入 .cbox / 重命名/复制/导出/删除），应用内切换器随时可切；
  `.cbox` v2 含长期记忆与工作区名，兼容 v1；导入校验快照链可重建。
- 远程数据同步按工作区分槽：本地变更 1.5s 防抖推送、5s 轮询拉取，较新一方胜出；
  同步数据不含模型配置与 API Key；服务器端 Bearer 密钥、鉴权限流、原子写入、槽位上限。
- 主题自定义：预设（default/claude/discord/verge）+ 自定义背景图（透明度/磨砂滑块）+ 全套颜色变量；
  桌面端自定义标题栏（拖拽、工作区切换、窗口控制）；移动端响应式（抽屉导航、安全区域）。
- 设置页内置开源协议声明弹窗（全部参考开源项目及许可证）。

### 打包

- Tauri 2 双端：Windows（NSIS/MSI，`updater` 自动更新，安装后重启）+ Android（APK/AAB，导出走 MediaStore）。
- 打包版所有 LLM/搜索请求经 `tauri-plugin-http` 发出，无 WebView CORS 限制。
- `pack.bat` 一键校验版本一致性并打包；`check-version.bat` 独立校验四处版本号。

## 目录结构

```text
src/lib/
  core/          状态模型、快照版本图、错误体系（纯函数）
  db/            Dexie schema（多工作区分区）、仓储、WorkspaceScope、作用域 kv
  manager/       CharacterManager：状态变更唯一入口（内部串行队列）
  workspace/     工作区注册表与编排服务（切换/创建/复制/删除/导入/收集导出）
  context/       World Info 触发、状态摘要、长期记忆召回、历史压缩、Context Pipeline
  memory/        长期记忆：LLM 提取、关键词召回、置顶（纯函数）
  llm/           OpenAI-compatible 客户端、demo provider、状态工具、agent 循环、状态确认、
                 文本工具兜底、模型服务管理、AI 生成、token/费用估算、模型列表/连接测试
  import-export/ chara_card_v3 映射、.cbox 工作区序列化（v2）、单面板配置转移
  search/        网络搜索客户端（Tavily / Serper / Brave）
  sync/          远程同步客户端（防抖推送 + 轮询拉取 + 按工作区重载）
  platform/      打包适配层（Tauri 检测、自动更新、platformFetch）
  theme/         主题系统（预设 + 背景图 + 透明度/磨砂）
  legal/         开源协议声明
  stores/        Svelte 5 runes 响应式封装（薄层，不含业务逻辑）
  utils/         纯工具（格式化、分组、斜杠命令解析/执行、ZIP、下载等）
  components/    UI 组件（显式 props，禁止 rest 透传）
server/          数据同步服务器（零依赖 Node，多工作区分槽，node --test 可测）
src-tauri/       Tauri 壳（tauri.conf.json、Rust 入口、gen/android Gradle 工程、更新签名密钥）
```

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)、[DECISIONS.md](./DECISIONS.md)、
[PACKAGING.md](./PACKAGING.md)、[ANDROID_SIGNING.md](./ANDROID_SIGNING.md)、
[APPLE_BUILD.md](./APPLE_BUILD.md) 与 [server/README.md](./server/README.md)。
