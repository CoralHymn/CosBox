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
