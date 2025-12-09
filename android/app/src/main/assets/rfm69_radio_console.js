const RFM69 = require('rfm69');

let message = 'Ready';

function initRx() {
    try {
        RFM69.ensure(); // Ensure SPI device is open
        RFM69.setMode(RFM69.MODE_STANDBY);
        RFM69.writeReg(RFM69.REG.DATAMODUL, 0x40); // Continuous mode, no sync, FSK
        RFM69.setFrequencyMHz(433.92);
        const actualFreq = RFM69.getFrequencyMHz();
        RFM69.setDataRate(100000);
        RFM69.setDeviation(50000);
        RFM69.setBandwidth(0x1A); // 250 kHz
        RFM69.setModulation(RFM69.MOD_FSK);
        RFM69.setTransmitPower(10, RFM69.PA_MODE_PA1_PA2, true);
        RFM69.setMode(RFM69.MODE_RX);
        message = 'RX init complete! Freq: ' + actualFreq.toFixed(2) + ' MHz';
        render();
    } catch (error) {
        message = 'RX init failed: ' + error;
        render();
    }
}

function initTx() {
    try {
        RFM69.ensure(); // Ensure SPI device is open
        RFM69.setMode(RFM69.MODE_STANDBY);
        RFM69.writeReg(RFM69.REG.DATAMODUL, 0x40); // Continuous mode, no sync, FSK
        RFM69.setFrequencyMHz(433.92);
        const actualFreq = RFM69.getFrequencyMHz();
        RFM69.setDataRate(100000);
        RFM69.setDeviation(50000);
        RFM69.setBandwidth(0x1A); // 250 kHz
        RFM69.setModulation(RFM69.MOD_FSK);
        RFM69.setTransmitPower(10, RFM69.PA_MODE_PA1_PA2, true);
        RFM69.setMode(RFM69.MODE_TX);
        message = 'TX init complete! Freq: ' + actualFreq.toFixed(2) + ' MHz';
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
