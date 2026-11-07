//! 8 Sync HQ for Android: a Rust (Tauri 2) shell around the system WebView.
//!
//! The bundled connect screen (`../ui`) asks for the owner's HQ address; this
//! crate validates it and navigates the WebView there from Rust, so opening HQ
//! never depends on the WebView's link policy. HQ itself (the responsive
//! Next.js UI served by `8sync hq ui` on the owner's PC) keeps its own auth:
//! the app stores no token and HQ pages get no Tauri IPC (see
//! `capabilities/default.json`, scoped to the local connect screen only).

use tauri::{Url, Webview};

/// Turn what the owner typed or pasted into the URL to open.
///
/// Accepts `https://<machine>.<tailnet>.ts.net` (`8sync hq ui --tailnet`), a
/// `--public` login link (`https://….trycloudflare.com/?k=…`, kept whole so HQ
/// can log in) or a `--tunnel-setup` hostname; a missing scheme means `https`.
/// HTTPS only: `8sync hq ui` listens on the PC's 127.0.0.1, so the phone can
/// only reach it through the tailnet or a tunnel, both HTTPS — a plain `http://`
/// address could never be HQ and would send the session unencrypted.
pub fn hq_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Nhập địa chỉ HQ trước đã.".into());
    }
    let url = if input.contains("://") {
        Url::parse(input)
    } else {
        Url::parse(&format!("https://{input}"))
    }
    .map_err(|_| format!("“{input}” không phải địa chỉ hợp lệ."))?;

    match url.scheme() {
        "https" => {}
        "http" => {
            return Err(
                "HQ chỉ mở qua https://. Trên PC chạy `8sync hq ui --tailnet` (Tailscale) hoặc `8sync hq ui --public`."
                    .into(),
            )
        }
        _ => return Err("Chỉ mở được địa chỉ https://.".into()),
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("Địa chỉ thiếu tên máy (host).".into());
    }
    Ok(url)
}

/// Origin (scheme + host + port) of a valid HQ address, for the connect
/// screen's "recent" list: the path and the `?k=` login token are dropped, so
/// they are never stored.
#[tauri::command]
fn hq_origin(address: String) -> Result<String, String> {
    Ok(hq_url(&address)?.origin().ascii_serialization())
}

/// Open HQ in this WebView, from Rust (independent of the WebView's link policy).
#[tauri::command]
fn open_hq(webview: Webview, address: String) -> Result<(), String> {
    let url = hq_url(&address)?;
    webview.navigate(url).map_err(|e| format!("Không mở được HQ: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![hq_origin, open_hq])
        .run(tauri::generate_context!())
        .expect("error while running 8 Sync HQ");
}

#[cfg(test)]
mod tests {
    use super::hq_url;

    fn ok(input: &str) -> String {
        hq_url(input).unwrap_or_else(|e| panic!("{input}: {e}")).to_string()
    }

    #[test]
    fn accepts_tailnet_tunnel_and_public_login_links() {
        assert_eq!(ok("https://pc.tail1234.ts.net"), "https://pc.tail1234.ts.net/");
        assert_eq!(ok("  pc.tail1234.ts.net "), "https://pc.tail1234.ts.net/");
        assert_eq!(ok("hq.example.com/"), "https://hq.example.com/");
        assert_eq!(
            ok("https://abc-def.trycloudflare.com/?k=s3cr3t"),
            "https://abc-def.trycloudflare.com/?k=s3cr3t"
        );
    }

    #[test]
    fn refuses_cleartext_and_non_web_schemes() {
        for bad in [
            "",
            "   ",
            "http://192.168.1.5:8740",
            "http://example.com",
            "file:///sdcard/x.html",
            "javascript:alert(1)",
            "intent://scan/#Intent;end",
            "https://",
        ] {
            assert!(hq_url(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn origin_drops_path_and_token() {
        let url = hq_url("https://abc.trycloudflare.com/rooms/x?k=s3cr3t#y").unwrap();
        assert_eq!(url.origin().ascii_serialization(), "https://abc.trycloudflare.com");
        let url = hq_url("https://pc.tail1234.ts.net:8443/?k=1").unwrap();
        assert_eq!(url.origin().ascii_serialization(), "https://pc.tail1234.ts.net:8443");
    }
}
