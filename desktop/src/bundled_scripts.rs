pub const SCRIPT_BOOTSTRAP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../assets/default-scripts/script_bootstrap.emw"
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
            "/../assets/default-scripts/hello.emw"
        )),
    },
    BundledScript {
        name: "blink.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/blink.emw"
        )),
    },
    BundledScript {
        name: "gpio.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/gpio.emw"
        )),
    },
    BundledScript {
        name: "adc.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/adc.emw"
        )),
    },
    BundledScript {
        name: "uart.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/uart.emw"
        )),
    },
    BundledScript {
        name: "i2c.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/i2c.emw"
        )),
    },
    BundledScript {
        name: "pwm.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/pwm.emw"
        )),
    },
    BundledScript {
        name: "cc1101.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/cc1101.emw"
        )),
    },
    BundledScript {
        name: "ism.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/ism.emw"
        )),
    },
    BundledScript {
        name: "sampler.emw",
        source: include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../assets/default-scripts/sampler.emw"
        )),
    },
];

pub fn bundled_script_source(name: &str) -> Option<&'static str> {
    BUNDLED_SCRIPTS
        .iter()
        .find(|s| s.name == name)
        .map(|s| s.source)
}
