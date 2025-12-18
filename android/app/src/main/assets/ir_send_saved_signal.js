const DEFAULT_FREQ_HZ = 38000;
const DEFAULT_DUTY_PERCENT = 50;

let selectedSignal = "";
let repetitionsText = "1";
let status = "Ready";

function listSavedSignals() {
    if (typeof SamplerSignals === "undefined" || SamplerSignals == null || typeof SamplerSignals.listSignals !== "function") {
        return [];
    }
    try {
        if (typeof SamplerSignals.listSignalsCsv === "function") {
            const csv = String(SamplerSignals.listSignalsCsv() || "").trim();
            if (!csv) {
                return [];
            }
            return csv.split("\n").map(s => String(s || "").trim()).filter(s => !!s);
        }
        const names = SamplerSignals.listSignals();
        if (!names || typeof names.length !== "number") {
            return [];
        }
        const result = [];
        for (let i = 0; i < names.length; i += 1) {
            const name = String(names[i] || "").trim();
            if (name) {
                result.push(name);
            }
        }
        return result;
    } catch (e) {
        print("[IR] Failed to list saved signals:", String(e));
        return [];
    }
}

function signalOptions() {
    const names = listSavedSignals();
    if (names.length === 0) {
        return [{ label: "No saved signals", value: "" }];
    }
    return names.map(name => ({ label: name, value: name }));
}

function parsePositiveInt(raw, fallback) {
    const value = parseInt(String(raw || "").trim(), 10);
    if (!isFinite(value) || value <= 0) {
        return fallback;
    }
    return value;
}

function estimateDurationMs(byteLength) {
    const bits = Math.max(0, Number(byteLength) || 0) * 8;
    const micros = bits * 10;
    return Math.max(1, Math.ceil(micros / 1000));
}

function bytesFromString(text) {
    const s = String(text || "");
    const bytes = new Array(s.length);
    for (let i = 0; i < s.length; i += 1) {
        bytes[i] = s.charCodeAt(i) & 0xff;
    }
    return createByteArray(bytes);
}

function ensureSelection() {
    const names = listSavedSignals();
    if (names.length === 0) {
        selectedSignal = "";
        return;
    }
    if (!selectedSignal || names.indexOf(selectedSignal) < 0) {
        selectedSignal = names[0];
    }
}

function sendSignal() {
    ensureSelection();
    if (!selectedSignal) {
        status = "No saved signal selected.";
        render();
        return;
    }

    if (typeof BLEService === "undefined" || BLEService == null) {
        status = "BLE service unavailable";
        render();
        return;
    }

    if (typeof SamplerSignals === "undefined" || SamplerSignals == null || typeof SamplerSignals.readSignal !== "function") {
        status = "SamplerSignals unavailable";
        render();
        return;
    }

    const repetitions = parsePositiveInt(repetitionsText, 1);

    status = "Sending...";
    render();
    Utils.delay(10);

    try {
        const data = SamplerSignals.readSignal(selectedSignal);
        if (!data || (typeof data.length === "number" && data.length === 0)) {
            status = "Signal missing/empty: " + selectedSignal;
            render();
            return;
        }

        const cmd = "transmit start --pin=4 --pwm --freq=" + DEFAULT_FREQ_HZ + " --duty=" + DEFAULT_DUTY_PERCENT + "\n";

        const pauseMs = estimateDurationMs(data.length) + 60;
        for (let i = 0; i < repetitions; i += 1) {
            BLEService.loadBuffer(data);
            BLEService.write(bytesFromString(cmd));
            BLEService.transmitBuffer();
            if (i < repetitions - 1) {
                Utils.delay(pauseMs);
            }
        }

        status = "Sent " + repetitions + "x (PWM " + DEFAULT_FREQ_HZ + "Hz " + DEFAULT_DUTY_PERCENT + "%)";
    } catch (e) {
        status = "Error: " + String(e);
    }
    render();
}

function render() {
    ensureSelection();
    const connectionLine =
        (typeof DeviceConnection !== "undefined" && DeviceConnection != null && typeof DeviceConnection.connectionStatus === "function")
            ? ("Device: " + DeviceConnection.connectionStatus())
            : "Device: (connection status unavailable)";

    UI.render(UI.scroll({
        padding: 16,
        children: [
            UI.column({
                spacing: 12,
                children: [
                    UI.text({ text: "IR: Send Saved Signal", font: "title2", fontWeight: "semibold" }),
                    UI.text({ text: "Automate retransmission of sampler signals, including repetitions.", foregroundColor: "#6B7280" }),
                    UI.text({ text: connectionLine, foregroundColor: "#6B7280" }),
                    UI.divider({ backgroundColor: "#E5E7EB" }),

                    UI.text({ text: "Signal", fontWeight: "medium" }),
                    UI.picker({
                        style: "menu",
                        selected: String(selectedSignal || ""),
                        options: signalOptions(),
                        onChange: function (value) {
                            selectedSignal = String(value || "");
                            render();
                        }
                    }),

                    UI.textField({
                        label: "Repetitions",
                        value: String(repetitionsText),
                        placeholder: "1",
                        keyboard: "number",
                        onChange: function (value) {
                            repetitionsText = String(value || "");
                        }
                    }),

                    UI.button({
                        label: "Send",
                        backgroundColor: "#1D4ED8",
                        foregroundColor: "#FFFFFF",
                        onTap: sendSignal
                    }),

                    UI.text({
                        text: status,
                        backgroundColor: "#111827",
                        foregroundColor: "#F9FAFB",
                        padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                        cornerRadius: 8
                    }),
                ]
            })
        ]
    }));
}

render();
