const profiles = [
    { name: "433.92 MHz ASK (Default)", config: { frequencyMHz: 433.92, dataRate: 100000, modulation: 3, powerDbm: 10 } },
    { name: "315 MHz ASK", config: { frequencyMHz: 315, dataRate: 100000, modulation: 3, powerDbm: 10 } },
    { name: "433.92 MHz GFSK 38.4k", config: { frequencyMHz: 433.92, dataRate: 38400, modulation: 1, powerDbm: 10 } },
    { name: "915 MHz 2-FSK 250k", config: { frequencyMHz: 915, dataRate: 250000, modulation: 0, powerDbm: 10 } }
];

const state = {
    profileIndex: 0,
    message: "Ready",
    isError: false,
    lastApplied: null,
    logLines: []
};

const nativePrint = print;

function currentProfile() {
    return profiles[state.profileIndex] || profiles[0];
}

function currentConfig() {
    const profile = currentProfile();
    return profile && profile.config ? Object.assign({}, profile.config) : Object.assign({}, profiles[0].config);
}

function log(message) {
    const text = String(message);
    state.logLines.push(text);
    if (state.logLines.length > 250) {
        state.logLines = state.logLines.slice(state.logLines.length - 250);
    }
    nativePrint(text);
}

function ensureDeviceConnection() {
    if (typeof DeviceConnection === "undefined" || DeviceConnection == null || typeof DeviceConnection.sendCommandString !== "function") {
        throw new Error("DeviceConnection unavailable. Connect to a device first.");
    }
}

function bytesToString(bytes) {
    if (!bytes || !bytes.length) {
        return "";
    }
    try {
        return String.fromCharCode.apply(null, Array.from(bytes));
    } catch (_) {
        return "";
    }
}

function send(command) {
    ensureDeviceConnection();
    log("> " + command);
    const response = DeviceConnection.sendCommandString(command);
    const text = bytesToString(response).trim();
    if (text) {
        log("< " + text);
    }
    return text;
}

function initCc1101(config) {
    send("cc1101 init");
    send("cc1101 strobe --cmd=0x30");
    send("cc1101 apply_defaults");
    send("cc1101 write --reg=0x08 --val=0x32");
    send("cc1101 set_gdo --data=0x2E,0x2E,0x0D");
    send("cc1101 set_freq --mhz=" + config.frequencyMHz);
    send("cc1101 set_datarate --bps=" + config.dataRate);
    send("cc1101 set_mod_power --mod=" + config.modulation + " --dbm=" + config.powerDbm);
}

function describeConfig(config) {
    if (!config) {
        return "No configuration applied.";
    }
    return [
        "Freq " + formatNumber(config.frequencyMHz, 2) + " MHz",
        "Rate " + formatNumber(config.dataRate, 0) + " bps",
        "Mod " + String(config.modulation),
        "Power " + formatNumber(config.powerDbm, 0) + " dBm"
    ].join(" · ");
}

function formatNumber(value, decimals) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return String(value);
    }
    return num.toFixed(decimals);
}

function applyOperation(label, task) {
    try {
        const result = task();
        if (result) {
            state.lastApplied = result;
            log("[" + label + "] " + describeConfig(result));
        } else {
            state.lastApplied = null;
            log("[" + label + "] complete");
        }
        state.message = label + " complete";
        state.isError = false;
    } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        state.message = label + " failed: " + detail;
        state.isError = true;
        log("[" + label + "] " + detail);
    }
    render();
}

function startRx() {
    applyOperation("RX", function () {
        const config = currentConfig();
        initCc1101(config);
        send("gpio in --pin=1");
        send("cc1101 strobe --cmd=0x34");
        return config;
    });
}

function startTx() {
    applyOperation("TX", function () {
        const config = currentConfig();
        initCc1101(config);
        send("cc1101 strobe --cmd=0x35");
        return config;
    });
}

function standby() {
    applyOperation("Standby", function () {
        send("cc1101 strobe --cmd=0x36");
        return null;
    });
}

function flushFifos() {
    applyOperation("Flush", function () {
        send("cc1101 strobe --cmd=0x3A");
        send("cc1101 strobe --cmd=0x3B");
        return null;
    });
}

function cycleProfile() {
    state.profileIndex = (state.profileIndex + 1) % profiles.length;
    state.lastApplied = null;
    log("Selected profile: " + currentProfile().name);
    render();
}

function resetDefaults() {
    state.profileIndex = 0;
    state.lastApplied = null;
    state.message = "Defaults restored.";
    state.isError = false;
    log("Reset to default profile.");
    render();
}

function render() {
    const children = [
        UI.text({ text: "CC1101 Radio (Command Set)", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: "Profile: " + currentProfile().name, foregroundColor: "#6B7280" }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: "Change Profile", backgroundColor: "#4F46E5", foregroundColor: "#FFFFFF", onTap: cycleProfile }),
                UI.button({ label: "Reset Defaults", backgroundColor: "#6B7280", foregroundColor: "#FFFFFF", onTap: resetDefaults })
            ]
        }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: "Start RX", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: startRx }),
                UI.button({ label: "Start TX", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: startTx })
            ]
        }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: "Standby", backgroundColor: "#0F172A", foregroundColor: "#FFFFFF", onTap: standby }),
                UI.button({ label: "Flush FIFOs", backgroundColor: "#0EA5E9", foregroundColor: "#FFFFFF", onTap: flushFifos })
            ]
        }),
        UI.text({
            text: state.message,
            fontWeight: "medium",
            foregroundColor: state.isError ? "#DC2626" : "#065F46"
        })
    ];

    if (state.lastApplied) {
        children.push(UI.text({ text: describeConfig(state.lastApplied), foregroundColor: "#374151" }));
    }

    children.push(
        UI.logViewer({
            text: state.logLines.join("\n"),
            minHeight: 180,
            backgroundColor: "#111827",
            foregroundColor: "#F9FAFB",
            padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
            cornerRadius: 8
        })
    );

    children.push(UI.text({ text: "Uses firmware `cc1101 ...` commands via DeviceConnection.", foregroundColor: "#6B7280" }));

    UI.render(UI.column({ padding: 16, spacing: 16, children }));
}

render();
