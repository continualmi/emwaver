// Simple GPIO control wavelet
let selectedPin = 0;
let resultText = "";

const PINS = [
    { label: "GPIO0 (IO0)", value: "0" },
    { label: "CC1101 GDO0 (IO1)", value: "1" },
    { label: "CC1101 GDO2 (IO2)", value: "2" },
    { label: "IR TX (IO4)", value: "4" },
    { label: "IR RX (IO5)", value: "5" },
    { label: "GPIO6 (IO6)", value: "6" },
    { label: "GPIO7 (IO7)", value: "7" },
    { label: "GPIO9 (IO9)", value: "9" },
    { label: "CC1101 NSS (IO10)", value: "10" },
    { label: "CC1101 MOSI (IO11)", value: "11" },
    { label: "CC1101 SCK (IO12)", value: "12" },
    { label: "CC1101 MISO (IO13)", value: "13" },
    { label: "GPIO14 (IO14)", value: "14" },
    { label: "GPIO15 (IO15)", value: "15" },
    { label: "GPIO16 (IO16)", value: "16" }
];

selectedPin = PINS[0].value;

function gpioRead() {
    console.log("gpioRead called with selectedPin: " + selectedPin);
    if (!BLEService) {
        resultText = "BLE Service not connected";
        render();
        return;
    }
    try {
        let pinNumber = parseInt(selectedPin);
        let command = createByteArray([0x67, 0x70, 0x69, 0x6F, 0x00, pinNumber, 0x52, 0x00]);
        let response = BLEService.sendCommand(command, 2000);
        if (response && response.length > 0) {
            let state = response[0] !== 0;
            let pinInfo = PINS.find(p => p.value === selectedPin);
            let pinName = pinInfo ? pinInfo.label : "IO" + selectedPin;
            resultText = "Read " + pinName + ": " + (state ? "HIGH" : "LOW");
        } else {
            resultText = "GPIO read failed or timed out";
        }
    } catch (error) {
        resultText = "GPIO read error: " + error;
    }
    render();
}

function gpioWriteHigh() {
    gpioWrite(1);
}

function gpioWriteLow() {
    gpioWrite(0);
}

function gpioWrite(value) {
    console.log("gpioWrite called with value: " + value + " selectedPin: " + selectedPin);
    if (!BLEService) {
        resultText = "BLE Service not connected";
        render();
        return;
    }
    try {
        let pinNumber = parseInt(selectedPin);
        let command = createByteArray([0x67, 0x70, 0x69, 0x6F, 0x00, pinNumber, 0x57, value]);
        let response = BLEService.sendCommand(command, 2000);
        if (response && response.length > 0) {
            let state = response[0] !== 0;
            let pinInfo = PINS.find(p => p.value === selectedPin);
            let pinName = pinInfo ? pinInfo.label : "IO" + selectedPin;
            let success = (state === (value !== 0));
            let writeAction = value ? "HIGH" : "LOW";
            resultText = "Write " + writeAction + " to " + pinName + (success ? " successful" : " failed");
        } else {
            resultText = "GPIO write failed or timed out";
        }
    } catch (error) {
        resultText = "GPIO write error: " + error;
    }
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: "GPIO Control", font: "title2", fontWeight: "semibold" }),
            UI.text({ text: "Select Pin", fontWeight: "medium" }),
            UI.picker({
                style: "menu",
                selected: String(selectedPin),
                options: PINS,
                onChange: function(value) {
                    selectedPin = value;
                    console.log("Pin changed to value: " + selectedPin + " (type: " + typeof value + ")");
                }
            }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: "Read", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: gpioRead }),
                    UI.button({ label: "Write HIGH", backgroundColor: "#059669", foregroundColor: "#FFFFFF", onTap: gpioWriteHigh }),
                    UI.button({ label: "Write LOW", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: gpioWriteLow })
                ]
            }),
            resultText ? UI.text({
                text: resultText,
                backgroundColor: resultText.includes("successful") || resultText.includes("HIGH") || resultText.includes("LOW") ? "#DCFCE7" : "#FEE2E2",
                foregroundColor: resultText.includes("successful") || resultText.includes("HIGH") || resultText.includes("LOW") ? "#166534" : "#DC2626",
                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                cornerRadius: 8
            }) : null
        ]
    }));
}

render();
