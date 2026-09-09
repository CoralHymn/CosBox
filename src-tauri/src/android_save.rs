//! Android 原生文件保存：把导出文件写入系统公共「下载」目录。
//! - API 29+：通过 MediaStore.Downloads 创建条目并写 OutputStream（无需存储权限）。
//! - API < 29：写入应用专属外部 Download 目录（Android/data/<包名>/files/Download）。
//! - 上下文来源：Tauri v2 运行时不再初始化 ndk-context（旧实现直接调用
//!   `ndk_context::android_context()` 会 panic 导致闪退）。这里改为：
//!   - `JNI_OnLoad` 保存进程级 JavaVM，并预热桥接类的全局引用
//!     （在后台线程上 FindClass 只能拿到系统类，应用类必须用启动时缓存的引用）；
//!   - Kotlin 侧 `CosBoxBridge`（ContentProvider 在进程启动时注册 Application Context）
//!     提供 `getAppContext()`。
//! 仅在 Android 目标上编译（依赖见 Cargo.toml 的 target 依赖）。

#![cfg(target_os = "android")]

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use jni::objects::{GlobalRef, JObject, JString, JValue};
use jni::sys::jint;
use jni::{JNIEnv, JavaVM};
use std::ffi::c_void;
use std::sync::OnceLock;

/// Kotlin 侧桥接类的 JNI 路径。应用标识符来自 tauri.conf.json，由 build.rs
/// 通过 `COSBOX_ANDROID_IDENTIFIER` 环境变量注入，保证与打包配置同步。
const BRIDGE_CLASS_NAME: &str = concat!(env!("COSBOX_ANDROID_IDENTIFIER"), "/CosBoxBridge");

/// 进程级 JavaVM，由 JNI_OnLoad 保存。
static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();

/// 桥接类（CosBoxBridge）的全局引用，JNI_OnLoad 时预热。
static BRIDGE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

/// Android 运行时加载 app_lib 时回调：保存 JavaVM 并预热桥接类。
/// 预热失败不影响应用启动（导出时按需重试），也绝不在这里 panic。
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint {
  // safety：vm 由 Android 运行时传入，进程生命周期内有效。
  if let Ok(vm) = unsafe { JavaVM::from_raw(vm) } {
    if let Ok(mut env) = vm.attach_current_thread() {
      let _ = bridge_class(&mut env);
    }
    let _ = JAVA_VM.set(vm);
  }
  jni::sys::JNI_VERSION_1_6
}

/// 取得 CosBoxBridge 类的全局引用（优先使用 JNI_OnLoad 预热的缓存）。
fn bridge_class(env: &mut JNIEnv) -> Result<GlobalRef, String> {
  if let Some(class) = BRIDGE_CLASS.get() {
    return Ok(class.clone());
  }
  let class = env
    .find_class(BRIDGE_CLASS_NAME)
    .map_err(|err| format!("找不到桥接类 {BRIDGE_CLASS_NAME}：{err}"))?;
  let global = env.new_global_ref(&class).map_err(|err| err.to_string())?;
  let _ = BRIDGE_CLASS.set(global.clone());
  Ok(global)
}

/// 取应用 Application Context（Kotlin 侧 CosBoxBridge.getAppContext()）。
/// 返回的 JObject 与 JNIEnv 的局部引用帧（'local）绑定，不占用 env 的可变借用，
/// 因此调用方可以继续使用 &mut env。
fn app_context<'local>(env: &mut JNIEnv<'local>) -> Result<JObject<'local>, String> {
  let class = bridge_class(env)?;
  let context = env
    .call_static_method(&class, "getAppContext", "()Landroid/content/Context;", &[])
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  if context.is_null() {
    return Err("应用上下文尚未初始化（CosBoxBridge 未注册）".to_string());
  }
  Ok(context)
}

/// 把 bytes（base64，由前端编码以规避 IPC 超大 JSON 数组）写入系统「下载」目录，
/// 返回保存位置（content:// URI 或完整路径）。
pub fn save_to_downloads(filename: &str, mime: &str, bytes_base64: &str) -> Result<String, String> {
  let vm = JAVA_VM
    .get()
    .ok_or_else(|| "JavaVM 尚未初始化（app_lib 未加载）".to_string())?;
  let bytes = BASE64
    .decode(bytes_base64)
    .map_err(|err| format!("导出内容解码失败：{err}"))?;
  // Android 文件系统/MediaStore 不接受 \ / : * ? " < > | 与控制字符，
  // 角色名等用户内容可能包含这些字符，先替换掉，避免 insert 抛异常。
  let filename = sanitize_filename(filename);
  // AttachGuard 仅在确实由本线程 attach 时才 detach；已在 Java 线程上时安全复用。
  let mut env = vm.attach_current_thread().map_err(|err| err.to_string())?;
  let context = app_context(&mut env)?;
  let result = if sdk_int(&mut env)? >= 29 {
    // MediaStore 写公共「下载」目录；部分厂商 ROM 会拒绝 insert/openOutputStream，
    // 失败时清除 pending 的 Java 异常并回落应用专属目录，保证导出始终可用。
    match save_via_mediastore(&mut env, &context, &filename, mime, &bytes) {
      Ok(saved) => Ok(saved),
      Err(media_err) => {
        // 必须先把 Java 异常读出并清除，否则后续 JNI 调用都会直接失败。
        let detail = take_exception(&mut env);
        save_to_app_external_dir(&mut env, &context, &filename, &bytes).map_err(|fallback_err| {
          format!("{media_err}（{detail}）；回落保存到应用目录也失败：{fallback_err}")
        })
      }
    }
  } else {
    save_to_app_external_dir(&mut env, &context, &filename, &bytes)
  };
  // JNI 失败后可能残留 Java 异常，读出并清除，避免污染后续调用。
  if result.is_err() {
    take_exception(&mut env);
  }
  result
}

/// 替换文件名中的非法字符（\ / : * ? " < > | 与控制字符），
/// 避免 MediaStore insert 抛异常或 API < 29 路径拼接逃逸目录。
fn sanitize_filename(filename: &str) -> String {
  filename
    .chars()
    .map(|ch| {
      if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
        '_'
      } else {
        ch
      }
    })
    .collect()
}

/// 读取 Build.VERSION.SDK_INT。
fn sdk_int(env: &mut JNIEnv) -> Result<jint, String> {
  let version = env
    .find_class("android/os/Build$VERSION")
    .map_err(|err| err.to_string())?;
  let field = env
    .get_static_field(&version, "SDK_INT", "I")
    .map_err(|err| err.to_string())?;
  field.i().map_err(|err| err.to_string())
}

/// API 29+：MediaStore 写入公共下载目录（resolver.insert 创建条目 + OutputStream 写内容）。
fn save_via_mediastore(
  env: &mut JNIEnv,
  context: &JObject,
  filename: &str,
  mime: &str,
  bytes: &[u8],
) -> Result<String, String> {
  // resolver = context.getContentResolver()
  let resolver = env
    .call_method(
      context,
      "getContentResolver",
      "()Landroid/content/ContentResolver;",
      &[],
    )
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;

  // values = new ContentValues()；写入展示名/类型/相对路径（Download 目录）
  let values_class = env
    .find_class("android/content/ContentValues")
    .map_err(|err| err.to_string())?;
  let values = env
    .new_object(&values_class, "()V", &[])
    .map_err(|err| err.to_string())?;
  for (key, value) in [
    ("_display_name", filename),
    ("mime_type", mime),
    ("relative_path", "Download"),
  ] {
    let j_key = env.new_string(key).map_err(|err| err.to_string())?;
    let j_value = env.new_string(value).map_err(|err| err.to_string())?;
    env.call_method(
      &values,
      "put",
      "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/ContentValues;",
      &[JValue::Object(&j_key), JValue::Object(&j_value)],
    )
    .map_err(|err| err.to_string())?;
  }

  // uri = MediaStore.Downloads.EXTERNAL_CONTENT_URI
  let downloads_class = env
    .find_class("android/provider/MediaStore$Downloads")
    .map_err(|err| err.to_string())?;
  let uri = env
    .get_static_field(&downloads_class, "EXTERNAL_CONTENT_URI", "Landroid/net/Uri;")
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;

  // inserted = resolver.insert(uri, values)
  let inserted = env
    .call_method(
      &resolver,
      "insert",
      "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;",
      &[JValue::Object(&uri), JValue::Object(&values)],
    )
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  if inserted.is_null() {
    return Err("无法在下载目录创建文件".to_string());
  }

  // os = resolver.openOutputStream(inserted)
  let os = env
    .call_method(
      &resolver,
      "openOutputStream",
      "(Landroid/net/Uri;)Ljava/io/OutputStream;",
      &[JValue::Object(&inserted)],
    )
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  if os.is_null() {
    return Err("无法打开下载文件的输出流".to_string());
  }

  // os.write(bytes); os.close()
  let jbytes = env
    .byte_array_from_slice(bytes)
    .map_err(|err| err.to_string())?;
  env.call_method(&os, "write", "([B)V", &[JValue::Object(jbytes.as_ref())])
    .map_err(|err| err.to_string())?;
  env.call_method(&os, "close", "()V", &[])
    .map_err(|err| err.to_string())?;

  // 返回 content:// URI 供前端展示
  let uri_str = env
    .call_method(&inserted, "toString", "()Ljava/lang/String;", &[])
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  let uri_str = JString::from(uri_str);
  let location = env.get_string(&uri_str).map_err(|err| err.to_string())?;
  Ok(location.to_string_lossy().to_string())
}

/// API < 29 兜底：写入应用专属外部 Download 目录（无需权限），返回完整路径。
fn save_to_app_external_dir(
  env: &mut JNIEnv,
  context: &JObject,
  filename: &str,
  bytes: &[u8],
) -> Result<String, String> {
  let j_download = env.new_string("Download").map_err(|err| err.to_string())?;
  let dir = env
    .call_method(
      context,
      "getExternalFilesDir",
      "(Ljava/lang/String;)Ljava/io/File;",
      &[JValue::Object(&j_download)],
    )
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  if dir.is_null() {
    return Err("无法获取外部存储目录".to_string());
  }
  let abs = env
    .call_method(&dir, "getAbsolutePath", "()Ljava/lang/String;", &[])
    .and_then(|value| value.l())
    .map_err(|err| err.to_string())?;
  let abs = JString::from(abs);
  let dir_path = env.get_string(&abs).map_err(|err| err.to_string())?;
  let dir_path = dir_path.to_string_lossy().to_string();

  let full = std::path::Path::new(&dir_path).join(filename);
  std::fs::write(&full, bytes).map_err(|err| err.to_string())?;
  Ok(full.to_string_lossy().to_string())
}

/// 读取并清除 pending 的 Java 异常，返回可读信息。
fn take_exception(env: &mut JNIEnv) -> String {
  let message = env
    .exception_occurred()
    .ok()
    .and_then(|throwable| {
      if throwable.is_null() {
        return None;
      }
      env.call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .ok()
    })
    .and_then(|str_obj| {
      env.get_string(&JString::from(str_obj))
        .ok()
        .map(|string| string.to_string_lossy().to_string())
    })
    .unwrap_or_else(|| "未知 Java 异常".to_string());
  let _ = env.exception_clear();
  message
}
