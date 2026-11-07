// Embedded asset bundle: configs, skills, wallpaper URL list
use rust_embed::RustEmbed;
use std::path::Path;

#[derive(RustEmbed)]
#[folder = "../../assets/"]
pub struct Assets;

// Embedded `8sync harness web` dashboard (Vite build → web/dist/). Built by
// build.rs; if absent, build.rs writes a stub index.html so this still compiles.
// Gated with the dashboard itself: without `web` the 1.9 MB dist tree is neither
// built nor embedded, and no JS toolchain is needed to compile 8sync.
#[cfg(feature = "web")]
#[derive(RustEmbed)]
#[folder = "../../web/dist/"]
pub struct WebAssets;

/// Binary-safe embedded web file (JS/CSS/html). None only if the path doesn't
/// exist in the embedded dist tree.
#[cfg(feature = "web")]
pub fn web_asset(path: &str) -> Option<Vec<u8>> {
    Some(WebAssets::get(path)?.data.into_owned())
}

pub fn read(path: &str) -> Option<String> {
    let f = Assets::get(path)?;
    String::from_utf8(f.data.into_owned()).ok()
}

/// Raw embedded asset bytes — for binary assets (e.g. PNG wallpapers).
pub fn read_bytes(path: &str) -> Option<Vec<u8>> {
    Some(Assets::get(path)?.data.into_owned())
}

/// Write embedded asset to target path. If target exists and differs, back it up.
pub fn install(path: &str, target: &std::path::Path, force: bool) -> anyhow::Result<bool> {
    use std::fs;
    let content = read(path).ok_or_else(|| anyhow::anyhow!("asset missing: {}", path))?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    if target.exists() && !force {
        let existing = fs::read_to_string(target).unwrap_or_default();
        if existing == content {
            return Ok(false); // unchanged
        }
        let bak = target.with_extension(format!(
            "{}.bak",
            target.extension().and_then(|s| s.to_str()).unwrap_or("orig")
        ));
        fs::rename(target, &bak)?;
    }
    fs::write(target, content)?;
    #[cfg(unix)]
    if target.extension().and_then(|s| s.to_str()) == Some("sh") {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(target)?.permissions();
        perms.set_mode(0o755);
        let _ = fs::set_permissions(target, perms);
    }
    Ok(true)
}

/// Iterate every embedded asset path that begins with `prefix`. Returns full
/// asset paths (suitable for `read`/`install`), not paths relative to `prefix`.
pub fn iter_under(prefix: &str) -> Vec<String> {
    Assets::iter()
        .filter(|p| p.starts_with(prefix))
        .map(|p| p.into_owned())
        .collect()
}

/// Every text asset under `asset_prefix` as (path relative to it, body as deployed): command refs in
/// `.md`/`.txt` prose rebranded (identity on the default build), other text verbatim; binary assets
/// (PNGs, …) left out.
pub fn tree(asset_prefix: &str) -> Vec<(String, String)> {
    let prefix = if asset_prefix.ends_with('/') { asset_prefix.to_string() } else { format!("{asset_prefix}/") };
    iter_under(&prefix)
        .into_iter()
        .filter_map(|asset_path| {
            let rel = asset_path[prefix.len()..].to_string();
            let body = read(&asset_path).filter(|_| !rel.is_empty())?;
            let body = if rel.ends_with(".md") || rel.ends_with(".txt") { crate::brand::render(&body).into_owned() } else { body };
            Some((rel, body))
        })
        .collect()
}

/// Write one deployed file, its folders first; `.sh` gets mode 0755 on unix.
pub fn write_text(target: &Path, body: &str) -> anyhow::Result<()> {
    use std::fs;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, body)?;
    #[cfg(unix)]
    if target.extension().and_then(|s| s.to_str()) == Some("sh") {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(target)?.permissions();
        perms.set_mode(0o755);
        let _ = fs::set_permissions(target, perms);
    }
    Ok(())
}

/// Deploy every asset under `asset_prefix` into `target_dir`, preserving the
/// relative subtree. Returns (written, unchanged) counts. Backups are NOT
/// created and edits are not looked at: for explicit installs (`skill add`,
/// `skill update`). The bundled skills go through `skill::deploy::refresh_bundled`.
pub fn install_tree(asset_prefix: &str, target_dir: &Path) -> anyhow::Result<(usize, usize)> {
    let mut written = 0usize;
    let mut unchanged = 0usize;
    for (rel, body) in tree(asset_prefix) {
        let target = target_dir.join(&rel);
        if target.exists() && std::fs::read_to_string(&target).is_ok_and(|prev| prev == body) {
            unchanged += 1;
        } else {
            write_text(&target, &body)?;
            written += 1;
        }
    }
    Ok((written, unchanged))
}
