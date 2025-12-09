'use strict';

const DEVICE_NAME = 'rfm69';
const SPI_OPEN_COMMAND = 'spi open --name=rfm69 --host=2 --miso=13 --mosi=11 --sck=12 --cs=10 --mode=0 --clock=8000000';
const SPI_CLOSE_COMMAND = 'spi close --name=rfm69';
const SPI_TIMEOUT_MS = 1500;

// RFM69 Register definitions
const REG = {
    FIFO: 0x00,
    OPMODE: 0x01,
    DATAMODUL: 0x02,
    BITRATEMSB: 0x03,
    BITRATELSB: 0x04,
    FDEVMSB: 0x05,
    FDEVLSB: 0x06,
    FRFMSB: 0x07,
    FRFMID: 0x08,
    FRFLSB: 0x09,
    OSC1: 0x0A,
    AFCCTRL: 0x0B,
    LOWBAT: 0x0C,
    LISTEN1: 0x0D,
    LISTEN2: 0x0E,
    LISTEN3: 0x0F,
    VERSION: 0x10,
    PALEVEL: 0x11,
    PARAMP: 0x12,
    OCP: 0x13,
    LNA: 0x18,
    RXBW: 0x19,
    AFCBW: 0x1A,
    OOKPEAK: 0x1B,
    OOKAVG: 0x1C,
    OOKFIX: 0x1D,
    AFCFEI: 0x1E,
    AFCMSB: 0x1F,
    AFCLSB: 0x20,
    FEIMSB: 0x21,
    FEILSB: 0x22,
    RSSICONFIG: 0x23,
    RSSIVALUE: 0x24,
    DIOMAPPING1: 0x25,
    DIOMAPPING2: 0x26,
    IRQFLAGS1: 0x27,
    IRQFLAGS2: 0x28,
    RSSITHRESH: 0x29,
    RXTIMEOUT1: 0x2A,
    RXTIMEOUT2: 0x2B,
    PREAMBLEMSB: 0x2C,
    PREAMBLELSB: 0x2D,
    SYNCCONFIG: 0x2E,
    SYNCVALUE1: 0x2F,
    PACKETCONFIG1: 0x37,
    PAYLOADLENGTH: 0x38,
    NODEADRS: 0x39,
    BROADCASTADRS: 0x3A,
    AUTOMODES: 0x3B,
    FIFOTHRESH: 0x3C,
    PACKETCONFIG2: 0x3D,
    TEMP1: 0x4E,
    TEMP2: 0x4F,
    TESTLNA: 0x58,
    TESTPA1: 0x5A,
    TESTPA2: 0x5C,
    TESTDAGC: 0x6F
};

// OpMode bits
const RF_OPMODE_SEQUENCER_OFF = 0x80;
const RF_OPMODE_SEQUENCER_ON = 0x00;
const RF_OPMODE_LISTEN_ON = 0x40;
const RF_OPMODE_LISTEN_OFF = 0x00;
const RF_OPMODE_LISTENABORT = 0x20;
const RF_OPMODE_SLEEP = 0x00;
const RF_OPMODE_STANDBY = 0x04;
const RF_OPMODE_SYNTHESIZER = 0x08;
const RF_OPMODE_TRANSMITTER = 0x0C;
const RF_OPMODE_RECEIVER = 0x10;

// DataModul bits
const RF_DATAMODUL_DATAMODE_PACKET = 0x00;
const RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC = 0x40;
const RF_DATAMODUL_DATAMODE_CONTINUOUS = 0x60;
const RF_DATAMODUL_MODULATIONTYPE_FSK = 0x00;
const RF_DATAMODUL_MODULATIONTYPE_OOK = 0x08;
const RF_DATAMODUL_MODULATIONSHAPING_00 = 0x00;

// PaLevel bits
const RF_PALEVEL_PA0_ON = 0x80;
const RF_PALEVEL_PA0_OFF = 0x00;
const RF_PALEVEL_PA1_ON = 0x40;
const RF_PALEVEL_PA1_OFF = 0x00;
const RF_PALEVEL_PA2_ON = 0x20;
const RF_PALEVEL_PA2_OFF = 0x00;

// OCP bits
const RF_OCP_ON = 0x1A;
const RF_OCP_OFF = 0x0F;

// LNA bits
const RF_LNA_ZIN_50 = 0x00;
const RF_LNA_ZIN_200 = 0x80;
const RF_LNA_GAINSELECT_AUTO = 0x00;
const RF_LNA_GAINSELECT_MAX = 0x08;
const RF_LNA_GAINSELECT_MAXMINUS6 = 0x10;
const RF_LNA_GAINSELECT_MAXMINUS12 = 0x18;
const RF_LNA_GAINSELECT_MAXMINUS24 = 0x20;
const RF_LNA_GAINSELECT_MAXMINUS36 = 0x28;
const RF_LNA_GAINSELECT_MAXMINUS48 = 0x30;

// OokPeak bits
const RF_OOKPEAK_THRESHTYPE_FIXED = 0x00;
const RF_OOKPEAK_THRESHTYPE_PEAK = 0x40;
const RF_OOKPEAK_PEAKTHRESHSTEP_000 = 0x00;
const RF_OOKPEAK_PEAKTHRESHDEC_000 = 0x00;

// RSSI Config bits
const RF_RSSI_START = 0x01;
const RF_RSSI_DONE = 0x02;

// IrqFlags1 bits
const RF_IRQFLAGS1_MODEREADY = 0x80;

// Modes
const MODE_SLEEP = 0;
const MODE_STANDBY = 1;
const MODE_SYNTH = 2;
const MODE_RX = 3;
const MODE_TX = 4;

// Modulation types
const MOD_FSK = 0;
const MOD_OOK = 1;

// PA modes
const PA_MODE_PA0 = 1;
const PA_MODE_PA1 = 2;
const PA_MODE_PA1_PA2 = 3;
const PA_MODE_PA1_PA2_20DBM = 4;

// Frequency step (FXOSC / 2^19) = 61.03515625
const FSTEP = 61.03515625;

const BASE_DEFAULT_CONFIG = Object.freeze({
    frequencyMHz: 433.92,
    dataRate: 100000,
    modulation: 'FSK',
    powerDbm: 10,
    paMode: PA_MODE_PA1_PA2,
    deviationHz: 50000,
    bandwidth: 0x1A, // 250 kHz
    ocp: true
});

const MODULATION_ALIASES = {
    fsk: 'FSK',
    mod_fsk: 'FSK',
    ook: 'OOK',
    mod_ook: 'OOK'
};

let spiOpen = false;

function isAvailable() {
    return typeof BLEService === 'object' && BLEService !== null && typeof BLEService.sendCommand === 'function';
}

function ensureBleService() {
    if (!isAvailable()) {
        throw new Error('BLE service unavailable. Connect to EMWaver first.');
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
    ensureBleService();
    const payload = stringToBytes(command);
    const response = BLEService.sendCommand(payload, timeout || SPI_TIMEOUT_MS);
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
    throw new Error(response.trim() || 'Failed to open RFM69 SPI device');
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

function writeReg(addr, value) {
    spiXfer([(addr | 0x80) & 0xFF, value & 0xFF], 2);
}

function readReg(addr) {
    const bytes = spiXfer([(addr & 0x7F), 0x00], 2);
    return bytes.length >= 2 ? bytes[1] & 0xFF : 0;
}

function setMode(mode) {
    let currentOpMode = readReg(REG.OPMODE);
    let newOpMode;

    switch (mode) {
        case MODE_TX:
            newOpMode = (currentOpMode & 0xE3) | RF_OPMODE_TRANSMITTER;
            break;
        case MODE_RX:
            newOpMode = (currentOpMode & 0xE3) | RF_OPMODE_RECEIVER;
            writeReg(REG.TESTPA1, 0x55);
            writeReg(REG.TESTPA2, 0x70);
            writeReg(REG.OCP, RF_OCP_ON);
            break;
        case MODE_SYNTH:
            newOpMode = (currentOpMode & 0xE3) | RF_OPMODE_SYNTHESIZER;
            break;
        case MODE_STANDBY:
            newOpMode = (currentOpMode & 0xE3) | RF_OPMODE_STANDBY;
            break;
        case MODE_SLEEP:
            newOpMode = (currentOpMode & 0xE3) | RF_OPMODE_SLEEP;
            break;
        default:
            return;
    }

    writeReg(REG.OPMODE, newOpMode);
}

function setFrequencyMHz(freqMHz) {
    const freqHz = Math.round(freqMHz * 1000000.0 / FSTEP);
    writeReg(REG.FRFMSB, (freqHz >> 16) & 0xFF);
    writeReg(REG.FRFMID, (freqHz >> 8) & 0xFF);
    writeReg(REG.FRFLSB, freqHz & 0xFF);
}

function getFrequencyMHz() {
    const frfMsb = readReg(REG.FRFMSB) & 0xFF;
    const frfMid = readReg(REG.FRFMID) & 0xFF;
    const frfLsb = readReg(REG.FRFLSB) & 0xFF;
    const freqHz = (frfMsb << 16) + (frfMid << 8) + frfLsb;
    return (FSTEP * freqHz) / 1000000.0;
}

function setDataRate(bps) {
    if (bps <= 0) return;
    const bitrate = Math.round(32000000 / bps);
    writeReg(REG.BITRATEMSB, (bitrate >> 8) & 0xFF);
    writeReg(REG.BITRATELSB, bitrate & 0xFF);
}

function getDataRate() {
    const msb = readReg(REG.BITRATEMSB) & 0xFF;
    const lsb = readReg(REG.BITRATELSB) & 0xFF;
    const bitrate = (msb << 8) | lsb;
    if (bitrate === 0) return 0;
    return Math.round(32000000 / bitrate);
}

function setDeviation(deviationHz) {
    const deviation = Math.round(deviationHz / 61);
    writeReg(REG.FDEVMSB, (deviation >> 8) & 0xFF);
    writeReg(REG.FDEVLSB, deviation & 0xFF);
}

function getDeviation() {
    const msb = readReg(REG.FDEVMSB) & 0xFF;
    const lsb = readReg(REG.FDEVLSB) & 0xFF;
    return ((msb << 8) | lsb) * 61;
}

function setBandwidth(bw) {
    const currentRxBw = readReg(REG.RXBW);
    writeReg(REG.RXBW, (currentRxBw & 0xE0) | (bw & 0x1F));
}

function getBandwidth() {
    return readReg(REG.RXBW) & 0x1F;
}

function setModulation(modulation) {
    if (modulation === MOD_OOK) {
        writeReg(REG.DATAMODUL, RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
            RF_DATAMODUL_MODULATIONTYPE_OOK | RF_DATAMODUL_MODULATIONSHAPING_00);
    } else {
        writeReg(REG.DATAMODUL, RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
            RF_DATAMODUL_MODULATIONTYPE_FSK | RF_DATAMODUL_MODULATIONSHAPING_00);
    }
}

function getModulation() {
    const dataModul = readReg(REG.DATAMODUL);
    return ((dataModul & RF_DATAMODUL_MODULATIONTYPE_OOK) !== 0) ? MOD_OOK : MOD_FSK;
}

function setTransmitPower(dbm, paMode, ocp) {
    let paLevel;
    switch (paMode) {
        case PA_MODE_PA0:
            paLevel = RF_PALEVEL_PA0_ON | RF_PALEVEL_PA1_OFF | RF_PALEVEL_PA2_OFF |
                (dbm > 13 ? 31 : (dbm + 18));
            break;
        case PA_MODE_PA1:
            paLevel = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_OFF |
                (dbm > 13 ? 31 : (dbm + 18));
            break;
        case PA_MODE_PA1_PA2:
            paLevel = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON |
                (dbm > 17 ? 31 : (dbm + 14));
            break;
        case PA_MODE_PA1_PA2_20DBM:
            writeReg(REG.TESTPA1, 0x5D);
            writeReg(REG.TESTPA2, 0x7C);
            paLevel = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON |
                (dbm > 20 ? 31 : (dbm + 11));
            break;
        default:
            paLevel = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON | 31;
            break;
    }
    writeReg(REG.PALEVEL, paLevel);
    writeReg(REG.OCP, ocp ? RF_OCP_ON : RF_OCP_OFF);
}

function getPowerLevel() {
    const paLevel = readReg(REG.PALEVEL);
    const outputPower = paLevel & 0x1F;

    const pa0 = (paLevel & RF_PALEVEL_PA0_ON) !== 0;
    const pa1 = (paLevel & RF_PALEVEL_PA1_ON) !== 0;
    const pa2 = (paLevel & RF_PALEVEL_PA2_ON) !== 0;

    const testPa1 = readReg(REG.TESTPA1);
    const testPa2 = readReg(REG.TESTPA2);
    const is20dBm = (testPa1 === 0x5D) && (testPa2 === 0x7C);

    if (pa0 && !pa1 && !pa2) {
        return outputPower - 18;
    } else if (!pa0 && pa1 && !pa2) {
        return outputPower - 18;
    } else if (!pa0 && pa1 && pa2) {
        if (is20dBm) {
            return outputPower - 11;
        } else {
            return outputPower - 14;
        }
    }
    return 0;
}

function setLNAGain(lnaGain) {
    writeReg(REG.LNA, RF_LNA_ZIN_50 | (lnaGain & 0x38));
}

function setFixedThreshold(threshold) {
    writeReg(REG.OOKFIX, threshold & 0xFF);
}

function setRSSIThreshold(rssi) {
    writeReg(REG.RSSITHRESH, rssi & 0xFF);
}

function setSensitivityBoost(boost) {
    if (boost) {
        writeReg(REG.TESTLNA, 0x2D);
    } else {
        writeReg(REG.TESTLNA, 0x1B);
    }
}

function setThreshTypeFixed(fixed) {
    if (fixed) {
        writeReg(REG.OOKPEAK, RF_OOKPEAK_THRESHTYPE_FIXED |
            RF_OOKPEAK_PEAKTHRESHSTEP_000 | RF_OOKPEAK_PEAKTHRESHDEC_000);
    } else {
        writeReg(REG.OOKPEAK, RF_OOKPEAK_THRESHTYPE_PEAK |
            RF_OOKPEAK_PEAKTHRESHSTEP_000 | RF_OOKPEAK_PEAKTHRESHDEC_000);
    }
}

function readRSSI(forceTrigger) {
    if (forceTrigger) {
        writeReg(REG.RSSICONFIG, RF_RSSI_START);
        let timeout = 0;
        while ((readReg(REG.RSSICONFIG) & RF_RSSI_DONE) === 0x00) {
            if (++timeout > 100) break;
        }
    }
    return -((readReg(REG.RSSIVALUE) & 0xFF) >> 1);
}

function standby() {
    ensureSpiOpen();
    setMode(MODE_STANDBY);
    return true;
}

function flushFifos() {
    ensureSpiOpen();
    setMode(MODE_STANDBY);
    // RFM69 doesn't have explicit flush commands, but going to standby clears FIFOs
    return true;
}

function initializeRadio() {
    // Basic RFM69 initialization
    setMode(MODE_STANDBY);
    writeReg(REG.DATAMODUL, RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
        RF_DATAMODUL_MODULATIONTYPE_FSK | RF_DATAMODUL_MODULATIONSHAPING_00);
    writeReg(REG.RXBW, 0x1A); // 250 kHz bandwidth
    writeReg(REG.AFCBW, 0x1A); // 250 kHz AFC bandwidth
    writeReg(REG.PREAMBLEMSB, 0x00);
    writeReg(REG.PREAMBLELSB, 0x03);
    writeReg(REG.SYNCCONFIG, 0x88);
    writeReg(REG.SYNCVALUE1, 0x2D);
    writeReg(REG.PACKETCONFIG1, 0x00);
    writeReg(REG.PACKETCONFIG2, 0x00);
    writeReg(REG.PAYLOADLENGTH, 0x00);
    writeReg(REG.FIFOTHRESH, 0x8F);
    writeReg(REG.PARAMP, 0x08);
    setLNAGain(RF_LNA_GAINSELECT_AUTO);
    setSensitivityBoost(false);
    setThreshTypeFixed(true);
    setFixedThreshold(0x0A);
    setRSSIThreshold(0xE4);
}

function cloneDefaultConfig() {
    return {
        frequencyMHz: BASE_DEFAULT_CONFIG.frequencyMHz,
        dataRate: BASE_DEFAULT_CONFIG.dataRate,
        modulation: BASE_DEFAULT_CONFIG.modulation,
        powerDbm: BASE_DEFAULT_CONFIG.powerDbm,
        paMode: BASE_DEFAULT_CONFIG.paMode,
        deviationHz: BASE_DEFAULT_CONFIG.deviationHz,
        bandwidth: BASE_DEFAULT_CONFIG.bandwidth,
        ocp: BASE_DEFAULT_CONFIG.ocp
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
    if (overrides.paMode != null) {
        config.paMode = Number(overrides.paMode);
    }
    if (overrides.deviationHz != null) {
        config.deviationHz = Number(overrides.deviationHz);
    }
    if (overrides.bandwidth != null) {
        config.bandwidth = Number(overrides.bandwidth) & 0x1F;
    }
    if (overrides.ocp != null) {
        config.ocp = Boolean(overrides.ocp);
    }
    return config;
}

function applyConfiguration(config) {
    ensureSpiOpen();
    setMode(MODE_STANDBY);
    initializeRadio();
    flushFifos();
    
    setFrequencyMHz(config.frequencyMHz);
    setDataRate(config.dataRate);
    setDeviation(config.deviationHz);
    setBandwidth(config.bandwidth);
    
    const modulationCode = config.modulation === 'OOK' ? MOD_OOK : MOD_FSK;
    setModulation(modulationCode);
    setTransmitPower(config.powerDbm, config.paMode, config.ocp);
    
    return {
        frequencyMHz: getFrequencyMHz(),
        dataRate: getDataRate(),
        modulation: config.modulation,
        powerDbm: config.powerDbm
    };
}

function startRx(overrides) {
    const config = normalizeOverrides(overrides);
    const applied = applyConfiguration(config);
    setMode(MODE_RX);
    return applied;
}

function startTx(overrides) {
    const config = normalizeOverrides(overrides);
    const applied = applyConfiguration(config);
    setMode(MODE_TX);
    return applied;
}

function mergeConfig(overrides) {
    return normalizeOverrides(overrides);
}

function constants() {
    return {
        modulation: {
            MOD_FSK: MOD_FSK,
            MOD_OOK: MOD_OOK
        },
        modes: {
            MODE_SLEEP: MODE_SLEEP,
            MODE_STANDBY: MODE_STANDBY,
            MODE_SYNTH: MODE_SYNTH,
            MODE_RX: MODE_RX,
            MODE_TX: MODE_TX
        },
        paModes: {
            PA_MODE_PA0: PA_MODE_PA0,
            PA_MODE_PA1: PA_MODE_PA1,
            PA_MODE_PA1_PA2: PA_MODE_PA1_PA2,
            PA_MODE_PA1_PA2_20DBM: PA_MODE_PA1_PA2_20DBM
        },
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
    constants,
    // Direct register access
    writeReg,
    readReg,
    setMode,
    setFrequencyMHz,
    getFrequencyMHz,
    setDataRate,
    getDataRate,
    setDeviation,
    getDeviation,
    setBandwidth,
    getBandwidth,
    setModulation,
    getModulation,
    setTransmitPower,
    getPowerLevel,
    setLNAGain,
    setFixedThreshold,
    setRSSIThreshold,
    setSensitivityBoost,
    setThreshTypeFixed,
    readRSSI,
    // Constants
    MODE_SLEEP,
    MODE_STANDBY,
    MODE_SYNTH,
    MODE_RX,
    MODE_TX,
    MOD_FSK,
    MOD_OOK,
    PA_MODE_PA0,
    PA_MODE_PA1,
    PA_MODE_PA1_PA2,
    PA_MODE_PA1_PA2_20DBM,
    REG
};
