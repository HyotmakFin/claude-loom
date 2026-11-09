fn main() {
    // Linux: 编译 VBlankMonitor 提速补丁（见 scripts/fps-patch/vblank_patch.c），
    // 放到 resources/ 供 AppImage 打包，同时复制到 target/<profile>/ 方便直接运行。
    #[cfg(target_os = "linux")]
    {
        use std::path::{Path, PathBuf};
        use std::process::Command;

        println!("cargo:rerun-if-changed=../scripts/fps-patch/vblank_patch.c");
        let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let src = manifest.join("../scripts/fps-patch/vblank_patch.c");
        let resources = manifest.join("resources");
        std::fs::create_dir_all(&resources).expect("create resources dir");
        let dst = resources.join("libloom-vblank.so");
        let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
        let status = Command::new(&cc)
            .arg("-shared")
            .arg("-fPIC")
            .arg("-O2")
            .arg("-o")
            .arg(&dst)
            .arg(&src)
            .arg("-ldl")
            .arg("-lpthread")
            .status()
            .unwrap_or_else(|e| panic!("failed to run {cc}: {e}"));
        assert!(status.success(), "failed to build vblank patch");
        if let Some(profile_dir) = out.ancestors().nth(3).map(Path::new) {
            let _ = std::fs::copy(&dst, profile_dir.join("libloom-vblank.so"));
        }
    }

    // 必须在补丁库生成后执行：tauri-build 会校验 resources 里声明的文件是否存在
    tauri_build::build();
}
