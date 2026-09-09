# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# Rust 侧通过 JNI 按名称调用 CosBoxBridge.getAppContext()（导出文件到下载目录），
# 防止 R8 混淆/裁剪导致 JNI 查找失败。
-keep class cc.benng.cosbox.CosBoxBridge {
    public static android.content.Context getAppContext();
}

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile