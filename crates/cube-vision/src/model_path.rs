//! Where the bundled model is, resolved the same way on every native arm.
//!
//! ONE resolver (2026-09-21, audit-fix row 31). `apple.rs` and `windows.rs` each carried a copy of
//! the same two-tier search, differing only in the file name and the error text — so a fix to how
//! the Resource dir is read could reach one platform and miss the other, which is how the Windows
//! copy once searched beside the executable for a file nothing had put there and the whole arm was
//! unreachable code that compiled. The arms keep their own `MODEL_RESOURCE` (the shipped-model test
//! reads it out of each file) and hand this the two candidates.
//!
//! Two tiers, in order: the bundled Resource dir (a shipped app), then the committed source tree
//! (`tauri dev`, which does NOT stage `bundle.resources`, so the resource dir is empty there). The
//! resource dir is tried FIRST so a shipped app never uses the source path — which is the build
//! machine's and would not exist on a user's disk.

use std::path::PathBuf;

/// The model to load: the resource candidate when it exists, else the dev path when it does, else
/// an error naming what was looked for and where.
pub fn resolve(resource: Option<PathBuf>, dev: PathBuf, name: &str) -> Result<PathBuf, String> {
    if let Some(p) = resource {
        if p.exists() {
            return Ok(p);
        }
    }
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!(
        "{name} not found — not in the app Resource dir, and not at {} (run ml/export.py)",
        dev.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cube-vision-model-path-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_resource_dir_wins_when_it_holds_the_model() {
        let dir = scratch("resource");
        let shipped = dir.join("shipped.onnx");
        let dev = dir.join("dev.onnx");
        std::fs::write(&shipped, b"x").unwrap();
        std::fs::write(&dev, b"x").unwrap();
        assert_eq!(
            resolve(Some(shipped.clone()), dev, "cubedet.onnx").unwrap(),
            shipped
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_absent_resource_falls_back_to_the_committed_model() {
        let dir = scratch("dev");
        let dev = dir.join("dev.onnx");
        std::fs::write(&dev, b"x").unwrap();
        assert_eq!(
            resolve(
                Some(dir.join("not-staged.onnx")),
                dev.clone(),
                "cubedet.onnx"
            )
            .unwrap(),
            dev
        );
        assert_eq!(resolve(None, dev.clone(), "cubedet.onnx").unwrap(), dev);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn neither_tier_is_an_error_naming_the_model_and_the_dev_path() {
        let dir = scratch("neither");
        let dev = dir.join("dev.mlpackage");
        let e = resolve(Some(dir.join("gone")), dev.clone(), "cubedet.mlpackage").unwrap_err();
        assert!(e.starts_with("cubedet.mlpackage not found"), "{e}");
        assert!(e.contains(&dev.display().to_string()), "{e}");
        assert!(e.contains("ml/export.py"), "{e}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
