# 开发日志

## 2026-08-04

### 上午：脚手架与核心抽象层

- 初始化 SvelteKit（adapter-static + fallback，SSR/prerender 关闭，Svelte 5 runes 显式开启）、ESLint flat config、Prettier、Vitest、Playwright。
- 定义核心类型：`CharacterState`（outfit/location/schedule/attributes）、`SnapshotNode`、`StatePatch`、`WorldInfoEntry`。
- 实现快照版本图纯函数：`chainToRoot`、`rebuildFromNodes`、`getBranchTips`、`getChildrenMap`、`checkout`（纯读）。
- 实现 Dexie 仓储（snapshots / worldInfo / kv）与 `CharacterManager`（唯一变更入口）。
- Context Pipeline：World Info 触发、状态摘要、历史压缩。
- LLM 客户端：OpenAI-compatible + 离线 demo。

### 下午：测试与类型收尾

- 152 个单元测试首次全绿；覆盖率迭代到 100% 语句/行/函数（分支 94%）。
- 修复 svelte-check 暴露的类型缺陷：引入 `StatePatch` 深度可选补丁、属性合并语义（undefined = 不修改）。
- 修复 ESLint 对 `.svelte.ts` 的解析与组件 runes 模式下 prop 命名冲突（`state` → `characterState`）。

### 傍晚：UI 与端到端

- 完成 P0–P5 全部面板：对话、状态编辑器（实时预览）、日程/时间推进、版本树 + checkout、世界书、设置、V3 导入导出。
- Playwright e2e 6 条流程通过；修复 vite preview 仅绑定 IPv6 导致 e2e 连接失败的问题（显式 `--host 127.0.0.1`）。
- 截图验证界面（空态 / 对话 / 版本树 / 预览）。

### 遗留与下一步

- 未覆盖分支（不可达防御路径）：`headId === null` 持久化、空 tips 选择——保持防御并在测试锁定主路径。
- 可迭代项：历史 LLM 摘要压缩、世界书词边界匹配、角色卡数值属性映射、PWA 离线打包。

## 2026-08-04（续）：模型服务商预设 + 网络搜索接线

### 背景

工作区里已有一份未提交的实现（`src/lib/llm/providers.ts` 预设目录 + `src/lib/search/` 搜索模块 +
`LlmConfig.providerId/webSearch` 字段扩展），但设置页 UI 与 `+page.svelte` 尚未接线，仓库处于
编译失败状态。本阶段完成接线并补齐质量门槛。

### 完成内容

- 设置页「模型服务」改为服务商选择：20 个主流预设 + 自定义；选中预设自动填充 Base URL 与默认模型，
  模型输入框带 datalist 候选；预设备注与 API Key 提示随选择更新。
- 补全预设目录：新增百度千帆、腾讯混元、零一万物、vLLM、Azure OpenAI，修正 Google 端点尾部斜杠。
- 设置页新增「网络搜索」配置（Tavily / Serper / Brave）；`+page.svelte` 接线搜索客户端，
  消息可附带搜索结果注入上下文；顶栏 provider 标签显示预设名 + 模型。
- 兼容旧存档：`normalizeLlmConfig` 对缺失的 `providerId` / `webSearch` 字段回退默认值。
- 测试：新增 `providers.test.ts`、`search-client.test.ts`；补充 pipeline / demo-provider / errors 用例；
  覆盖率保持 100% 语句/行/函数（分支 95.4%）；e2e 增至 7 条（含服务商预设自动填充）。

### 记录

- `ChatPanel` 中 `{disabled: busy}` 是非法的 Svelte 5 属性 shorthand（解析报错），已改为 `disabled={busy}`。
- `normalizeLlmConfig` 原签名 `Partial<LlmConfig>` 无法表达「webSearch 可部分缺省」，引入 `LlmConfigPatch`。

## 2026-08-04（续）：地点库与衣柜

### 需求

UI 增加「地点」与「衣柜」：地点用于让 AI 知道有哪些地点、自己现在在哪（独立于日程）；
衣柜是衣物预设（含穿后描述），AI 换装时从衣柜挑选而不是自行脑补。

### 实现

- 数据模型：`CharacterState` 新增顶层 `places: LocationDef[]`（地点库）；
  `OutfitState` 新增 `wardrobe: ClothingItem[]`（名称 + 穿后描述）；`StatePatch` 同步扩展。
- 校验：地点库/衣柜条目（id 非空且唯一、名称非空、描述为字符串）纳入 `validateCharacterState`。
- 摘要：状态注入【已知地点】与【衣柜】清单；新增 `formatPlaces / formatWardrobe / findWardrobeItem`。
- UI：新增「地点」与「衣柜」标签页（维护清单、设置当前所在地/穿着、穿着细节预览）；
  状态页穿着输入带衣柜 datalist；实时预览增加地点库与衣柜行。
- 默认数据：初始地点库（校门/教室/食堂/图书馆/天台）与初始衣柜（6 件含描述）。

### 设计缺陷修复

- e2e 暴露 `CharacterManager` 并发更新竞争（错误分支 + 状态覆盖）→ 实现串行化变更队列（见 DECISIONS D15），
  新增并发更新/混合操作测试；并发 init 共享 promise 防重复建根。

### 门禁

- 200 个单元测试；覆盖率 100% 语句/行/函数（分支 95.85%）；8 条 e2e 全过；build/check/lint 全绿。

## 2026-08-04（续）：地点/衣柜分类 + 穿着槽位扩展

### 需求

1. 地点与衣柜增加大类（如「学校 > 食堂」「常服 > 白色衬衫」）。
2. 当前穿着扩展：除上衣/下装/鞋外，增加帽子、内衣、内裤、袜子。

### 实现

- `LocationDef` / `ClothingItem` / `LocationState` 增加 `category`（空串 = 未分类）；
  `OutfitState` 槽位扩展为 headwear/top/underwear/underpants/bottom/socks/shoes/accessories。
- 校验：category 必须为字符串（可为空）；新槽位沿用字符串|null 校验；id 唯一性保持。
- 摘要：`formatPlaces / formatWardrobe / 地点行` 输出 `分类 > 名称`；formatOutfit 按穿戴顺序拼接全部槽位。
- UI：地点/衣柜面板增加分类输入与 `分类 > 名称` 展示；当前穿着与状态页补 4 个新槽位；
  衣柜「穿着细节」覆盖全部 7 个命名槽位。
- 初始数据：地点库补「学校 > 游泳馆」；衣柜按「常服/运动服」分类，新增袜子、内衣、内裤、贝雷帽条目。

### 门禁

- 202 个单元测试；覆盖率 100% 语句/行/函数（分支 95.72%）；8 条 e2e 全过；build/check/lint 全绿。

## 2026-08-04（续）：分类收纳 + 槽位类型约束

### 需求

1. 常服/学校等大类在 UI 里要分组收纳（可折叠），而不是平铺。
2. 做好「上衣」这类标签：换装槽位不能把内裤套头上——从衣柜挑选时按衣物类型过滤。

### 实现

- `groupByCategory`（utils）：按 category 分组，有分类按名称排序、未分类置底，供地点库/衣柜折叠展示。
- 地点与衣柜面板：分类组头（名称 + 数量 + 折叠箭头）可收纳/展开；新增条目的分类输入带已有分类候选。
- `ClothingItem.kind`：衣物类型（headwear/top/underwear/underpants/bottom/socks/shoes/accessory/any），
  缺省视为 any（兼容老数据）；纳入校验（非法类型抛错）。
- `wardrobeItemsForSlot`：按槽位过滤衣柜候选（kind 匹配或 any/未标注）。
- `OutfitSlotPicker`：槽位改为下拉（候选 = 匹配类型的衣柜条目）+「自定义…」自由输入；
  状态页与衣柜页共用；初始衣柜条目全部标注类型。
- 新增 grouping 工具与槽位过滤的单元测试；e2e 覆盖「上衣下拉不含内裤」。

### 门禁

- 208 个单元测试；覆盖率 100% 语句/行/函数（分支 95.86%）；8 条 e2e 全过；build/check/lint 全绿。

## 2026-08-04（续）：实时预览精简

### 需求

实时状态预览（给人看的）不应包含「地点库」「衣柜」整行——清单太长，且那是给 LLM 上下文用的。

### 实现

- `StatePreview` 移除「地点库」「衣柜」两行，保留 时间 / 当前地点（含分类）/ 穿着 / 属性 / 日程；
  LLM 上下文中的【已知地点】【衣柜】清单保持不变。
- e2e 断言同步为预览中仍可见的「当前地点（校外 > 海边）」与「穿着」。

### 门禁

- 208 个单元测试；8 条 e2e 全过；check/lint 全绿。

## 2026-08-04（续）：版本树改为链式平级布局

### 需求

「版本」页的快照树会随对话次数一直向右延伸（每个节点都递归缩进），长对话难以浏览。

### 实现

- 新增 `collectLinearChain`（版本图纯函数）：沿单链收集节点，遇叶子或分支点停止；
  版本树 UI 用它把链式节点平级渲染（`each` 迭代，不递归），只有真正的分支点才向右缩进展开子树。
- 分支点行显示「分支点」徽标；当前 head 行高亮；CSS 缩进/竖线/圆点仅作用于分支子节点。
- 单链渲染改为迭代而非组件递归，深链（数百条消息）也不会产生组件栈压力。

### 门禁

- 211 个单元测试；覆盖率 100% 语句/行/函数（分支 95.89%）；8 条 e2e 全过；build/check/lint 全绿。

## 2026-08-04（续）：版本删除 + AI 状态工具 + RP 斜杠命令

### 需求

1. 「版本」页增加删除选项。
2. 调研现有 agent 框架的运转方式，让 AI 在合适时机调用工具自行修改参数
   （离开学校就改地点、按剧情推进时间、自行换装）。
3. 输入框加入 RP 快捷操作：`/wear`、`/goto` 等斜杠命令直接改状态，而不是全靠打字描述。

### 调研：agent 框架如何运转

- OpenAI Agents SDK / Anthropic tool use / ReAct 是一致的核心模式：**agent loop**——
  工具以 JSON Schema 注册 → LLM 输出结构化 `tool_calls` → 宿主执行并追加 `tool` 结果 → 再次请求
  LLM → 直到模型直接输出文本；用最大轮数防死循环。
- OpenAI-compatible 端点存在两种工具返回形态：标准 `choices[0].message.tool_calls`
  与纯文本 JSON（`{"tool":"...","args":{...}}`），客户端两者都兼容。

### 实现

**版本删除**

- `SnapshotRepository.removeMany`（批量删除）；`CharacterManager.deleteBranch(tipId)`：
  删除 tip 到分支点（不含分支点/根）的整段链；head 在链上时先切回链父节点；
  根与非末端节点拒绝删除（防孤儿链）；全部在串行队列内执行。
- 版本页「分支」列表与快照树末端行加「删除」按钮（带 confirm）；e2e 覆盖删除分支后
  快照数减少、分支消失。

**AI 状态工具**

- `llm/state-tools.ts`：四个状态工具（goto_location / advance_time / set_outfit / set_attribute），
  执行走 CharacterManager 生成快照；set_outfit 必须匹配衣柜，防止脑补衣物。
- `ChatService.generateReply` 增加 agent loop（默认最多 4 轮）：每轮执行工具后
  重新 `buildContext` 刷新状态摘要；工具调用与 tool 结果不落成用户可见消息。
- `OpenAiCompatibleClient.chatWithTools`：请求体携带 tools 声明，解析标准 tool_calls 与
  纯文本 JSON 两种形态；demo provider 提供确定性工具调用路径。
- 设置页新增「允许 AI 自主修改状态」开关（默认关闭，存 `LlmConfig.allowAiStateTools`）。
- e2e：开启开关后演示模式按剧情自动切到「学校 > 食堂」。

**RP 斜杠命令**

- `utils/slash.ts`：`/goto`（名称/分类>名称/唯一分类匹配地点库）、`/wear`（槽位=衣物或
  自动推断；`=无` 脱掉；按 kind 校验类型，禁止内裤套头上）、`/time`、`/checkpoint`、`/help`；
  解析与执行均为纯函数，返回 StatePatch / minutes，落地仍走 CharacterManager。
- 输入框增加 `/goto /wear /time /help` 快捷 chips；命令执行后追加一条 system 提示
  （如「（命令）切换地点：学校 > 食堂」）让 AI 感知转场。
- e2e：/goto /wear /time /help 全链路。

### 门禁

- 单元测试：全量 274 个；覆盖率 100% 语句/行/函数（分支 94.66%）；11 条 e2e 全过；
  build/check/lint 全绿。

## 2026-08-05（续）：补全悬浮窗 + 删除语义修正 + 版本页改版

### 需求

1. 快捷操作 chips 会挤压聊天框，去掉；改为输入 `/` 时弹出自动补全悬浮窗，
   且按数据库补全——`/goto` 补地点库、`/wear` 先补槽位再补该槽位的衣物。
2. 只剩一个分支时不能删除，否则会清空聊天记录；快照树里「删除最后一个」不应整条链全删。
3. 快照中的「分支点」概念与树形 UI 不合理，需要改版。

### 实现

**自动补全（替代 chips）**

- 新增 `utils/autocomplete.ts`（纯函数 + 全量测试）：`/` 补命令；`/goto ` 补地点库
  （分类 > 名称，按输入过滤）；`/wear ` 补槽位（帽子/上衣/内衣/内裤/下装/袜子/鞋）；
  `/wear 槽位=` 按衣物类型补衣柜衣物并附「无（脱掉）」；`/time ` 补快捷时长。
- `ChatInput`：悬浮窗（键盘 ↑/↓ 选择、Tab/Enter 确认、Esc 关闭、点击选择）；
  命令/槽位是中间步骤（选中后保持打开），地点/衣物/时长是叶子（选中后关闭，Enter 直接发送）；
  数据源通过 props 显式传入（地点库 + 衣柜），不依赖全局。

**删除语义**

- `CharacterManager.deleteBranch` 增加守卫：全图只剩一个分支（`getBranchTips().length <= 1`）
  时抛错「只剩一个分支，不能删除」，UI 同步禁用删除按钮并提示。
- 删除仍是「分支级」：只移除该分支独有的快照链（tip → 分支点），共享历史保留；
  版本页不再出现逐节点「删除」，从根本上避免「删最后一个把整条链删光」的误解。

**版本页改版（去掉分支点徽标与递归缩进树）**

- 删除 `VersionNode.svelte`；`VersionPanel` 改为扁平「分支列表」：
  每个分支一张卡片（tip 描述、快照数、当前徽标、展开/收起、切换、删除），
  展开后展示该分支从根到 tip 的完整链，任意节点都可切换回溯；
  共享前缀节点视觉弱化（半透明），分叉来源以「分叉自：」文本说明而非徽标。
- 分支按最后时间倒序；默认全部展开，可逐条收起。

### 门禁

- 单元测试：全量 287 个；覆盖率 100% 语句/行/函数（分支 94.6%）；12 条 e2e 全过；
  build/check/lint 全绿。
