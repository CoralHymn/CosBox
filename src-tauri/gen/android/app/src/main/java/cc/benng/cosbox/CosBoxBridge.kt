package cc.benng.cosbox

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri

/**
 * 进程启动时由系统自动实例化（见 AndroidManifest.xml 中的 provider 声明），
 * 把 Application Context 保存下来，供 Rust 侧通过 JNI 调用 [getAppContext] 取得，
 * 用于把导出文件写入系统「下载」目录。
 *
 * Tauri v2 运行时不再初始化 ndk-context，Rust 无法直接取得 Context，
 * 这里充当 Kotlin 与 Rust 之间的桥梁。
 */
class CosBoxBridge : ContentProvider() {
  companion object {
    @Volatile
    private var appContext: Context? = null

    /** Rust 侧通过 JNI 按名称调用（保持方法名与 proguard-rules.pro 同步）。 */
    @JvmStatic
    fun getAppContext(): Context? = appContext
  }

  override fun onCreate(): Boolean {
    appContext = context?.applicationContext
    return true
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = 0
}
