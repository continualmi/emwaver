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


// RFM69 Register Addresses
export const REG_FIFO = 0x00;
export const REG_OPMODE = 0x01;
export const REG_DATAMODUL = 0x02;
export const REG_BITRATEMSB = 0x03;
export const REG_BITRATELSB = 0x04;
export const REG_FDEVMSB = 0x05;
export const REG_FDEVLSB = 0x06;
export const REG_FRFMSB = 0x07;
export const REG_FRFMID = 0x08;
export const REG_FRFLSB = 0x09;
export const REG_OSC1 = 0x0A;
export const REG_AFCCTRL = 0x0B;
export const REG_LOWBAT = 0x0C;
export const REG_LISTEN1 = 0x0D;
export const REG_LISTEN2 = 0x0E;
export const REG_LISTEN3 = 0x0F;
export const REG_VERSION = 0x10;
export const REG_PALEVEL = 0x11;
export const REG_PARAMP = 0x12;
export const REG_OCP = 0x13;
export const REG_LNA = 0x18;
export const REG_RXBW = 0x19;
export const REG_AFCBW = 0x1A;
export const REG_OOKPEAK = 0x1B;
export const REG_OOKAVG = 0x1C;
export const REG_OOKFIX = 0x1D;
export const REG_AFCFEI = 0x1E;
export const REG_AFCMSB = 0x1F;
export const REG_AFCLSB = 0x20;
export const REG_FEIMSB = 0x21;
export const REG_FEILSB = 0x22;
export const REG_RSSICONFIG = 0x23;
export const REG_RSSIVALUE = 0x24;
export const REG_DIOMAPPING1 = 0x25;
export const REG_DIOMAPPING2 = 0x26;
export const REG_IRQFLAGS1 = 0x27;
export const REG_IRQFLAGS2 = 0x28;
export const REG_RSSITHRESH = 0x29;
export const REG_RXTIMEOUT1 = 0x2A;
export const REG_RXTIMEOUT2 = 0x2B;
export const REG_PREAMBLEMSB = 0x2C;
export const REG_PREAMBLELSB = 0x2D;
export const REG_SYNCCONFIG = 0x2E;
export const REG_SYNCVALUE1 = 0x2F;
export const REG_PACKETCONFIG1 = 0x37;
export const REG_PAYLOADLENGTH = 0x38;
export const REG_NODEADRS = 0x39;
export const REG_BROADCASTADRS = 0x3A;
export const REG_AUTOMODES = 0x3B;
export const REG_FIFOTHRESH = 0x3C;
export const REG_PACKETCONFIG2 = 0x3D;
export const REG_TEMP1 = 0x4E;
export const REG_TEMP2 = 0x4F;
export const REG_TESTLNA = 0x58;
export const REG_TESTPA1 = 0x5A;
export const REG_TESTPA2 = 0x5C;
export const REG_TESTDAGC = 0x6F;

// OpMode bits
export const RF_OPMODE_SEQUENCER_OFF = 0x80;
export const RF_OPMODE_SEQUENCER_ON = 0x00;
export const RF_OPMODE_LISTEN_ON = 0x40;
export const RF_OPMODE_LISTEN_OFF = 0x00;
export const RF_OPMODE_LISTENABORT = 0x20;
export const RF_OPMODE_SLEEP = 0x00;
export const RF_OPMODE_STANDBY = 0x04;
export const RF_OPMODE_SYNTHESIZER = 0x08;
export const RF_OPMODE_TRANSMITTER = 0x0C;
export const RF_OPMODE_RECEIVER = 0x10;

// DataModul bits
export const RF_DATAMODUL_DATAMODE_PACKET = 0x00;
export const RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC = 0x40;
export const RF_DATAMODUL_DATAMODE_CONTINUOUS = 0x60;
export const RF_DATAMODUL_MODULATIONTYPE_FSK = 0x00;
export const RF_DATAMODUL_MODULATIONTYPE_OOK = 0x08;
export const RF_DATAMODUL_MODULATIONSHAPING_00 = 0x00;

// PaLevel bits
export const RF_PALEVEL_PA0_ON = 0x80;
export const RF_PALEVEL_PA0_OFF = 0x00;
export const RF_PALEVEL_PA1_ON = 0x40;
export const RF_PALEVEL_PA1_OFF = 0x00;
export const RF_PALEVEL_PA2_ON = 0x20;
export const RF_PALEVEL_PA2_OFF = 0x00;

// OCP bits
export const RF_OCP_ON = 0x1A;
export const RF_OCP_OFF = 0x0F;

// LNA bits
export const RF_LNA_ZIN_50 = 0x00;
export const RF_LNA_ZIN_200 = 0x80;
export const RF_LNA_GAINSELECT_AUTO = 0x00;
export const RF_LNA_GAINSELECT_MAX = 0x08;
export const RF_LNA_GAINSELECT_MAXMINUS6 = 0x10;
export const RF_LNA_GAINSELECT_MAXMINUS12 = 0x18;
export const RF_LNA_GAINSELECT_MAXMINUS24 = 0x20;
export const RF_LNA_GAINSELECT_MAXMINUS36 = 0x28;
export const RF_LNA_GAINSELECT_MAXMINUS48 = 0x30;

// OokPeak bits
export const RF_OOKPEAK_THRESHTYPE_FIXED = 0x00;
export const RF_OOKPEAK_THRESHTYPE_PEAK = 0x40;
export const RF_OOKPEAK_PEAKTHRESHSTEP_000 = 0x00;
export const RF_OOKPEAK_PEAKTHRESHDEC_000 = 0x00;

// RSSI Config bits
export const RF_RSSI_START = 0x01;
export const RF_RSSI_DONE = 0x02;

// IrqFlags1 bits
export const RF_IRQFLAGS1_MODEREADY = 0x80;

// Modes
export const MODE_SLEEP = 0;
export const MODE_STANDBY = 1;
export const MODE_SYNTH = 2;
export const MODE_RX = 3;
export const MODE_TX = 4;

// Modulation types
export const MOD_FSK = 0;
export const MOD_OOK = 1;

// PA modes
export const PA_MODE_PA0 = 1;
export const PA_MODE_PA1 = 2;
export const PA_MODE_PA1_PA2 = 3;
export const PA_MODE_PA1_PA2_20DBM = 4;

// Frequency step (FXOSC / 2^19)
export const FSTEP = 61.03515625;

export const CONFIG_REGISTERS = [
  "OPMODE", "DATAMODUL", "BITRATEMSB", "BITRATELSB", "FDEVMSB", "FDEVLSB",
  "FRFMSB", "FRFMID", "FRFLSB", "OSC1", "AFCCTRL", "LOWBAT",
  "LISTEN1", "LISTEN2", "LISTEN3", "PALEVEL", "PARAMP", "OCP",
  "LNA", "RXBW", "AFCBW", "OOKPEAK", "OOKAVG", "OOKFIX",
  "AFCFEI", "AFCMSB", "AFCLSB", "FEIMSB", "FEILSB", "RSSICONFIG",
  "DIOMAPPING1", "DIOMAPPING2", "IRQFLAGS1", "IRQFLAGS2", "RSSITHRESH",
  "RXTIMEOUT1", "RXTIMEOUT2", "PREAMBLEMSB", "PREAMBLELSB", "SYNCCONFIG",
  "PACKETCONFIG1", "PAYLOADLENGTH", "NODEADRS", "BROADCASTADRS",
  "AUTOMODES", "FIFOTHRESH", "PACKETCONFIG2"
];

export const STATUS_REGISTERS = [
  "VERSION", "RSSIVALUE", "TEMP1", "TEMP2"
];

export const REGISTER_MAP: { [key: string]: number } = {
  "OPMODE": REG_OPMODE,
  "DATAMODUL": REG_DATAMODUL,
  "BITRATEMSB": REG_BITRATEMSB,
  "BITRATELSB": REG_BITRATELSB,
  "FDEVMSB": REG_FDEVMSB,
  "FDEVLSB": REG_FDEVLSB,
  "FRFMSB": REG_FRFMSB,
  "FRFMID": REG_FRFMID,
  "FRFLSB": REG_FRFLSB,
  "OSC1": REG_OSC1,
  "AFCCTRL": REG_AFCCTRL,
  "LOWBAT": REG_LOWBAT,
  "LISTEN1": REG_LISTEN1,
  "LISTEN2": REG_LISTEN2,
  "LISTEN3": REG_LISTEN3,
  "PALEVEL": REG_PALEVEL,
  "PARAMP": REG_PARAMP,
  "OCP": REG_OCP,
  "LNA": REG_LNA,
  "RXBW": REG_RXBW,
  "AFCBW": REG_AFCBW,
  "OOKPEAK": REG_OOKPEAK,
  "OOKAVG": REG_OOKAVG,
  "OOKFIX": REG_OOKFIX,
  "AFCFEI": REG_AFCFEI,
  "AFCMSB": REG_AFCMSB,
  "AFCLSB": REG_AFCLSB,
  "FEIMSB": REG_FEIMSB,
  "FEILSB": REG_FEILSB,
  "RSSICONFIG": REG_RSSICONFIG,
  "DIOMAPPING1": REG_DIOMAPPING1,
  "DIOMAPPING2": REG_DIOMAPPING2,
  "IRQFLAGS1": REG_IRQFLAGS1,
  "IRQFLAGS2": REG_IRQFLAGS2,
  "RSSITHRESH": REG_RSSITHRESH,
  "RXTIMEOUT1": REG_RXTIMEOUT1,
  "RXTIMEOUT2": REG_RXTIMEOUT2,
  "PREAMBLEMSB": REG_PREAMBLEMSB,
  "PREAMBLELSB": REG_PREAMBLELSB,
  "SYNCCONFIG": REG_SYNCCONFIG,
  "PACKETCONFIG1": REG_PACKETCONFIG1,
  "PAYLOADLENGTH": REG_PAYLOADLENGTH,
  "NODEADRS": REG_NODEADRS,
  "BROADCASTADRS": REG_BROADCASTADRS,
  "AUTOMODES": REG_AUTOMODES,
  "FIFOTHRESH": REG_FIFOTHRESH,
  "PACKETCONFIG2": REG_PACKETCONFIG2,
  "VERSION": REG_VERSION,
  "RSSIVALUE": REG_RSSIVALUE,
  "TEMP1": REG_TEMP1,
  "TEMP2": REG_TEMP2,
};
