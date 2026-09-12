/// 在所有平台的构建入口检查迁移字节，防止换行差异再次进入安装包。
fn main() {
    println!("cargo:rerun-if-changed=migrations");
    for entry in std::fs::read_dir("migrations").expect("无法读取迁移目录") {
        let path = entry.expect("无法读取迁移文件").path();
        if path.extension().is_some_and(|extension| extension == "sql") {
            let bytes = std::fs::read(&path).expect("无法读取迁移 SQL");
            assert!(
                !bytes.contains(&b'\r'),
                "迁移文件必须使用 LF 换行：{}",
                path.display()
            );
            assert!(
                !bytes.starts_with(&[0xef, 0xbb, 0xbf]),
                "迁移文件不能包含 UTF-8 BOM：{}",
                path.display()
            );
        }
    }
    tauri_build::build()
}
