pub const SCRIPT_BOOTSTRAP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../app/public/default-scripts/script_bootstrap.emw"
));

pub struct BundledScript {
    pub name: &'static str,
    pub source: &'static str,
}

pub const BUNDLED_SCRIPTS: &[BundledScript] = &[
    BundledScript {
        name: "hello.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../app/public/default-scripts/hello.emw"
        )),
    },
    BundledScript {
        name: "blink.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../app/public/default-scripts/blink.emw"
        )),
    },
];

pub fn bundled_script_source(name: &str) -> Option<&'static str> {
    BUNDLED_SCRIPTS
        .iter()
        .find(|s| s.name == name)
        .map(|s| s.source)
}
