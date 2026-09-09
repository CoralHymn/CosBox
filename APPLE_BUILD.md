# Apple 平台构建指南（macOS / iOS，走 GitHub Actions）

> 状态：**待执行方案，尚未构建**。产品基本稳定后再按本文件落地。
> 编写日期 2026-09-05，所有 CLI 参数与环境变量名均按当时的 Tauri v2（`@tauri-apps/cli` 2.11.x）核实。

CosBox 现在能在 Windows 上打 Windows 包、打 Android 包（见 [PACKAGING.md](./PACKAGING.md)、
[ANDROID_SIGNING.md](./ANDROID_SIGNING.md)）。macOS 与 iOS 两个包**在本机永远打不出来**，
原因是 Apple 工具链（Xcode / `xcodebuild` / 签名）只存在于 macOS。GitHub Actions 提供
`macos-*` 托管运行器，可以在云端 macOS 上编译并把产物下载回来，这是当前唯一可行路径。

## 1. 为什么 Windows 本机做不到

| 检查项                                              | 结果                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npx tauri --help`（本机 Windows，2026-09-05 实测） | 子命令只有 `android`，**没有 `ios`**；Tauri CLI 在非 macOS 平台不注册 iOS 子命令 |
| `npx tauri ios init`                                | 无法执行 → `src-tauri/gen/apple/`（Xcode 工程）在 Windows 上连生成都做不到       |
| `src-tauri/gen/` 现状                               | 只有 `android/` 与 `schemas/`，无 `apple/`                                       |
| iOS 构建                                            | 必须 macOS + Xcode；`.ipa` 必须用 Apple 证书签名才可安装                         |

结论：iOS 的第一步（生成 Xcode 工程）就得在 macOS 上做，要么借真机/云 Mac，
要么让 CI 跑一次一次性任务把工程产物下载回来提交（见 §4 方案 B）。

## 2. GitHub Actions 触发规则（没用过的人先读这节）

**核心事实：不存在"自动就开始构建"这回事。** GitHub Actions 只执行仓库里
`.github/workflows/*.yml` 声明的工作流；**这个仓库目前根本没有 `.github/` 目录**，
所以今天一次构建都没跑过、一分钟额度都没消耗。要不要跑、什么时候跑，完全由你写进
YAML 的 `on:` 决定。

常见触发方式：

| `on:` 写法                 | 含义                                                               | 是否适合 CosBox 的 Apple 构建                                                |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `workflow_dispatch`        | 手动触发：Actions 页面出现「Run workflow」按钮，可选分支、可填参数 | ✅ **首选**。想构建时点一下，不点就永远不跑                                  |
| `push: tags: ['v*']`       | 推 `v0.1.0` 这种 tag 时自动跑                                      | ✅ 第二阶段再加，用于正式发布                                                |
| `push: branches: [dev]`    | 每次往 dev 提交都跑                                                | ❌ 不要用。macOS 额度按 10 倍扣，一次冷构建 15–30 分钟，几次就把月度额度烧完 |
| `pull_request`             | PR 创建/更新时跑                                                   | ❌ 同上；CI 校验用 `npm run check` / `test` 的 Linux 工作流就够              |
| `schedule: cron`           | 定时跑                                                             | ❌ 没必要                                                                    |
| `release` / `workflow_run` | 发布事件 / 别的流跑完后接力                                        | 可选，后期串发布流水线时用                                                   |

几个容易踩的点：

- **手动按钮要求文件在默认分支上**：`workflow_dispatch` 的工作流必须先合进 `main`，
  Actions 页面才会出现「Run workflow」；运行时可以用下拉框选 `dev` 等其它分支。
  （命令行也可以：`gh workflow run apple.yml --ref dev`）
- **额度与计费**：本仓库是**私有仓库**（GitHub API 查 `CoralHymn/CosBox` 返回 404 验证）。
  Free 计划私有仓库每月 2000 分钟，**macOS 运行器按 10 倍计费** → 实际每月只有约
  **200 分钟 macOS 时间**；用完后 Actions 直接被停用，不会继续跑。仓库转公开则不计时
  （公开仓库的标准运行器免费无限量）——如果将来 CosBox 开源，这个约束自动消失。
- **耗时预期**：iOS 冷构建（Rust 三个架构全量编译 + Xcode archive）约 15–30 分钟；
  加上 `Swatinem/rust-cache` 缓存后增量约 5–12 分钟。`timeout-minutes` 一定要写，
  否则卡死的工作流会一直烧额度。
- **产物怎么拿**：`actions/upload-artifact` 上传后，在该次 run 页面底部下载 zip
  （默认保留 90 天）；正式发布建议改成建 GitHub Release 并上传附件。
- **密钥怎么给**：仓库 Settings → Secrets and variables → Actions → New repository secret。
  YAML 里用 `${{ secrets.XXX }}` 引用，日志中会自动打码。
- **一次只跑一个**：用 `concurrency` 防止重复点按钮把额度烧光。

## 3. 前置条件（花钱/账号的部分）

| 项目                              | 是否必需                         | 说明                                                                |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| Apple Developer Program（$99/年） | 出可安装 `.ipa` / 上架时**必需** | 没有它也能用 `--no-sign` 验证「iOS 能不能编译过」，但产物装不上真机 |
| Mac 设备                          | 非必需                           | 可用 CI 一次性任务代替（§4 方案 B）                                 |
| App Store Connect 账号            | TestFlight / 上架时必需          | 同时用于生成上传用的 API Key                                        |
| GitHub Actions 额度               | 必需                             | 见 §2；私有仓库 macOS 额度很紧                                      |

## 4. 一次性准备

### 4.1 生成 `src-tauri/gen/apple/` 并提交

和现在的 `gen/android` 一样，Tauri 的 Xcode 工程要**纳入版本控制**（CI 每次重新 init
会丢掉你在 Xcode 里改的配置）。`src-tauri/.gitignore` 只忽略 `/target/` 与 `/gen/schemas`，
所以 `gen/apple/` 会正常入库。

**方案 A：有 Mac（或云 Mac，如 MacinCloud / MacStadium）**

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npm ci
npm run tauri ios init          # 生成 src-tauri/gen/apple/
git add src-tauri/gen/apple && git commit -m "初始化 iOS Xcode 工程"
```

**方案 B：完全没有 Mac —— 让 CI 代跑一次**

临时建 `.github/workflows/ios-init.yml`（跑完就删），下载 artifact 后解压到本地提交：

```yaml
name: iOS 工程初始化（一次性）
on:
  workflow_dispatch:
jobs:
  init:
    runs-on: macos-15
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios,aarch64-apple-ios-sim,x86_64-apple-ios
      - run: npm run tauri ios init
      - uses: actions/upload-artifact@v4
        with:
          name: gen-apple
          path: src-tauri/gen/apple
```

下载 → 解压成 `src-tauri/gen/apple/` → `git add src-tauri/gen/apple` → 提交。
之后所有构建都基于这份工程，CI 里不再执行 `ios init`。

### 4.2 iOS 专属配置 `src-tauri/tauri.ios.conf.json`

Tauri 在 iOS 构建时会自动把这个文件合并进 `tauri.conf.json`（macOS 对应
`tauri.macos.conf.json`），不要直接改主配置：

```json
{
	"bundle": {
		"iOS": {
			"minimumSystemVersion": "15.0",
			"developmentTeam": "XXXXXXXXXX"
		}
	}
}
```

- `developmentTeam`：Apple 开发者后台 Membership 里的 Team ID。**也可以不写进文件**，
  用环境变量 `APPLE_DEVELOPMENT_TEAM` 覆盖（CI 里放 secret 更干净，避免明文入库）。
- `minimumSystemVersion`：Tauri 默认 `15.0`，对应 Xcode 的 `IPHONEOS_DEPLOYMENT_TARGET`。
- `identifier` 必须与 App ID / Bundle ID 完全一致，当前是 `cc.benng.cosbox`（`tauri.conf.json`）。
  iOS 构建时 Tauri 会把它写进 `PRODUCT_BUNDLE_IDENTIFIER`。
- 图标：`npx tauri icon <1024px 源图>` 会连带生成 iOS 图标集（PACKAGING.md 发布待办第 1 条）。

### 4.3 GitHub Secrets 清单

| Secret                                             | 用途                                                                  | 怎么得到                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `IOS_CERTIFICATE`                                  | iOS 签名证书（base64 的 `.p12`）                                      | 钥匙串里右键证书 → 导出 `.p12`，然后 `base64 -i cert.p12 \| pbcopy`         |
| `IOS_CERTIFICATE_PASSWORD`                         | 导出 `.p12` 时设的密码                                                | 自己设的                                                                    |
| `IOS_MOBILE_PROVISION`                             | 描述文件（base64 的 `.mobileprovision`）                              | 开发者后台建 Profile 下载后 `base64 -i xx.mobileprovision \| pbcopy`        |
| `APPLE_DEVELOPMENT_TEAM`                           | Team ID                                                               | 开发者后台 Membership                                                       |
| `APPLE_API_KEY` / `APPLE_API_ISSUER`               | 上传 App Store Connect 用（可选）                                     | App Store Connect → Users and Access → Integrations → App Store Connect API |
| `APPLE_API_KEY_PATH`                               | 私钥文件路径（可选，CI 里现写文件）                                   | 下载 `.p8` 后在步骤里落盘                                                   |
| `TAURI_SIGNING_PRIVATE_KEY`                        | **macOS updater 签名私钥**（`src-tauri/.keys/cosbox.key` 的**内容**） | 见 PACKAGING.md「签名密钥」                                                 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`               | 上面密钥的密码                                                        | 当前是**空密码**，secret 值留空字符串                                       |
| `APPLE_SIGNING_IDENTITY`                           | macOS 公证签名身份，如 `Developer ID Application: XXX (TEAMID)`       | `security find-identity -v -p codesigning`                                  |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | macOS 的 Developer ID 证书（base64 `.p12`）                           | `openssl base64 -A -in cert.p12 -out out.txt`                               |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`    | macOS 公证（Apple 账号 + app 专用密码）                               | appleid.apple.com 生成 app 专用密码                                         |

证书类型别选错：

- `--export-method debugging` → **Apple Development** 证书
- `--export-method release-testing`（Ad Hoc）→ **Apple Distribution** 证书
- `--export-method app-store-connect`（TestFlight / 上架）→ **Apple Distribution** 证书
- macOS 公证 → **Developer ID Application** 证书（与 iOS 的不是同一张）

Tauri CLI 会自己读 `IOS_CERTIFICATE` / `IOS_CERTIFICATE_PASSWORD` / `IOS_MOBILE_PROVISION`
并建临时钥匙串，**不需要**手写 `security import` 那套 GitHub 官方示例步骤。

## 5. 构建工作流（准备落地时复制成 `.github/workflows/apple.yml`）

```yaml
name: Apple 构建（macOS / iOS）

on:
  workflow_dispatch:
    inputs:
      target:
        description: 构建目标
        type: choice
        default: ios-adhoc
        options: [ios-adhoc, ios-appstore, ios-nosign, macos, all]
  # 稳定后再启用正式发布：
  # push:
  #   tags: ['v*']

concurrency:
  group: apple-${{ github.ref }}-${{ github.event.inputs.target }}
  cancel-in-progress: false

jobs:
  ios:
    if: ${{ github.event.inputs.target != 'macos' }}
    runs-on: macos-15 # arm64；标签可用列表以 GitHub 文档为准
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22 # Vite 8 要求 ≥22.12；报 Node 版本错误就换 24
          cache: npm

      - run: npm ci

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios,aarch64-apple-ios-sim,x86_64-apple-ios

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: 构建 iOS
        env:
          # 三个变量齐了 Tauri 会自动建钥匙串并切手动签名；缺证书就走 --no-sign
          IOS_CERTIFICATE: ${{ secrets.IOS_CERTIFICATE }}
          IOS_CERTIFICATE_PASSWORD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}
          IOS_MOBILE_PROVISION: ${{ secrets.IOS_MOBILE_PROVISION }}
          APPLE_DEVELOPMENT_TEAM: ${{ secrets.APPLE_DEVELOPMENT_TEAM }}
        run: |
          set -euo pipefail
          if [ "${{ github.event.inputs.target }}" = "ios-appstore" ]; then
            METHOD=app-store-connect
          else
            METHOD=release-testing
          fi
          if [ -n "${IOS_CERTIFICATE:-}" ]; then
            npm run tauri ios build -- --export-method "$METHOD"
          else
            echo "::warning::未配置 IOS_CERTIFICATE，走 --no-sign：仅验证编译，产物装不上真机"
            npm run tauri ios build -- --no-sign
          fi

      - name: 收集产物
        run: |
          mkdir -p dist
          find src-tauri/gen/apple/build -name '*.ipa' -exec cp {} dist/ \;
          ls -la dist

      - uses: actions/upload-artifact@v4
        with:
          name: cosbox-ios-${{ github.event.inputs.target }}
          path: dist/
          if-no-files-found: error

  macos:
    if: ${{ github.event.inputs.target == 'macos' || github.event.inputs.target == 'all' }}
    runs-on: macos-15
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: 构建 macOS（含 updater 签名 + 公证）
        env:
          # createUpdaterArtifacts: true → 缺这两个变量构建会直接失败
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          # 下面四个齐全才会签名 + 公证；不配则出未签名 dmg（Gatekeeper 会拦）
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run tauri build -- --target aarch64-apple-darwin
        # 需要同时支持 Intel Mac：--target universal-apple-darwin（编译时间翻倍）

      - name: 收集产物
        run: |
          mkdir -p dist
          cp src-tauri/target/release/bundle/dmg/*.dmg dist/ || true
          cp src-tauri/target/release/bundle/macos/*.app.tar.gz dist/ || true
          cp src-tauri/target/release/bundle/macos/*.app.tar.gz.sig dist/ || true
          ls -la dist

      - uses: actions/upload-artifact@v4
        with:
          name: cosbox-macos
          path: dist/
          if-no-files-found: error
```

`.ipa` 的实际落盘路径随 CLI 版本变化（文档写的是
`src-tauri/gen/apple/build/arm64/<AppName>.ipa`），所以上面用 `find` 兜，别硬编码路径。

## 6. 分发路径

| 方式           | 命令                                           | 适用                                      | 限制                                                       |
| -------------- | ---------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| **Ad Hoc**     | `--export-method release-testing`              | 小团队内测（对标现在的 Android APK 内测） | 必须先登记每台设备 UDID，每类设备上限 100 台               |
| **TestFlight** | `--export-method app-store-connect`            | 较大范围内测                              | 内部测试 100 人免审；外部测试最多 10000 人但首个构建要过审 |
| **App Store**  | 同上 + 提交审核                                | 正式发布                                  | 审核；不能自托管分发                                       |
| 开发调试       | `--export-method debugging` 或 `tauri ios dev` | 连真机调试                                | 需 Development 证书                                        |

iOS **不能像 Windows 那样把安装包挂在自己服务器上让用户下载**——这是 Apple 签名与
分发机制的硬限制，所以 PACKAGING.md 里"Android/iOS 走应用商店渠道更新"的说法对 iOS
是强制的。

macOS 则和 Windows 一样可以自托管 + 用 updater 自动更新：

```bash
# 产物：src-tauri/target/release/bundle/macos/CosBox_<v>_aarch64.app.tar.gz（+ .sig）
node scripts/make-update-manifest.mjs --version 0.1.0 --notes "更新说明" \
  --target darwin-aarch64 \
  --file src-tauri/target/release/bundle/macos/CosBox_0.1.0_aarch64.app.tar.gz
# 输出 JSON 存到 https://cosbox.benng.cc/updates/darwin-aarch64/latest.json
```

`scripts/make-update-manifest.mjs` 已经支持 `--target` 参数，不用改代码。
**未公证的 macOS 包用户打不开**（Gatekeeper 拦截，提示"已损坏"或"无法验证开发者"），
所以 macOS 自托管分发必须做公证。

## 7. 构建前必须改的代码（pre-flight checklist）

下面 6 条是现在就会让 iOS 版出问题的地方，按优先级排列。**先改完这些再谈打包**，
否则打出来的 iOS 包界面是错的、导出是坏的。

1. **平台识别只认 Android → iOS 会被当成桌面端（必修）**
   `src/routes/+page.svelte:156`：`const tauriDesktop = isTauri() && !navigator.userAgent.includes('Android')`。
   iPhone/iPad 的 UA 里没有 "Android"，于是 iOS 上会渲染桌面自定义标题栏与
   最小化/最大化/关闭按钮（iOS 根本没有窗口概念），同时移动端抽屉导航的判断也乱。
   应改成"移动端 = Android || iOS"，建议抽一个 `src/lib/platform/detect.ts`
   统一提供 `isTauriMobile()`（UA 匹配 `Android|iPhone|iPad|iPod`），三处共用。

2. **导出/下载在 iOS 上会静默失败（必修）**
   `src/lib/utils/download.ts:47` 的 `isAndroidTauri()` 同样只认 "Android"，
   iOS 走浏览器式 Blob 下载，而 WKWebView 基本不落盘 → 用户点导出没反应。
   Rust 侧 `src-tauri/src/lib.rs` 的 `save_to_downloads` 在非 Android 平台直接返回错误。
   两条路：① 写 iOS 版原生保存（对应 `android_save.rs`，用 `UIDocumentPicker` /
   文件 App 分享）；② 短期先在 iOS 上隐藏导出入口并给出提示，别留个点了没反应的按钮。

3. **iOS 上点"检查更新"会抛错（必修）**
   `src/lib/platform/updater.ts` 只判断 `isTauri()` 就 `import('@tauri-apps/plugin-updater')`，
   而该插件按 `Cargo.toml` 的 `cfg(desktop)` 只在桌面端注册 → iOS 上必然报错。
   「设置 → 关于」的更新入口要按平台 gate（仅 Windows / macOS 显示）。
   Rust 侧与 `capabilities/desktop.json` 的 `platforms` 限定是对的，不用动。

4. **IndexedDB 在 iOS WKWebView 有被回收的风险（上线前必须真机验证）**
   与 PACKAGING.md 已记录的 Android 同类问题。D103 规划的 `WorkspaceStore` 端口
   （打包版改 `tauri-plugin-sql` / SQLite）至今未实现，离线优先的应用在 iOS 上
   数据被系统清掉是致命问题。验证方法：真机装包 → 建工作区写数据 → 杀进程、
   隔一天再开 → 数据还在才算过。

5. **明文 http（局域网 Ollama / LiteLLM）需实测确认**
   打包版的 LLM/搜索请求走 Rust `reqwest`（`tauri-plugin-http`），不经 WebView，
   按理应不受 iOS ATS（App Transport Security）限制。但必须在真机上实测一次；
   若确实被拦，在 `src-tauri/Info.plist`（Tauri 会自动合并同目录的 `Info.plist`）里加
   `NSAppTransportSecurity` 例外。

6. **iOS 能力集可以收窄（可选）**
   `capabilities/default.json` 没有 `platforms` 字段 → 对 iOS 全量生效，其中
   `core:window:allow-minimize` 等窗口权限在 iOS 无意义。可以拆一个 `mobile.json`
   只留 `core:default` + `http`，顺手把攻击面收小。

## 8. 落地顺序

| 阶段 | 时机             | 要做的事                                                                                                                                |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 现在             | 什么都不做。本文件就是产出物                                                                                                            |
| 1    | 产品功能基本稳定 | 改 §7 的 1–3 条；落 `apple.yml` 但**只跑 `ios-nosign`**（不需要 Apple 账号，验证 iOS 能编译过、Rust 代码没有桌面/Android 专属依赖泄漏） |
| 2    | 决定做 iOS 分发  | 注册 Apple Developer Program → 生成并提交 `gen/apple`（§4.1）→ 配 Secrets → 出 Ad Hoc 包给内测成员                                      |
| 3    | 内测稳定         | 改 §7 的 4–5 条并真机验证 → 上 TestFlight                                                                                               |
| 4    | 同期或稍后       | macOS：`--target aarch64-apple-darwin` → 签名 + 公证 → `.dmg` 自托管 + darwin updater 清单（§6）。macOS 比 iOS 简单得多，可优先做       |

## 9. 已知坑与待验证清单

- 私有仓库 macOS 额度 10 倍计费，Free 计划每月约 200 分钟 → 每次构建都要
  `timeout-minutes` + `concurrency`，别在 push 上挂自动触发。
- 第一次构建会下载 Xcode 相关组件与全部 Cargo 依赖，慢是正常的；配好
  `Swatinem/rust-cache` 后第二次起明显变快。
- `createUpdaterArtifacts: true` 是**全局配置**：macOS 构建若不注入
  `TAURI_SIGNING_PRIVATE_KEY` 会直接失败（不是警告）。iOS 构建不受影响
  （移动端不产 updater 工件）。
- 当前 updater 私钥是**空密码**加密的，secret 值要留空字符串，别不设
  （见 PACKAGING.md「签名密钥」）。
- `macos-15` 是 arm64 运行器，默认只出 Apple Silicon 包；要覆盖 Intel Mac
  得加 `--target universal-apple-darwin`（两个 Rust target 都要装，编译时间翻倍）。
- 运行器标签（`macos-15` / `macos-latest`）随 GitHub 政策变化，落地前查一下当前可用列表。
- `gen/apple/` 一旦提交，就别在 CI 里再跑 `tauri ios init`（会覆盖 Xcode 侧的手改配置）。
- 版本号仍按 PACKAGING.md 的四处同步规则维护；iOS 另有构建号，需要时用
  `tauri ios build --build-number <n>`（对应 `CFBundleVersion`），Ad Hoc/TestFlight
  同一版本号重复上传会被拒，必须递增构建号。
