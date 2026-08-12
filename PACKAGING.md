# 打包指南（Tauri 2）

CosBox 以 SvelteKit 纯静态 SPA 为唯一代码库，Windows 与 Android 双端用
Tauri 2 薄壳封装（系统 WebView）。本文件记录环境要求、常用命令与已知坑。

## 环境要求

| 组件 | 要求 | 本机状态（2026-08-11） |
| --- | --- | --- |
| Node.js | ≥ 20 | v24.13.1 ✅ |
| Rust | stable（≥ 1.77.2） | 1.97.1 ✅ |
| MSVC C++ Build Tools | VS2022 + Windows SDK | ✅ |
| WebView2 Runtime | Windows 10/11 自带或自动安装 | 151.x ✅ |
| JDK | 17+（Gradle 兼容） | Microsoft OpenJDK 21 ✅ |
| Android SDK | platform-tools / platforms;android-36 / build-tools;36.0.0 / NDK 27.x | `D:\Android\Sdk` ✅ |
| Rust Android targets | aarch64 / armv7 / i686 / x86_64-linux-android | 全齐 ✅ |

环境变量（用户级）：`ANDROID_HOME=D:\Android\Sdk`、
`NDK_HOME=D:\Android\Sdk\ndk\27.1.12297006`、
`JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.8.9-hotspot`。

## 常用命令

```bash
npm run tauri dev          # Windows 桌面开发壳（自动起 Vite dev server）
npm run tauri build        # Windows 发布构建：NSIS 安装包 + MSI
npm run tauri android dev  # Android 开发（adb 有设备时）
npm run tauri android build# Android 发布构建：APK / AAB
```

产物位置：

- Windows：`src-tauri/target/release/bundle/`
- Android：`src-tauri/gen/android/app/build/outputs/`

## 模拟器测试（MuMu 12）

MuMu 是第三方模拟器，Tauri CLI 的设备发现偏向官方 AVD（serial 以
`emulator-` 开头），因此优先走手动 adb 路径：

```bash
# 1. 启动 MuMu 12，查看其 ADB 端口（默认 16384，多开 +32）
adb connect 127.0.0.1:16384
adb devices

# 2. 构建 x86_64 变体（MuMu 是 x86_64 系统；Tauri 默认 armDebug
#    split APK 在 x86_64 设备上不可用，见 tauri issue #14168）
npm run tauri android build   # 产物含 x86_64 变体后手动安装
adb install <app>-x86_64-debug.apk

# 3. 调试时把模拟器内 localhost 转发到电脑上的 Vite dev server
adb reverse tcp:1420 tcp:1420
```

`tauri android dev` 若能识别设备也可直接使用；识别不到就用上面手动路径兜底。
真机调试走 USB 即可，`tauri android dev` 官方原生支持。

## 架构约定（D103）

- Web 层保持唯一代码库；打包专属逻辑进 `src/lib/platform/` 适配层（尚未实现）：
  - `WorkspaceStore` 端口：Web = Dexie；打包版 = `tauri-plugin-sql`（SQLite）。
  - `FilePort` 端口：Web = Blob 下载；Windows = 对话框；Android = SAF / share。
  - `llmFetch` 注入：打包版用 `tauri-plugin-http`，把 `/llm-proxy/` 还原为
    `https://opencode.ai/`（见 D99：opencode.ai 不允许浏览器 CORS）。
- Node 同步服务器（`server/`）不进安装包，独立部署。

## 版本与自动更新（Updater）

### 版本号

SemVer（xyz）。当前 `0.0.1`（测试版）。升级时四处保持一致：

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`
- `src/lib/platform/updater.ts` → `APP_VERSION`（前端展示用）

### 更新机制

采用官方 `tauri-plugin-updater`（仅桌面端；Android/iOS 走应用商店渠道）。
更新清单为静态 JSON，端点（见 `tauri.conf.json` 的 `plugins.updater`）：

```
https://cosbox.benng.cc/updates/{{target}}/{{arch}}/latest.json
```

发布新版流程：

1. 修改版本号（见上），设置签名环境变量后构建：

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = "E:\code\github\CosBox\src-tauri\.keys\cosbox.key"
   npm run tauri build
   ```

   `createUpdaterArtifacts: true` 会在
   `src-tauri/target/release/bundle/nsis/` 下额外生成
   `CosBox_<v>_x64-setup.exe.sig`（更新包签名）。

2. 把安装包上传到 `https://cosbox.benng.cc/releases/`。

3. 生成更新清单并部署：

   ```bash
   node scripts/make-update-manifest.mjs --version 0.0.2 --notes "更新说明" `
     --file src-tauri/target/release/bundle/nsis/CosBox_0.0.2_x64-setup.exe
   ```

   把脚本输出的 JSON 保存到
   `https://cosbox.benng.cc/updates/windows-x86_64/latest.json`。

4. 客户端在「设置 → 关于」手动检查（启动时也会静默检查一次），
   签名校验通过后下载安装并自动重启。

### 签名密钥

- 私钥：`src-tauri/.keys/cosbox.key`（已 gitignore，**严禁提交**；
  丢失将无法再向已发布版本推送更新，务必备份到安全位置）。
- 公钥：已内嵌在 `tauri.conf.json` 的 `plugins.updater.pubkey`，随二进制分发。
- 重新生成（会作废已发布版本的升级通道，通常不要动）：
  `npm run tauri signer generate -- -w src-tauri/.keys/cosbox.key -p ""`。

### 已知坑

- updater 强制签名校验，无法关闭；未签名或密钥不匹配的清单会被客户端拒绝。
- Windows 安装模式 `passive`：安装时出现短暂进度窗口，无需用户交互。
- `{{current_version}}` 变量可用于服务端按版本判断，当前用固定
  `latest.json` 简化静态托管。

## 已知坑

- `/llm-proxy` 只在 `npm run dev` / `preview` 生效；打包版无 Vite 后端，必须
  经 `llmFetch` 还原为绝对端点（D103）。
- Android 9+ 默认禁明文 http；debug 构建已开 `usesCleartextTraffic`，release
  关闭——局域网 Ollama / LiteLLM 仅限开发期。
- 模拟器里 `localhost` 指向模拟器自身；访问电脑上的服务需用局域网 IP 或
  `adb reverse`。
- Android WebView 的 IndexedDB 有清数据 / 更新丢失风险，打包版应迁移 SQLite。

## 发布待办（功能开发完成后）

1. 应用图标：`npx tauri icon <1024px 源图>`。
2. Android release 签名：生成 keystore，写入
   `src-tauri/gen/android/key.properties`（已 gitignore）。
3. 自动更新：已接入（见上「版本与自动更新」）；首次发布需按流程上传安装包与清单。
4. 首次 Android 构建会联网下载 Gradle / AGP 依赖（2–3 GB），耐心等待。
