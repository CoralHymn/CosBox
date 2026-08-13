#[cfg(target_os = "android")]
mod android_save;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
#[tauri::command]
fn save_to_downloads(filename: String, mime: String, bytes: Vec<u8>) -> Result<String, String> {
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
