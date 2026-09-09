# Android 签名配置（内测分发用）

签名 = 给 APK 盖一个"你的专属章"。团队成员安装、以及以后所有升级都必须用
同一把签名，所以 **keystore 和密码是命根子，丢失 = 老用户永远无法升级**。

## 你需要准备的信息

生成时 keytool 会问以下内容，都是**公开的证书展示信息**，可以填公司/团队信息：

| keytool 字段 | 含义 | 建议填写 |
| --- | --- | --- |
| `-storepass` / `-keypass` | keystore 密码 / key 密码 | **自己设**，记到密码管理器，别告诉别人 |
| `CN` | 姓名 / 通用名 | 你的名字或 CosBox |
| `OU` | 组织单位 | 研发部 / Dev Team |
| `O` | 组织（公司） | 你的公司名或团队名 |
| `L` | 城市 | 比如 深圳 |
| `ST` | 省份 | 比如 广东 |
| `C` | 国家代码 | `CN` |

（"地址公司之类"就是指 O / L / ST 这几个字段，随便填真实信息即可，证书里
能看到，但**不参与安全校验**——真正保命的是密码。）

## 第一步：生成 keystore（本地，不要用网页工具）

在 PowerShell 里进入：

```powershell
cd E:\code\github\CosBox\src-tauri\gen\android\app
```

运行（把 `你的密码` 换成你自己设的密码）：

```powershell
keytool -genkeypair -v -keystore cosbox-release.keystore `
  -alias cosbox -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass 你的密码 -keypass 你的密码 `
  -dname "CN=CosBox, OU=DevTeam, O=你的公司, L=深圳, ST=广东, C=CN"
```

生成成功后目录里会多出 `cosbox-release.keystore`。

**立刻备份**：把 `.keystore` 文件 + 密码复制到 U 盘 / 密码管理器。丢一次，
内测用户以后升级全部失败，只能换包名重来。

## 第二步：填写 key.properties

在 `src-tauri\gen\android\app\` 下新建 `key.properties`（已 gitignore，不会进
git），内容：

```properties
storeFile=cosbox-release.keystore
storePassword=你的密码
keyAlias=cosbox
keyPassword=你的密码
```

`build.gradle.kts` 已接好签名逻辑：检测到 `key.properties` 存在就自动对
release 包签名；不存在则保持不签名，不影响开发。

## 第三步：构建内测包

```powershell
cd E:\code\github\CosBox
npm run tauri android build -- --target aarch64
```

产物（已签名，可直接安装）：

```
src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk
```

把 APK 发给成员（微信 / 网盘 / 飞书都行），对方安装时允许"未知来源"即可。

## 升级与注意事项

- 团队成员升级内测版：直接发新 APK 覆盖安装，**同一把 key 才能覆盖成功**。
- 真机基本是 arm64，用上面的 `--target aarch64` 即可；如果成员用 x86_64
  模拟器，需要 `--target x86_64` 再出一个包。
- 发布测试包前把版本号在 `src-tauri\gen\android\app\tauri.properties` 里递增
  （`tauri.android.versionCode` / `versionName`），否则部分机型可能拒绝覆盖。
