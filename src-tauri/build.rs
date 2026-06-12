fn main() {
    for path in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
        "icons/icon.png",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }

    tauri_build::build()
}
