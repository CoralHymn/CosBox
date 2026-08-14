fn main() {
  tauri_build::build();

  // 把应用标识符注入 Rust（Android 端 JNI 桥接类名使用，见 src/android_save.rs），
  // 与 tauri.conf.json 的 identifier 保持同步。
  let config: serde_json::Value = serde_json::from_str(
    &std::fs::read_to_string("tauri.conf.json").expect("缺少 tauri.conf.json"),
  )
  .expect("tauri.conf.json 不是合法 JSON");
  let identifier = config["identifier"]
    .as_str()
    .expect("tauri.conf.json 缺少 identifier");
  println!("cargo:rustc-env=COSBOX_ANDROID_IDENTIFIER={identifier}");
}
