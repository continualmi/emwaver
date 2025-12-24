// Simple GPIO control wavelet
let selectedTarget = "esp32";
let selectedPin = "";
let selectedMode = "out";
let status = "";

const TARGETS = [
    { label: "ESP32-S3", value: "esp32" },
    { label: "STM32F042", value: "stm32" }
];

const ESP32_PINS = [
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

const STM32_PINS = [
    { label: "PA0 (TIM2_CH1)", value: "0" },
    { label: "PA1 (IR RX / TIM2_CH2)", value: "1" },
    { label: "PA2 (IR TX on Infrared Waver / GDO0 on ISM Waver, TIM2_CH3)", value: "2" },
    { label: "PA3 (TIM2_CH4)", value: "3" },
    { label: "PA4 (NSS_RFID / CC1101 CS)", value: "4" },
    { label: "PA5 (SPI1 SCK)", value: "5" },
    { label: "PA6 (SPI1 MISO)", value: "6" },
    { label: "PA7 (SPI1 MOSI)", value: "7" },
    { label: "PA13", value: "13" },
    { label: "PA14", value: "14" },
    { label: "PB0 (VCTL)", value: "16" },
    { label: "PB6 (RESET)", value: "22" },
    { label: "PB7", value: "23" }
];

function pinsForTarget(target) {
    return target === "stm32" ? STM32_PINS : ESP32_PINS;
}

selectedPin = pinsForTarget(selectedTarget)[0].value;

function gpioRead() {
    status = "Reading...";
    render();

    DeviceConnection.sendCommandString("gpio " + selectedMode + " --pin=" + selectedPin);
    let response = DeviceConnection.sendCommandString("gpio read --pin=" + selectedPin);

    let state = response && response.length > 0 && response[0] !== 0;
    let pinInfo = pinsForTarget(selectedTarget).find(p => p.value === selectedPin);
    let pinName = pinInfo ? pinInfo.label : "Pin " + selectedPin;
    status = pinName + " is " + (state ? "HIGH" : "LOW");
    render();
}

function gpioWriteHigh() {
    gpioWrite(1);
}

function gpioWriteLow() {
    gpioWrite(0);
}

function gpioWrite(value) {
    status = value ? "Setting HIGH..." : "Setting LOW...";
    render();

    DeviceConnection.sendCommandString("gpio out --pin=" + selectedPin);
    DeviceConnection.sendCommandString(value ? "gpio high --pin=" + selectedPin : "gpio low --pin=" + selectedPin);

    let pinInfo = pinsForTarget(selectedTarget).find(p => p.value === selectedPin);
    let pinName = pinInfo ? pinInfo.label : "Pin " + selectedPin;
    status = "Set " + pinName + " " + (value ? "HIGH" : "LOW");
    render();
}

function render() {
    const pins = pinsForTarget(selectedTarget);
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: "GPIO Control", font: "title2", fontWeight: "semibold" }),
            UI.text({ text: "Target", fontWeight: "medium" }),
            UI.picker({
                style: "menu",
                selected: selectedTarget,
                options: TARGETS,
                onChange: function(value) {
                    selectedTarget = value;
                    selectedPin = pinsForTarget(selectedTarget)[0].value;
                    status = "";
                    render();
                }
            }),
            // Pin selection
            UI.text({ text: "Select Pin", fontWeight: "medium" }),
            UI.picker({
                style: "menu",
                selected: String(selectedPin),
                options: pins,
                onChange: function(value) {
                    selectedPin = value;
                }
            }),

            // Mode selection
            UI.text({ text: "Mode", fontWeight: "medium" }),
            UI.picker({
                style: "menu",
                selected: selectedMode,
                options: [
                    { label: "Output", value: "out" },
                    { label: "Input", value: "in" }
                ],
                onChange: function(value) {
                    selectedMode = value;
                }
            }),
            
            // GPIO operations
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: "Read", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: gpioRead }),
                    UI.button({ label: "Write HIGH", backgroundColor: "#059669", foregroundColor: "#FFFFFF", onTap: gpioWriteHigh }),
                    UI.button({ label: "Write LOW", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: gpioWriteLow })
                ]
            }),
            
            // Result display
            status ? UI.text({
                text: status,
                backgroundColor: "#111827",
                foregroundColor: "#FFFFFF",
                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                cornerRadius: 8
            }) : null
        ]
    }));
}

render();
