fn main() {
    let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest.join("../../../dist/release-userscript/digdig.user.js");
    println!("cargo:rerun-if-changed={}", source.display());
    let release = std::env::var("PROFILE").as_deref() == Ok("release");
    let script = match std::fs::read_to_string(&source) {
        Ok(script) => {
            assert!(script.starts_with("// ==UserScript==") && script.matches("__DIGDIG_PAIRING_TOKEN__").count() == 1,
                "The release userscript is invalid. Run npm run deploy to rebuild it.");
            script
        }
        Err(error) if release => panic!("The release userscript is missing: {error}. Run npm run deploy to build the app and userscript together."),
        Err(_) => String::new(),
    };
    std::fs::write(
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("digdig.user.js"),
        script,
    )
    .unwrap();
    tauri_build::build();
}
