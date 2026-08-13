//! Android 原生文件保存：把导出文件写入系统公共「下载」目录。
//! - API 29+：通过 MediaStore.Downloads 创建条目并写 OutputStream（无需存储权限）。
//! - API < 29：写入应用专属外部 Download 目录（Android/data/<包名>/files/Download）。
//! 仅在 Android 目标上编译（依赖见 Cargo.toml 的 target 依赖）。

#![cfg(target_os = "android")]

use jni::objects::{JObject, JString, JValue};
use jni::sys::jint;
use jni::JNIEnv;

/// 把 bytes 写入系统「下载」目录，返回保存位置（content:// URI 或完整路径）。
pub fn save_to_downloads(filename: &str, mime: &str, bytes: &[u8]) -> Result<String, String> {
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    // safety：Android 运行时提供的 JavaVM / Activity 指针与应用同生命周期，此处仅做指针转换。
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|err| err.to_string())?;
    // AttachGuard 在 drop 时自动 detach；通过 DerefMut 当作 JNIEnv 使用。
    let mut env = vm.attach_current_thread().map_err(|err| err.to_string())?;
    // safety：context 指针来自 ndk_context，由 Android 运行时持有。
    let activity = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let result = if sdk_int(&mut env)? >= 29 {
        save_via_mediastore(&mut env, &activity, filename, mime, bytes)
    } else {
        save_to_app_external_dir(&mut env, &activity, filename, bytes)
    };
    // JNI 失败后可能残留 Java 异常，读出并清除，避免污染后续调用。
    if result.is_err() {
        take_exception(&mut env);
    }
    result
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
    activity: &JObject,
    filename: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<String, String> {
    // resolver = activity.getContentResolver()
    let resolver = env
        .call_method(
            activity,
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
    activity: &JObject,
    filename: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let j_download = env.new_string("Download").map_err(|err| err.to_string())?;
    let dir = env
        .call_method(
            activity,
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
