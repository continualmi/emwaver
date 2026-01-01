/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Simple GPIO control wavelet
let selectedTarget = "esp32";
let selectedPin = "";
let resultText = "";

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
    { label: "PA2 (TIM2_CH3)", value: "2" },
    { label: "PA3 (TIM2_CH4)", value: "3" },
    { label: "PA4 (NSS_RFID / CC1101 CS)", value: "4" },
    { label: "PA5 (SPI1 SCK)", value: "5" },
    { label: "PA6 (SPI1 MISO)", value: "6" },
    { label: "PA7 (SPI1 MOSI)", value: "7" },
    { label: "PB0 (VCTL)", value: "16" },
    { label: "PB6 (RESET)", value: "22" }
];

function pinsForTarget(target) {
    return target === "stm32" ? STM32_PINS : ESP32_PINS;
}

function ensureBleService() {
    if (!BLEService || typeof BLEService.sendCommand !== "function") {
        throw new Error("BLE Service not connected");
    }
}

function stringToBytes(command) {
    const text = command.endsWith("\n") ? command : command + "\n";
    const bytes = new Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
    }
    return createByteArray(bytes);
}

function sendCommand(command, timeoutMs) {
    ensureBleService();
    const payload = stringToBytes(command);
    return BLEService.sendCommand(payload, timeoutMs || 2000);
}

function isErrorResponse(response) {
    return response && response.length === 1 && response[0] === 0xFF;
}

selectedPin = pinsForTarget(selectedTarget)[0].value;

function gpioRead() {
    console.log("gpioRead called with selectedPin: " + selectedPin);
    try {
        const pins = pinsForTarget(selectedTarget);
        let pinNumber = parseInt(selectedPin, 10);
        sendCommand("gpio in --pin=" + pinNumber, 1000);
        let response = sendCommand("gpio read --pin=" + pinNumber, 2000);

        if (!response || response.length === 0) {
            resultText = "GPIO read failed or timed out";
        } else if (isErrorResponse(response)) {
            resultText = "GPIO read error";
        } else {
            let state = response[0] !== 0;
            let pinInfo = pins.find(p => p.value === selectedPin);
            let pinName = pinInfo ? pinInfo.label : "Pin " + selectedPin;
            resultText = "Read " + pinName + ": " + (state ? "HIGH" : "LOW");
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
    try {
        const pins = pinsForTarget(selectedTarget);
        let pinNumber = parseInt(selectedPin, 10);
        sendCommand("gpio out --pin=" + pinNumber, 1000);
        let response = sendCommand(value ? "gpio high --pin=" + pinNumber : "gpio low --pin=" + pinNumber, 2000);

        if (!response || response.length === 0) {
            resultText = "GPIO write failed or timed out";
        } else if (isErrorResponse(response)) {
            resultText = "GPIO write error";
        } else {
            let state = response[0] !== 0;
            let pinInfo = pins.find(p => p.value === selectedPin);
            let pinName = pinInfo ? pinInfo.label : "Pin " + selectedPin;
            let success = (state === (value !== 0));
            let writeAction = value ? "HIGH" : "LOW";
            resultText = "Write " + writeAction + " to " + pinName + (success ? " successful" : " failed");
        }
    } catch (error) {
        resultText = "GPIO write error: " + error;
    }
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
                    resultText = "";
                    render();
                }
            }),
            UI.text({ text: "Select Pin", fontWeight: "medium" }),
            UI.picker({
                style: "menu",
                selected: String(selectedPin),
                options: pins,
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
