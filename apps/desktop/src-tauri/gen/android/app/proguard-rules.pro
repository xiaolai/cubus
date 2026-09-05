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

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# The insets bridge (MainActivity.InsetsBridge) is reached from JavaScript by name, as
# `window.cubusInsets.get()`. R8 keeps @JavascriptInterface members by the default rules, but the
# contract with app.js is worth stating where a rule change would be noticed.
-keepclassmembers class im.cubus.app.MainActivity$InsetsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
