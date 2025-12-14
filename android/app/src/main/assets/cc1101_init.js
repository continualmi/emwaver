let status = "Ready";

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

function initRx() {
    status = "Initializing RX...";
    render();
    try {
        sendCommand("cc1101 init_rx");
        status = "RX init complete";
        print("cc1101 init_rx: ok");
    } catch (error) {
        status = "RX init failed: " + (error && error.message ? error.message : String(error));
        print(status);
    }
    render();
}

function initTx() {
    status = "Initializing TX...";
    render();
    try {
        sendCommand("cc1101 init_tx");
        status = "TX init complete";
        print("cc1101 init_tx: ok");
    } catch (error) {
        status = "TX init failed: " + (error && error.message ? error.message : String(error));
        print(status);
    }
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: "CC1101", font: "title2", fontWeight: "semibold" }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: "InitRx", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: initRx }),
                    UI.button({ label: "InitTx", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: initTx })
                ]
            }),
            UI.text({ text: status, fontWeight: "medium", foregroundColor: "#374151" }),
            UI.logViewer({ text: "Logs will appear here." })
        ]
    }));
}

render();

