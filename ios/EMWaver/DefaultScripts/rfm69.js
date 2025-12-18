let status = "Ready";

function initRx() {
    status = "Initializing RX...";
    render();
    DeviceConnection.sendCommandString("rfm69 init");
    DeviceConnection.sendCommandString("rfm69 set_mode --mode=standby");
    DeviceConnection.sendCommandString("rfm69 set_mod --mod=ook");
    DeviceConnection.sendCommandString("rfm69 set_freq --mhz=433.92");
    DeviceConnection.sendCommandString("rfm69 set_bitrate --bps=100000");
    DeviceConnection.sendCommandString("rfm69 set_bw_khz --khz=250.0");
    DeviceConnection.sendCommandString("rfm69 set_power --dbm=10 --pa_mode=3 --ocp");
    DeviceConnection.sendCommandString("rfm69 set_mode --mode=rx");
    status = "RX init complete";
    render();
}

function initTx() {
    status = "Initializing TX...";
    render();
    DeviceConnection.sendCommandString("rfm69 init");
    DeviceConnection.sendCommandString("rfm69 set_mode --mode=standby");
    DeviceConnection.sendCommandString("rfm69 set_mod --mod=ook");
    DeviceConnection.sendCommandString("rfm69 set_freq --mhz=433.92");
    DeviceConnection.sendCommandString("rfm69 set_bitrate --bps=100000");
    DeviceConnection.sendCommandString("rfm69 set_bw_khz --khz=250.0");
    DeviceConnection.sendCommandString("rfm69 set_power --dbm=10 --pa_mode=3 --ocp");
    DeviceConnection.sendCommandString("rfm69 set_mode --mode=tx");
    status = "TX init complete";
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: "RFM69", font: "title2", fontWeight: "semibold" }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: "InitRx", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: initRx }),
                    UI.button({ label: "InitTx", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: initTx })
                ]
            }),
            UI.text({ text: status, fontWeight: "medium" })
        ]
    }));
}

render();
