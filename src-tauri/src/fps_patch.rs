//! Linux：通过 LD_PRELOAD 加速 WebKitGTK 的 VBlankMonitor 线程，突破 60fps 上限。
//! 见 scripts/fps-patch/vblank_patch.c。可在启动前设置：
//!   LOOM_DISABLE_VBLANK_PATCH=1  关闭
//!   LOOM_VBLANK_HZ=240           指定目标帧率（默认 200）
//!   LOOM_VBLANK_LIB=/path/x.so   手动指定补丁库

#[cfg(target_os = "linux")]
pub fn maybe_reexec() {
    use std::env;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;

    fn locate() -> Option<PathBuf> {
        if let Some(p) = env::var_os("LOOM_VBLANK_LIB").map(PathBuf::from) {
            if p.is_file() {
                return Some(p);
            }
        }
        let mut candidates = Vec::new();
        if let Ok(exe) = env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("libloom-vblank.so"));
            }
        }
        candidates.push(PathBuf::from("/usr/lib/loom/libloom-vblank.so"));
        if let Some(appdir) = env::var_os("APPDIR").map(PathBuf::from) {
            candidates.push(appdir.join("usr/lib/loom/libloom-vblank.so"));
        }
        candidates.into_iter().find(|p| p.is_file())
    }

    if env::var_os("LOOM_VBLANK_PATCHED").is_some() || env::var_os("LOOM_DISABLE_VBLANK_PATCH").is_some() {
        return;
    }
    let Some(lib) = locate() else { return };
    let Ok(exe) = env::current_exe() else { return };

    let mut preload = env::var_os("LD_PRELOAD").map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
    if !preload.is_empty() {
        preload.push(':');
    }
    preload.push_str(&lib.to_string_lossy());
    env::set_var("LD_PRELOAD", preload);
    env::set_var("LOOM_VBLANK_PATCHED", "1");

    let _ = std::process::Command::new(&exe).args(env::args_os().skip(1)).exec();
    // exec 失败时继续以未打补丁状态运行
}

#[cfg(not(target_os = "linux"))]
pub fn maybe_reexec() {}
