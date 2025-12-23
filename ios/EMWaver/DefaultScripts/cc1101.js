let status = "Ready";

function initRx() {
    status = "Initializing RX...";
    render();
    DeviceConnection.sendCommandString("cc1101 init");
    DeviceConnection.sendCommandString("cc1101 strobe --cmd=0x30");
    DeviceConnection.sendCommandString("cc1101 apply_defaults");
    DeviceConnection.sendCommandString("cc1101 write --reg=0x08 --val=0x32");
    DeviceConnection.sendCommandString("cc1101 set_gdo --data=0x2E,0x2E,0x0D");
    // Ensure the MCU pin connected to CC1101 GDO0 (IO1) is configured as input.
    DeviceConnection.sendCommandString("gpio in --pin=1");
    DeviceConnection.sendCommandString("cc1101 set_freq --mhz=433.92");
    DeviceConnection.sendCommandString("cc1101 set_datarate --bps=100000");
    DeviceConnection.sendCommandString("cc1101 set_mod_power --mod=3 --dbm=10");
    DeviceConnection.sendCommandString("cc1101 strobe --cmd=0x34");
    status = "RX init complete";
    render();
}

function initTx() {
    status = "Initializing TX...";
    render();
    DeviceConnection.sendCommandString("cc1101 init");
    DeviceConnection.sendCommandString("cc1101 strobe --cmd=0x30");
    DeviceConnection.sendCommandString("cc1101 apply_defaults");
    DeviceConnection.sendCommandString("cc1101 write --reg=0x08 --val=0x32");
    DeviceConnection.sendCommandString("cc1101 set_gdo --data=0x2E,0x2E,0x0D");
    DeviceConnection.sendCommandString("cc1101 set_freq --mhz=433.92");
    DeviceConnection.sendCommandString("cc1101 set_datarate --bps=100000");
    DeviceConnection.sendCommandString("cc1101 set_mod_power --mod=3 --dbm=10");
    DeviceConnection.sendCommandString("cc1101 strobe --cmd=0x35");
    status = "TX init complete";
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
            UI.text({ text: status, fontWeight: "medium" })
        ]
    }));
}

render();
