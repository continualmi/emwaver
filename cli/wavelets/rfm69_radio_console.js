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

let message = 'Ready';

function initRx() {
    try {
        RFM69.setMode(RFM69.MODE_STANDBY);
        RFM69.writeReg(RFM69.REG.DATAMODUL, 0x40); // Continuous mode, no sync, FSK
        RFM69.setFrequencyMHz(433.92);
        RFM69.setDataRate(100000);
        RFM69.setDeviation(50000);
        RFM69.setBandwidth(0x1A); // 250 kHz
        RFM69.setModulation(RFM69.MOD_FSK);
        RFM69.setTransmitPower(10, RFM69.PA_MODE_PA1_PA2, true);
        RFM69.setMode(RFM69.MODE_RX);
        message = 'RX init complete!';
        render();
    } catch (error) {
        message = 'RX init failed: ' + error;
        render();
    }
}

function initTx() {
    try {
        RFM69.setMode(RFM69.MODE_STANDBY);
        RFM69.writeReg(RFM69.REG.DATAMODUL, 0x40); // Continuous mode, no sync, FSK
        RFM69.setFrequencyMHz(433.92);
        RFM69.setDataRate(100000);
        RFM69.setDeviation(50000);
        RFM69.setBandwidth(0x1A); // 250 kHz
        RFM69.setModulation(RFM69.MOD_FSK);
        RFM69.setTransmitPower(10, RFM69.PA_MODE_PA1_PA2, true);
        RFM69.setMode(RFM69.MODE_TX);
        message = 'TX init complete!';
        render();
    } catch (error) {
        message = 'TX init failed: ' + error;
        render();
    }
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: 'RFM69 Radio', font: 'title2', fontWeight: 'semibold' }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: 'Init RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: initRx }),
                    UI.button({ label: 'Init TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: initTx })
                ]
            }),
            UI.text({ text: message, fontWeight: 'medium', foregroundColor: '#374151' })
        ]
    }));
}

render();
