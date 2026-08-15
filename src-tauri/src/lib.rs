#[cfg(target_os = "android")]
mod android_save;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // HTTP 插件：LLM / 搜索请求从 Rust 侧发出，绕过 WebView CORS（D109）。
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![save_to_downloads])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // 自动更新与重启进程仅桌面端可用（Android/iOS 由应用商店渠道更新）。
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// 把文件写入系统「下载」目录，返回保存位置（content:// URI 或完整路径）。
/// 仅 Android 实现（MediaStore，无需存储权限）；其他平台返回错误（前端只在 Android 调用）。
/// `bytes` 为 base64 编码的二进制内容：TypedArray 经 IPC 会序列化成超长 JSON 数字数组，
/// 大工作区导出会导致 WebView 内存暴涨，因此前端先转成 base64 字符串再传输。
#[tauri::command]
fn save_to_downloads(filename: String, mime: String, bytes: String) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    return android_save::save_to_downloads(&filename, &mime, &bytes);
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (filename, mime, bytes);
    Err("save_to_downloads 仅在 Android 上可用".to_string())
  }
}
