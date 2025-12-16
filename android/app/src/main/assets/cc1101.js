'use strict';

const DEVICE_NAME = 'cc1101';
const SPI_OPEN_COMMAND = 'spi open --name=cc1101 --host=2 --miso=13 --mosi=11 --sck=12 --cs=10 --mode=0 --clock=8000000';
const SPI_CLOSE_COMMAND = 'spi close --name=cc1101';
const SPI_TIMEOUT_MS = 1500;

const READ_SINGLE = 0x80;
const READ_BURST = 0xC0;
const WRITE_BURST = 0x40;

const STROBES = {
    SRES: 0x30,
    SCAL: 0x33,
    SRX: 0x34,
    STX: 0x35,
    SIDLE: 0x36,
    SFRX: 0x3A,
    SFTX: 0x3B
};

const REG = {
    IOCFG2: 0x00,
    IOCFG1: 0x01,
    IOCFG0: 0x02,
    FIFOTHR: 0x03,
    SYNC1: 0x04,
    SYNC0: 0x05,
    PKTLEN: 0x06,
    PKTCTRL1: 0x07,
    PKTCTRL0: 0x08,
    ADDR: 0x09,
    CHANNR: 0x0A,
    FSCTRL1: 0x0B,
    FSCTRL0: 0x0C,
    FREQ2: 0x0D,
    FREQ1: 0x0E,
    FREQ0: 0x0F,
    MDMCFG4: 0x10,
    MDMCFG3: 0x11,
    MDMCFG2: 0x12,
    MDMCFG1: 0x13,
    MDMCFG0: 0x14,
    DEVIATN: 0x15,
    MCSM1: 0x17,
    MCSM0: 0x18,
    FOCCFG: 0x19,
    BSCFG: 0x1A,
    AGCCTRL2: 0x1B,
    AGCCTRL1: 0x1C,
    AGCCTRL0: 0x1D,
    FREND1: 0x21,
    FREND0: 0x22,
    FSCAL3: 0x23,
    FSCAL2: 0x24,
    FSCAL1: 0x25,
    FSCAL0: 0x26,
    FSTEST: 0x29,
    TEST2: 0x2C,
    TEST1: 0x2D,
    TEST0: 0x2E,
    PATABLE: 0x3E,
    TXFIFO: 0x3F,
    RXFIFO: 0x3F,
    PKTSTATUS: 0x38
};

const POWER_LEVELS = [-30, -20, -15, -10, 0, 5, 7, 10];
const POWER_TABLES = {
    band315: [0x12, 0x0D, 0x1C, 0x34, 0x51, 0x85, 0xCB, 0xC2],
    band433: [0x12, 0x0E, 0x1D, 0x34, 0x60, 0x84, 0xC8, 0xC0],
    band868: [0x03, 0x0F, 0x1E, 0x27, 0x50, 0x81, 0xCB, 0xC2],
    band915: [0x03, 0x0E, 0x1E, 0x27, 0x8E, 0xCD, 0xC7, 0xC0]
};

const MODES = {
    MOD_2FSK: 0x00,
    MOD_GFSK: 0x01,
    MOD_ASK: 0x03,
    MOD_4FSK: 0x04,
    MOD_MSK: 0x07
};

const BASE_DEFAULT_CONFIG = Object.freeze({
    frequencyMHz: 433.92,
    dataRate: 100000,
    modulation: 'ASK',
    powerDbm: 10,
    packetControl: 0x32,
    gdo2: 0x2E,
    gdo1: 0x2E,
    gdo0: 0x0D
});

const MODULATION_ALIASES = {
    ask: 'ASK',
    ook: 'ASK',
    mod_ask: 'ASK',
    '2fsk': '2FSK',
    mod_2fsk: '2FSK',
    gfsk: 'GFSK',
    mod_gfsk: 'GFSK',
    '4fsk': '4FSK',
    mod_4fsk: '4FSK',
    msk: 'MSK',
    mod_msk: 'MSK'
};

let spiOpen = false;

function isAvailable() {
    if (typeof DeviceConnection !== 'object' || DeviceConnection === null) {
        return false;
    }
    if (typeof DeviceConnection.sendCommand !== 'function') {
        return false;
    }
    if (typeof DeviceConnection.isConnected === 'function') {
        return !!DeviceConnection.isConnected();
    }
    return true;
}

function ensureDeviceConnection() {
    if (!isAvailable()) {
        throw new Error('Device connection unavailable. Connect an EMWaver device first.');
    }
}

function stringToBytes(command) {
    const text = command.endsWith('\n') ? command : command + '\n';
    const bytes = new Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
    }
    return createByteArray(bytes);
}

function bytesToString(bytes) {
    if (!bytes) {
        return '';
    }
    let result = '';
    for (let i = 0; i < bytes.length; i += 1) {
        result += String.fromCharCode(bytes[i] & 0xFF);
    }
    return result;
}

function sendCommand(command, timeout) {
    ensureDeviceConnection();
    const payload = stringToBytes(command);
    const response = DeviceConnection.sendCommand(payload, timeout || SPI_TIMEOUT_MS);
    if (!response || response.length === 0) {
        throw new Error('No response from device');
    }
    return response;
}

function sendCommandText(command, timeout) {
    return bytesToString(sendCommand(command, timeout));
}

function ensureSpiOpen() {
    if (spiOpen) {
        return;
    }
    const response = sendCommandText(SPI_OPEN_COMMAND);
    if (response.trim().startsWith('ok')) {
        spiOpen = true;
        return;
    }
    if (response.includes('spi open: exists')) {
        sendCommandText(SPI_CLOSE_COMMAND);
        const retry = sendCommandText(SPI_OPEN_COMMAND);
        if (retry.trim().startsWith('ok')) {
            spiOpen = true;
            return;
        }
        throw new Error(retry.trim());
    }
    throw new Error(response.trim() || 'Failed to open CC1101 SPI device');
}

function parseOkBytes(responseBytes) {
    const text = bytesToString(responseBytes).trim();
    if (!text) {
        throw new Error('Empty SPI response');
    }
    if (!text.toLowerCase().startsWith('ok')) {
        throw new Error(text);
    }
    const parts = text.split(/\s+/);
    const values = [];
    for (let i = 1; i < parts.length; i += 1) {
        const token = parts[i];
        if (!token) {
            continue;
        }
        const normalized = token.startsWith('0x') || token.startsWith('0X') ? token.substring(2) : token;
        const parsed = parseInt(normalized, 16);
        if (!Number.isNaN(parsed)) {
            values.push(parsed & 0xFF);
        }
    }
    return values;
}

function formatHex(value) {
    return '0x' + (value & 0xFF).toString(16).padStart(2, '0');
}

function spiXfer(txBytes, rxLength) {
    ensureSpiOpen();
    const tx = [];
    for (let i = 0; i < txBytes.length; i += 1) {
        tx.push(formatHex(txBytes[i]));
    }
    const command = `spi xfer --name=${DEVICE_NAME} --tx=${tx.join(',')} --rx=${rxLength}`;
    try {
        const response = sendCommand(command);
        return parseOkBytes(response);
    } catch (error) {
        const message = error && error.message ? error.message : String(error || 'SPI error');
        if (message.toLowerCase().includes('not open')) {
            spiOpen = false;
            ensureSpiOpen();
            const retryResponse = sendCommand(command);
            return parseOkBytes(retryResponse);
        }
        throw error;
    }
}

function spiStrobe(value) {
    spiXfer([value & 0xFF], 1);
}

function writeReg(addr, value) {
    spiXfer([addr & 0xFF, value & 0xFF], 2);
}

function readReg(addr) {
    const bytes = spiXfer([(READ_SINGLE | addr) & 0xFF, 0x00], 2);
    return bytes.length >= 2 ? bytes[1] & 0xFF : 0;
}

function writeBurstReg(addr, data, length) {
    const size = length != null ? length : data.length;
    const tx = new Array(size + 1);
    tx[0] = (WRITE_BURST | addr) & 0xFF;
    for (let i = 0; i < size; i += 1) {
        tx[i + 1] = data[i] & 0xFF;
    }
    spiXfer(tx, size + 1);
}

function readBurstReg(addr, length) {
    const tx = new Array(length + 1);
    tx[0] = (READ_BURST | addr) & 0xFF;
    for (let i = 1; i < tx.length; i += 1) {
        tx[i] = 0x00;
    }
    const result = spiXfer(tx, length + 1);
    return result.slice(1);
}

function setGDOMode(gdo2, gdo1, gdo0) {
    writeReg(REG.IOCFG2, gdo2 & 0xFF);
    writeReg(REG.IOCFG1, gdo1 & 0xFF);
    writeReg(REG.IOCFG0, gdo0 & 0xFF);
}

function getFrequencyMHz() {
    const freq2 = readReg(REG.FREQ2) & 0xFF;
    const freq1 = readReg(REG.FREQ1) & 0xFF;
    const freq0 = readReg(REG.FREQ0) & 0xFF;
    const frequencyWord = (freq2 << 16) | (freq1 << 8) | freq0;
    const fOsc = 26e6;
    return frequencyWord * (fOsc / Math.pow(2, 16)) / 1e6;
}

function calibrate() {
    const freqMHz = getFrequencyMHz();
    if (freqMHz >= 300 && freqMHz <= 348) {
        if (freqMHz < 322.88) {
            writeReg(REG.TEST0, 0x0B);
        } else {
            writeReg(REG.TEST0, 0x09);
            const fscal2 = readReg(REG.FSCAL2) & 0xFF;
            if (fscal2 < 32) {
                writeReg(REG.FSCAL2, (fscal2 + 32) & 0xFF);
            }
        }
    } else if (freqMHz >= 378 && freqMHz <= 464) {
        if (freqMHz < 430.5) {
            writeReg(REG.TEST0, 0x0B);
        } else {
            writeReg(REG.TEST0, 0x09);
            const fscal2b = readReg(REG.FSCAL2) & 0xFF;
            if (fscal2b < 32) {
                writeReg(REG.FSCAL2, (fscal2b + 32) & 0xFF);
            }
        }
    } else if (freqMHz >= 779 && freqMHz <= 899.99) {
        writeReg(REG.TEST0, 0x09);
    } else if (freqMHz >= 900 && freqMHz <= 928) {
        writeReg(REG.TEST0, 0x09);
        const fscal2c = readReg(REG.FSCAL2) & 0xFF;
        if (fscal2c < 32) {
            writeReg(REG.FSCAL2, (fscal2c + 32) & 0xFF);
        }
    }
    spiStrobe(STROBES.SCAL);
}

function setFrequencyMHz(frequencyMHz) {
    const fOsc = 26e6;
    const word = Math.round(frequencyMHz * 1e6 * Math.pow(2, 16) / fOsc);
    const freq2 = (word >> 16) & 0xFF;
    const freq1 = (word >> 8) & 0xFF;
    const freq0 = word & 0xFF;
    writeReg(REG.FREQ2, freq2);
    writeReg(REG.FREQ1, freq1);
    writeReg(REG.FREQ0, freq0);
    calibrate();
    const actual = getFrequencyMHz();
    return Math.abs(actual - frequencyMHz) < 0.005;
}

function setDataRate(bitRate) {
    const F_OSC = 26_000_000;
    const DRATE_M_MAX = 255;
    const DRATE_E_MAX = 15;
    const target = bitRate * Math.pow(2, 28) / F_OSC;
    let minDifference = Number.MAX_VALUE;
    let bestM = 0;
    let bestE = 0;
    for (let e = 0; e <= DRATE_E_MAX; e += 1) {
        for (let m = 0; m <= DRATE_M_MAX; m += 1) {
            const currentValue = (256 + m) * Math.pow(2, e);
            const difference = Math.abs(currentValue - target);
            if (difference < minDifference) {
                minDifference = difference;
                bestM = m;
                bestE = e;
            }
        }
    }
    const currentMdmcfg4 = readReg(REG.MDMCFG4) & 0xF0;
    const combinedE = currentMdmcfg4 | (bestE & 0x0F);
    const mdmcfg = [combinedE & 0xFF, bestM & 0xFF];
    writeBurstReg(REG.MDMCFG4, mdmcfg, 2);
    const confirm = readBurstReg(REG.MDMCFG4, 2);
    return confirm.length === 2 && confirm[0] === mdmcfg[0] && confirm[1] === mdmcfg[1];
}

function setModulation(modulationCode) {
    let value = readReg(REG.MDMCFG2) & 0x0F;
    value |= (modulationCode & 0x07) << 4;
    writeReg(REG.MDMCFG2, value);
    return (readReg(REG.MDMCFG2) & 0x70) === ((modulationCode & 0x07) << 4);
}

function selectPowerTable(frequencyMHz) {
    if (frequencyMHz >= 300 && frequencyMHz <= 348) {
        return POWER_TABLES.band315;
    }
    if (frequencyMHz >= 378 && frequencyMHz <= 464) {
        return POWER_TABLES.band433;
    }
    if (frequencyMHz >= 779 && frequencyMHz <= 899.99) {
        return POWER_TABLES.band868;
    }
    if (frequencyMHz >= 900 && frequencyMHz <= 928) {
        return POWER_TABLES.band915;
    }
    return null;
}

function setPowerLevel(modulationCode, dbm) {
    const freqMHz = getFrequencyMHz();
    const table = selectPowerTable(freqMHz);
    if (!table) {
        return false;
    }
    const index = POWER_LEVELS.indexOf(dbm);
    if (index === -1) {
        return false;
    }
    const powerSetting = table[index] & 0xFF;
    const paTable = new Array(8).fill(0);
    if (modulationCode === MODES.MOD_ASK) {
        paTable[0] = 0;
        paTable[1] = powerSetting;
    } else {
        paTable[0] = powerSetting;
    }
    writeBurstReg(REG.PATABLE, paTable, 8);
    const verify = readBurstReg(REG.PATABLE, 8);
    if (verify.length !== 8) {
        return false;
    }
    for (let i = 0; i < 8; i += 1) {
        if ((verify[i] & 0xFF) !== (paTable[i] & 0xFF)) {
            return false;
        }
    }
    return true;
}

function setModulationAndPower(modulationCode, dbm) {
    const mdmcfg2Value = (readReg(REG.MDMCFG2) & 0x0F) | ((modulationCode & 0x07) << 4);
    const frend0Value = modulationCode === MODES.MOD_ASK ? 0x11 : 0x10;
    writeReg(REG.MDMCFG2, mdmcfg2Value & 0xFF);
    writeReg(REG.FREND0, frend0Value & 0xFF);
    const confirmMdmcfg2 = readReg(REG.MDMCFG2) & 0x70;
    const confirmFrend0 = readReg(REG.FREND0) & 0xFF;
    if (confirmMdmcfg2 !== ((modulationCode & 0x07) << 4) || confirmFrend0 !== (frend0Value & 0xFF)) {
        return false;
    }
    return setPowerLevel(modulationCode, dbm);
}

function standby() {
    ensureSpiOpen();
    spiStrobe(STROBES.SIDLE);
    return true;
}

function flushFifos() {
    ensureSpiOpen();
    spiStrobe(STROBES.SIDLE);
    spiStrobe(STROBES.SFRX);
    spiStrobe(STROBES.SFTX);
    return true;
}

function initializeRadio() {
    writeReg(REG.FSCTRL1, 0x06);
    writeReg(REG.MDMCFG1, 0x02);
    writeReg(REG.MDMCFG0, 0xF8);
    writeReg(REG.CHANNR, 0x00);
    writeReg(REG.DEVIATN, 0x47);
    writeReg(REG.FREND1, 0x56);
    writeReg(REG.MCSM0, 0x18);
    writeReg(REG.FOCCFG, 0x16);
    writeReg(REG.BSCFG, 0x1C);
    writeReg(REG.AGCCTRL2, 0xC7);
    writeReg(REG.AGCCTRL1, 0x00);
    writeReg(REG.AGCCTRL0, 0xB2);
    writeReg(REG.FSCAL3, 0xE9);
    writeReg(REG.FSCAL2, 0x2A);
    writeReg(REG.FSCAL1, 0x00);
    writeReg(REG.FSCAL0, 0x1F);
    writeReg(REG.FSTEST, 0x59);
    writeReg(REG.TEST2, 0x81);
    writeReg(REG.TEST1, 0x35);
    writeReg(REG.TEST0, 0x09);
    writeReg(REG.PKTCTRL0, 0x00);
    writeReg(REG.PKTCTRL1, 0x04);
    writeReg(REG.ADDR, 0x00);
    writeReg(REG.PKTLEN, 0x00);
}

function cloneDefaultConfig() {
    return {
        frequencyMHz: BASE_DEFAULT_CONFIG.frequencyMHz,
        dataRate: BASE_DEFAULT_CONFIG.dataRate,
        modulation: BASE_DEFAULT_CONFIG.modulation,
        powerDbm: BASE_DEFAULT_CONFIG.powerDbm,
        packetControl: BASE_DEFAULT_CONFIG.packetControl,
        gdo2: BASE_DEFAULT_CONFIG.gdo2,
        gdo1: BASE_DEFAULT_CONFIG.gdo1,
        gdo0: BASE_DEFAULT_CONFIG.gdo0
    };
}

function normalizeOverrides(overrides) {
    if (!overrides) {
        return cloneDefaultConfig();
    }
    const config = cloneDefaultConfig();
    if (overrides.frequencyMHz != null) {
        config.frequencyMHz = Number(overrides.frequencyMHz);
    }
    if (overrides.dataRate != null) {
        config.dataRate = Number(overrides.dataRate);
    }
    if (overrides.modulation != null) {
        const key = String(overrides.modulation).trim();
        const alias = MODULATION_ALIASES[key.toLowerCase()] || key.toUpperCase();
        config.modulation = alias;
    }
    if (overrides.powerDbm != null) {
        config.powerDbm = Number(overrides.powerDbm);
    }
    if (overrides.packetControl != null) {
        config.packetControl = overrides.packetControl & 0xFF;
    }
    if (overrides.gdo2 != null) {
        config.gdo2 = overrides.gdo2 & 0xFF;
    }
    if (overrides.gdo1 != null) {
        config.gdo1 = overrides.gdo1 & 0xFF;
    }
    if (overrides.gdo0 != null) {
        config.gdo0 = overrides.gdo0 & 0xFF;
    }
    return config;
}

function applyConfiguration(config) {
    ensureSpiOpen();
    spiStrobe(STROBES.SRES);
    initializeRadio();
    flushFifos();
    setGDOMode(config.gdo2, config.gdo1, config.gdo0);
    writeReg(REG.PKTCTRL0, config.packetControl & 0xFF);
    if (!setFrequencyMHz(config.frequencyMHz)) {
        throw new Error('Failed to set frequency');
    }
    if (!setDataRate(config.dataRate)) {
        throw new Error('Failed to set data rate');
    }
    const modulationCode = MODES['MOD_' + config.modulation];
    if (modulationCode == null) {
        throw new Error('Unsupported modulation: ' + config.modulation);
    }
    if (!setModulationAndPower(modulationCode, config.powerDbm)) {
        throw new Error('Failed to configure modulation/power');
    }
    return {
        frequencyMHz: getFrequencyMHz(),
        dataRate: config.dataRate,
        modulation: config.modulation,
        powerDbm: config.powerDbm
    };
}

function startRx(overrides) {
    const config = normalizeOverrides(overrides);
    const applied = applyConfiguration(config);
    spiStrobe(STROBES.SRX);
    return applied;
}

function startTx(overrides) {
    const config = normalizeOverrides(overrides);
    const applied = applyConfiguration(config);
    spiStrobe(STROBES.STX);
    return applied;
}

function mergeConfig(overrides) {
    return normalizeOverrides(overrides);
}

function constants() {
    return {
        modulation: {
            MOD_2FSK: MODES.MOD_2FSK,
            MOD_GFSK: MODES.MOD_GFSK,
            MOD_ASK: MODES.MOD_ASK,
            MOD_4FSK: MODES.MOD_4FSK,
            MOD_MSK: MODES.MOD_MSK
        },
        powerLevels: POWER_LEVELS.slice(),
        strobes: Object.assign({}, STROBES),
        defaults: cloneDefaultConfig()
    };
}

module.exports = {
    isAvailable,
    ensure: ensureSpiOpen,
    defaultConfig: cloneDefaultConfig,
    mergeConfig,
    applyConfig: applyConfiguration,
    startRx,
    startTx,
    standby,
    flushFifos,
    constants
};
