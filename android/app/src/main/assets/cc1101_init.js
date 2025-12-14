let status = "Ready";

function log(message) {
    if (typeof WaveletConsole === "object" && WaveletConsole && typeof WaveletConsole.append === "function") {
        WaveletConsole.append(message);
        return;
    }
    if (typeof print === "function") {
        print(message);
    }
}

function stringToBytes(command) {
    const text = command.endsWith("\n") ? command : command + "\n";
    const bytes = new Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
        bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return createByteArray(bytes);
}

function sendCommand(command, timeoutMs) {
    if (!BLEService || typeof BLEService.sendCommand !== "function") {
        throw new Error("BLE service unavailable. Connect to EMWaver first.");
    }
    const response = BLEService.sendCommand(stringToBytes(command), timeoutMs || 2000);
    if (!response || response.length === 0) {
        throw new Error("No response from device");
    }
    if (response.length === 1 && response[0] === 0x00) {
        return;
    }
    if (response.length === 1 && response[0] === 0xff) {
        throw new Error("Device returned error");
    }
    let text = "";
    for (let i = 0; i < response.length; i += 1) {
        text += String.fromCharCode(response[i] & 0xff);
    }
    throw new Error(text.trim() || "Unexpected response");
}

function runSteps(label, steps) {
    for (let i = 0; i < steps.length; i += 1) {
        const cmd = steps[i];
        log(label + " > " + cmd);
        sendCommand(cmd);
    }
}

function initRx() {
    status = "Initializing RX...";
    render();
    try {
        runSteps("RX", [
            "cc1101 init",
            "cc1101 strobe --cmd=0x30",
            "cc1101 apply_defaults",
            "cc1101 set_pktctrl0 --val=0x32",
            "cc1101 set_gdo --data=0x2E,0x2E,0x0D",
            "cc1101 set_freq --mhz=433.92",
            "cc1101 set_datarate --bps=100000",
            "cc1101 set_mod_power --mod=3 --dbm=10",
            "cc1101 strobe --cmd=0x34"
        ]);
        status = "RX init complete";
        log("RX init: ok");
    } catch (error) {
        status = "RX init failed: " + (error && error.message ? error.message : String(error));
        log(status);
    }
    render();
}

function initTx() {
    status = "Initializing TX...";
    render();
    try {
        runSteps("TX", [
            "cc1101 init",
            "cc1101 strobe --cmd=0x30",
            "cc1101 apply_defaults",
            "cc1101 set_pktctrl0 --val=0x32",
            "cc1101 set_gdo --data=0x2E,0x2E,0x0D",
            "cc1101 set_freq --mhz=433.92",
            "cc1101 set_datarate --bps=100000",
            "cc1101 set_mod_power --mod=3 --dbm=10",
            "cc1101 strobe --cmd=0x35"
        ]);
        status = "TX init complete";
        log("TX init: ok");
    } catch (error) {
        status = "TX init failed: " + (error && error.message ? error.message : String(error));
        log(status);
    }
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: "CC1101", font: "title2", fontWeight: "semibold", foregroundColor: "#F9FAFB" }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: "InitRx", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: initRx }),
                    UI.button({ label: "InitTx", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: initTx })
                ]
            }),
            UI.text({ text: status, fontWeight: "medium", foregroundColor: "#E5E7EB" }),
            (typeof WaveletConsole === "object" && WaveletConsole && typeof WaveletConsole.view === "function")
                ? WaveletConsole.view({
                    minHeight: 180,
                    backgroundColor: "#111827",
                    foregroundColor: "#F9FAFB",
                    padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                    cornerRadius: 8
                })
                : UI.logViewer({ text: "Logs will appear here." })
        ]
    }));
}

if (typeof WaveletConsole === "object" && WaveletConsole && typeof WaveletConsole.clear === "function") {
    WaveletConsole.clear();
}
render();
