let status = "Ready";
let logLines = [];
const nativePrint = print;

function log(message) {
    const text = String(message);
    logLines.push(text);
    if (logLines.length > 250) {
        logLines = logLines.slice(logLines.length - 250);
    }
    nativePrint(text);
}

function send(command) {
    if (typeof DeviceConnection === "undefined" || DeviceConnection == null || typeof DeviceConnection.sendCommandString !== "function") {
        throw new Error("DeviceConnection unavailable. Connect to a device first.");
    }
    log("> " + command);
    const response = DeviceConnection.sendCommandString(command);
    if (response != null && response.length) {
        try {
            const text = String.fromCharCode.apply(null, Array.from(response));
            log("< " + text.trim());
        } catch (_) {
            log("< ok");
        }
    }
}

function initCommon() {
    send("cc1101 init");
    send("cc1101 strobe --cmd=0x30");
    send("cc1101 apply_defaults");
    send("cc1101 write --reg=0x08 --val=0x32");
    send("cc1101 set_gdo --data=0x2E,0x2E,0x0D");
    send("cc1101 set_freq --mhz=433.92");
    send("cc1101 set_datarate --bps=100000");
    send("cc1101 set_mod_power --mod=3 --dbm=10");
}

function initRx() {
    try {
        status = "Initializing RX...";
        render();
        initCommon();
        send("gpio in --pin=1");
        send("cc1101 strobe --cmd=0x34");
        status = "RX init complete";
    } catch (error) {
        status = "RX init failed: " + (error && error.message ? error.message : String(error));
    }
    render();
}

function initTx() {
    try {
        status = "Initializing TX...";
        render();
        initCommon();
        send("cc1101 strobe --cmd=0x35");
        status = "TX init complete";
    } catch (error) {
        status = "TX init failed: " + (error && error.message ? error.message : String(error));
    }
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: 'CC1101 Radio', font: 'title2', fontWeight: 'semibold' }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: 'Init RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: initRx }),
                    UI.button({ label: 'Init TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: initTx })
                ]
            }),
            UI.text({ text: status, fontWeight: 'medium', foregroundColor: '#374151' }),
            UI.logViewer({
                text: logLines.join('\n'),
                minHeight: 180,
                backgroundColor: '#111827',
                foregroundColor: '#F9FAFB',
                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                cornerRadius: 8
            })
        ]
    }));
}

render();
