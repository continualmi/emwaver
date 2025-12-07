let message = 'Ready';

function initRx() {
    try {
        CC1101.spiStrobe(CC1101.SRES);
        CC1101.init();
        CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
        CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
        CC1101.setFrequencyMHz(433.92);
        CC1101.setDataRate(100000);
        CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
        CC1101.spiStrobe(CC1101.SRX);
        message = 'RX init complete!';
        render();
    } catch (error) {
        message = 'RX init failed: ' + error;
        render();
    }
}

function initTx() {
    try {
        CC1101.spiStrobe(CC1101.SRES);
        CC1101.init();
        CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
        CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
        CC1101.setFrequencyMHz(433.92);
        CC1101.setDataRate(100000);
        CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
        CC1101.spiStrobe(CC1101.STX);
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
            UI.text({ text: 'CC1101 Radio', font: 'title2', fontWeight: 'semibold' }),
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
