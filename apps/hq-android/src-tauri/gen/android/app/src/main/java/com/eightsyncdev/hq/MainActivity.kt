package com.eightsyncdev.hq

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Android 15+ forces edge-to-edge and the HQ web UI does not pad for system
    // bars, the display cutout or the keyboard: pad the content view instead, so
    // HQ sits between the bars and its chat input stays above the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // No white flash before a page paints: show the theme's window background
  // (HQ light/dark) through the WebView until content arrives.
  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(Color.TRANSPARENT)
  }
}
