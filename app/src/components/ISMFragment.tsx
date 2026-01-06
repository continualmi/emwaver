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

import { useCallback, useMemo, useRef, useState } from "react";
import { useDevice } from "../utils/DeviceContext";

const RF_PARAMETER_STEPS = 6;

// STM32 firmware uses fixed CC1101 wiring on PA4 (encoded as `4` in `gpio --pin` and `spi xfer --cs`).
const DEFAULT_CC1101_CS = 4;

const CC1101_PA_TABLE_SIZE = 8;
const CC1101_PATABLE_ADDR = 0x3e;

const CC1101_F_XTAL_HZ = 26_000_000.0;
const CC1101_REG_FREQ2 = 0x0d;
const CC1101_REG_FREQ1 = 0x0e;
const CC1101_REG_FREQ0 = 0x0f;
const CC1101_REG_MDMCFG4 = 0x10;
const CC1101_REG_MDMCFG3 = 0x11;
const CC1101_REG_MDMCFG2 = 0x12;
const CC1101_REG_DEVIATN = 0x15;
const CC1101_REG_FREND0 = 0x22;

const CC1101_MOD_2FSK = 0;
const CC1101_MOD_GFSK = 1;
const CC1101_MOD_ASK = 3;
const CC1101_MOD_4FSK = 4;
const CC1101_MOD_MSK = 7;

const CC1101_POWER_LEVELS_DBM = [-30, -20, -15, -10, 0, 5, 7, 10];
const CC1101_POWER_SETTING_315MHZ = [0x12, 0x0d, 0x1c, 0x34, 0x51, 0x85, 0xcb, 0xc2];
const CC1101_POWER_SETTING_433MHZ = [0x12, 0x0e, 0x1d, 0x34, 0x60, 0x84, 0xc8, 0xc0];
const CC1101_POWER_SETTING_868MHZ = [0x03, 0x0f, 0x1e, 0x27, 0x50, 0x81, 0xcb, 0xc2];
const CC1101_POWER_SETTING_915MHZ = [0x03, 0x0e, 0x1e, 0x27, 0x8e, 0xcd, 0xc7, 0xc0];

const CC1101_CONFIG_REGISTERS = [
  "IOCFG2",
  "IOCFG1",
  "IOCFG0",
  "FIFOTHR",
  "SYNC1",
  "SYNC0",
  "PKTLEN",
  "PKTCTRL1",
  "PKTCTRL0",
  "ADDR",
  "CHANNR",
  "FSCTRL1",
  "FSCTRL0",
  "FREQ2",
  "FREQ1",
  "FREQ0",
  "MDMCFG4",
  "MDMCFG3",
  "MDMCFG2",
  "MDMCFG1",
  "MDMCFG0",
  "DEVIATN",
  "MCSM2",
  "MCSM1",
  "MCSM0",
  "FOCCFG",
  "BSCFG",
  "AGCCTRL2",
  "AGCCTRL1",
  "AGCCTRL0",
  "WOREVT1",
  "WOREVT0",
  "WORCTRL",
  "FREND1",
  "FREND0",
  "FSCAL3",
  "FSCAL2",
  "FSCAL1",
  "FSCAL0",
  "RCCTRL1",
  "RCCTRL0",
  "FSTEST",
  "PTEST",
  "AGCTEST",
  "TEST2",
  "TEST1",
  "TEST0",
];

const CC1101_STATUS_REGISTERS = [
  "PARTNUM",
  "VERSION",
  "FREQEST",
  "LQI",
  "RSSI",
  "MARCSTATE",
  "WORTIME1",
  "WORTIME0",
  "PKTSTATUS",
  "VCO_VC_DAC",
  "TXBYTES",
  "RXBYTES",
  "RCCTRL1_STATUS",
  "RCCTRL0_STATUS",
];

const CC1101_REGISTER_MAP: Record<string, number> = {
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
  CHANNR: 0x0a,
  FSCTRL1: 0x0b,
  FSCTRL0: 0x0c,
  FREQ2: 0x0d,
  FREQ1: 0x0e,
  FREQ0: 0x0f,
  MDMCFG4: 0x10,
  MDMCFG3: 0x11,
  MDMCFG2: 0x12,
  MDMCFG1: 0x13,
  MDMCFG0: 0x14,
  DEVIATN: 0x15,
  MCSM2: 0x16,
  MCSM1: 0x17,
  MCSM0: 0x18,
  FOCCFG: 0x19,
  BSCFG: 0x1a,
  AGCCTRL2: 0x1b,
  AGCCTRL1: 0x1c,
  AGCCTRL0: 0x1d,
  WOREVT1: 0x1e,
  WOREVT0: 0x1f,
  WORCTRL: 0x20,
  FREND1: 0x21,
  FREND0: 0x22,
  FSCAL3: 0x23,
  FSCAL2: 0x24,
  FSCAL1: 0x25,
  FSCAL0: 0x26,
  RCCTRL1: 0x27,
  RCCTRL0: 0x28,
  FSTEST: 0x29,
  PTEST: 0x2a,
  AGCTEST: 0x2b,
  TEST2: 0x2c,
  TEST1: 0x2d,
  TEST0: 0x2e,
  PARTNUM: 0x30,
  VERSION: 0x31,
  FREQEST: 0x32,
  LQI: 0x33,
  RSSI: 0x34,
  MARCSTATE: 0x35,
  WORTIME1: 0x36,
  WORTIME0: 0x37,
  PKTSTATUS: 0x38,
  VCO_VC_DAC: 0x39,
  TXBYTES: 0x3a,
  RXBYTES: 0x3b,
  RCCTRL1_STATUS: 0x3c,
  RCCTRL0_STATUS: 0x3d,
};

const CC1101_MODULATION_OPTIONS = [
  { label: "2-FSK", value: CC1101_MOD_2FSK },
  { label: "GFSK", value: CC1101_MOD_GFSK },
  { label: "ASK/OOK", value: CC1101_MOD_ASK },
  { label: "4-FSK", value: CC1101_MOD_4FSK },
  { label: "MSK", value: CC1101_MOD_MSK },
];

interface RfParameters {
  frequencyMHz: number;
  dataRate: number;
  bandwidth: number;
  deviation: number;
  modulation: number;
  txPower: number;
}

interface EditDialogState {
  isOpen: boolean;
  title: string;
  value: string;
  mode: "hex" | "number";
  allowDecimal: boolean;
  onSave: (val: string) => Promise<void>;
}

function isPaddedPacket(response: Uint8Array | null, first: number) {
  if (!response || response.length !== 64) return false;
  if (response[0] !== first) return false;
  for (let i = 1; i < response.length; i++) {
    if (response[i] !== 0) return false;
  }
  return true;
}

function isOkAck(response: Uint8Array | null) {
  return isPaddedPacket(response, 0x00);
}

function parseRawPayload(response: Uint8Array | null) {
  if (!response || response.length === 0) return new Uint8Array(0);
  if (isOkAck(response)) return new Uint8Array(0);
  return response;
}

function parseRawString(response: Uint8Array | null) {
  if (!response || response.length === 0) return "";
  if (isOkAck(response)) return "";
  const firstZero = response.indexOf(0);
  const end = firstZero >= 0 ? firstZero : response.length;
  return new TextDecoder().decode(response.slice(0, end)).trim();
}

function formatHexByte(value: number) {
  return `0x${(value & 0xff).toString(16).padStart(2, "0").toUpperCase()}`;
}

function formatHexByteList(values: number[]) {
  return values.map(formatHexByte).join(",");
}

export default function ISMFragment() {
  const { status, send } = useDevice();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalLoadSteps, setTotalLoadSteps] = useState(0);
  const [currentCommand, setCurrentCommand] = useState("");
  const [registers, setRegisters] = useState<Record<string, string>>({});
  const [rfParams, setRfParams] = useState<RfParameters | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const [editDialog, setEditDialog] = useState<EditDialogState>({
    isOpen: false,
    title: "",
    value: "",
    mode: "hex",
    allowDecimal: false,
    onSave: async () => {},
  });

  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const isConnected = status.connected;

  const sendCommandString = useCallback(
    async (command: string, timeoutMs = 1000, packets = 1) => {
      if (!status.connected) {
        return null;
      }
      setCurrentCommand(command);
      return await send(command, timeoutMs, packets);
    },
    [send, status.connected],
  );

  const cc1101SpiXfer = useCallback(
    async (tx: number[], rx?: number, timeoutMs = 1000) => {
      const txArg = formatHexByteList(tx);
      const rxArg = typeof rx === "number" ? ` --rx=${rx}` : "";
      const command = `spi xfer --cs=${DEFAULT_CC1101_CS} --tx=${txArg}${rxArg}`;
      return await sendCommandString(command, timeoutMs);
    },
    [sendCommandString],
  );

  const getRegisterAddress = useCallback((name: string) => CC1101_REGISTER_MAP[name] ?? 0, []);

  const readReg = useCallback(
    async (addr: number) => {
      const isStatusRegister = addr >= 0x30 && addr <= 0x3d;
      const cmd = ((addr & 0x3f) | (isStatusRegister ? 0xc0 : 0x80)) & 0xff;
      const response = await cc1101SpiXfer([cmd, 0x00], 2, 1000);
      const payload = parseRawPayload(response);
      return payload.length >= 2 ? payload[1] & 0xff : 0;
    },
    [cc1101SpiXfer],
  );

  const writeReg = useCallback(
    async (addr: number, value: number) => {
      await cc1101SpiXfer([addr & 0x3f, value & 0xff], undefined, 1000);
    },
    [cc1101SpiXfer],
  );

  const cc1101ReadBurstReg = useCallback(
    async (addr: number, len: number) => {
      const requested = Math.max(0, Math.min(63, len));
      const cmd = ((addr & 0x3f) | 0xc0) & 0xff;
      const tx = [cmd, ...new Array(requested).fill(0x00)];
      const response = await cc1101SpiXfer(tx, undefined, 1500);
      const payload = parseRawPayload(response);
      if (payload.length < 1) return new Uint8Array(0);
      return payload.slice(1, 1 + requested);
    },
    [cc1101SpiXfer],
  );

  const cc1101WriteBurstReg = useCallback(
    async (addr: number, data: number[]) => {
      const bytes = data.slice(0, 63).map((value) => value & 0xff);
      const cmd = ((addr & 0x3f) | 0x40) & 0xff;
      const tx = [cmd, ...bytes];
      const response = await cc1101SpiXfer(tx, undefined, 1500);
      const payload = parseRawPayload(response);
      return isOkAck(response) || payload.length >= tx.length;
    },
    [cc1101SpiXfer],
  );

  const ensureCc1101Init = useCallback(async () => {
    const response = await cc1101SpiXfer([0xf1, 0x00], 2, 1000);
    const payload = parseRawPayload(response);
    if (payload.length >= 2 && (payload[1] & 0xff) === 0x14) {
      return true;
    }
    if (!response || response.length === 0) {
      setStatusMessage("CC1101 probe failed: no response.");
      return false;
    }
    setStatusMessage("CC1101 probe failed: unexpected response.");
    return false;
  }, [cc1101SpiXfer]);

  const cc1101Strobe = useCallback(
    async (cmd: number) => {
      await cc1101SpiXfer([cmd & 0xff], undefined, 1000);
    },
    [cc1101SpiXfer],
  );

  const cc1101GetFrequencyMHz = useCallback(async () => {
    const freq2 = await readReg(CC1101_REG_FREQ2);
    const freq1 = await readReg(CC1101_REG_FREQ1);
    const freq0 = await readReg(CC1101_REG_FREQ0);
    const word = ((freq2 & 0xff) << 16) | ((freq1 & 0xff) << 8) | (freq0 & 0xff);
    return (word * (CC1101_F_XTAL_HZ / Math.pow(2, 16))) / 1e6;
  }, [readReg]);

  const cc1101SetFrequencyMHz = useCallback(
    async (frequencyMHz: number) => {
      const word = Math.round((frequencyMHz * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ);
      await writeReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
      await writeReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
      await writeReg(CC1101_REG_FREQ0, word & 0xff);
      await cc1101Strobe(54);
      await cc1101Strobe(51);
      const confirm = await cc1101GetFrequencyMHz();
      return Math.abs(confirm - frequencyMHz) < 0.001;
    },
    [cc1101GetFrequencyMHz, cc1101Strobe, writeReg],
  );

  const cc1101GetDataRate = useCallback(async () => {
    const mdmcfg4 = await readReg(CC1101_REG_MDMCFG4);
    const drateE = mdmcfg4 & 0x0f;
    const drateM = await readReg(CC1101_REG_MDMCFG3);
    const bitRate = ((256 + drateM) * Math.pow(2, drateE) * CC1101_F_XTAL_HZ) / Math.pow(2, 28);
    return Math.round(bitRate);
  }, [readReg]);

  const cc1101SetDataRate = useCallback(
    async (bitRate: number) => {
      if (bitRate <= 0) return false;
      const target = (bitRate * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
      let bestM = 0;
      let bestE = 0;
      let bestDiff = Number.MAX_VALUE;
      for (let e = 0; e <= 15; e += 1) {
        for (let m = 0; m <= 255; m += 1) {
          const current = (256 + m) * Math.pow(2, e);
          const diff = Math.abs(current - target);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestM = m;
            bestE = e;
          }
        }
      }
      const current = await readReg(CC1101_REG_MDMCFG4);
      const bandwidthPart = current & 0xf0;
      const newMdmcfg4 = (bandwidthPart | (bestE & 0x0f)) & 0xff;
      const newMdmcfg3 = bestM & 0xff;
      await cc1101WriteBurstReg(CC1101_REG_MDMCFG4, [newMdmcfg4, newMdmcfg3]);
      const confirm = await cc1101ReadBurstReg(CC1101_REG_MDMCFG4, 2);
      return confirm.length === 2 && confirm[0] === newMdmcfg4 && confirm[1] === newMdmcfg3;
    },
    [cc1101ReadBurstReg, cc1101WriteBurstReg, readReg],
  );

  const cc1101GetBandwidthKHz = useCallback(async () => {
    const v = await readReg(CC1101_REG_MDMCFG4);
    const bwExp = (v >> 6) & 0x03;
    const bwMant = (v >> 4) & 0x03;
    const bandwidthHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + bwMant) * Math.pow(2, bwExp));
    return bandwidthHz / 1000.0;
  }, [readReg]);

  const cc1101SetBandwidth = useCallback(
    async (bandwidthKHz: number) => {
      if (bandwidthKHz <= 0) return false;
      const targetHz = bandwidthKHz * 1000.0;
      let bestExp = 0;
      let bestMant = 0;
      let bestDiff = Number.MAX_VALUE;
      for (let exp = 0; exp <= 3; exp += 1) {
        for (let mant = 0; mant <= 3; mant += 1) {
          const bwHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + mant) * Math.pow(2, exp));
          const diff = Math.abs(bwHz - targetHz);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestExp = exp;
            bestMant = mant;
          }
        }
      }
      const current = await readReg(CC1101_REG_MDMCFG4);
      const drateE = current & 0x0f;
      const newMdmcfg4 = ((bestExp << 6) | (bestMant << 4) | drateE) & 0xff;
      await writeReg(CC1101_REG_MDMCFG4, newMdmcfg4);
      const confirm = await readReg(CC1101_REG_MDMCFG4);
      return confirm === newMdmcfg4;
    },
    [readReg, writeReg],
  );

  const cc1101GetDeviation = useCallback(async () => {
    const v = await readReg(CC1101_REG_DEVIATN);
    const deviationM = v & 0x07;
    const deviationE = (v >> 4) & 0x07;
    const deviationHz = ((8 + deviationM) * Math.pow(2, deviationE)) * (CC1101_F_XTAL_HZ / Math.pow(2, 17));
    return Math.round(deviationHz);
  }, [readReg]);

  const cc1101SetDeviation = useCallback(
    async (deviationHz: number) => {
      if (deviationHz <= 0) return false;
      let bestE = 0;
      let bestM = 0;
      let bestDiff = Number.MAX_VALUE;
      for (let e = 0; e <= 7; e += 1) {
        for (let m = 0; m <= 7; m += 1) {
          const current = ((8 + m) * Math.pow(2, e)) * (CC1101_F_XTAL_HZ / Math.pow(2, 17));
          const diff = Math.abs(current - deviationHz);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestE = e;
            bestM = m;
          }
        }
      }
      const value = ((bestE << 4) | (bestM & 0x07)) & 0xff;
      await writeReg(CC1101_REG_DEVIATN, value);
      const confirm = await readReg(CC1101_REG_DEVIATN);
      return confirm === value;
    },
    [readReg, writeReg],
  );

  const cc1101GetModulation = useCallback(async () => {
    const mdmcfg2 = await readReg(CC1101_REG_MDMCFG2);
    return (mdmcfg2 >> 4) & 0x07;
  }, [readReg]);

  const cc1101GetPowerLevel = useCallback(async () => {
    const frequencyMHz = await cc1101GetFrequencyMHz();
    let powerSettings: number[] | null = null;
    if (frequencyMHz >= 300 && frequencyMHz <= 348) {
      powerSettings = CC1101_POWER_SETTING_315MHZ;
    } else if (frequencyMHz >= 378 && frequencyMHz <= 464) {
      powerSettings = CC1101_POWER_SETTING_433MHZ;
    } else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) {
      powerSettings = CC1101_POWER_SETTING_868MHZ;
    } else if (frequencyMHz >= 900 && frequencyMHz <= 928) {
      powerSettings = CC1101_POWER_SETTING_915MHZ;
    } else {
      return 0;
    }
    const modulation = await cc1101GetModulation();
    const pa = await cc1101ReadBurstReg(CC1101_PATABLE_ADDR, 2);
    if (pa.length < 2) return 0;
    const current = (modulation === CC1101_MOD_ASK ? pa[1] : pa[0]) & 0xff;
    for (let i = 0; i < powerSettings.length && i < CC1101_POWER_LEVELS_DBM.length; i += 1) {
      if ((powerSettings[i] & 0xff) === current) {
        return CC1101_POWER_LEVELS_DBM[i];
      }
    }
    let closestIndex = 0;
    let smallestDifference = Number.MAX_VALUE;
    for (let i = 0; i < powerSettings.length && i < CC1101_POWER_LEVELS_DBM.length; i += 1) {
      const diff = Math.abs((powerSettings[i] & 0xff) - current);
      if (diff < smallestDifference) {
        smallestDifference = diff;
        closestIndex = i;
      }
    }
    return CC1101_POWER_LEVELS_DBM[closestIndex];
  }, [cc1101GetFrequencyMHz, cc1101GetModulation, cc1101ReadBurstReg]);

  const cc1101SetModulationAndPower = useCallback(
    async (modulation: number, dbm: number) => {
      const frequencyMHz = await cc1101GetFrequencyMHz();
      const powerIndex = CC1101_POWER_LEVELS_DBM.findIndex((value) => value === dbm);
      if (powerIndex < 0) return false;
      let powerSetting: number | null = null;
      if (frequencyMHz >= 300 && frequencyMHz <= 348) {
        powerSetting = CC1101_POWER_SETTING_315MHZ[powerIndex];
      } else if (frequencyMHz >= 378 && frequencyMHz <= 464) {
        powerSetting = CC1101_POWER_SETTING_433MHZ[powerIndex];
      } else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) {
        powerSetting = CC1101_POWER_SETTING_868MHZ[powerIndex];
      } else if (frequencyMHz >= 900 && frequencyMHz <= 928) {
        powerSetting = CC1101_POWER_SETTING_915MHZ[powerIndex];
      } else {
        return false;
      }
      const currentMdmcfg2 = await readReg(CC1101_REG_MDMCFG2);
      const newMdmcfg2 = ((currentMdmcfg2 & 0x0f) | ((modulation & 0x07) << 4)) & 0xff;
      const frend0 = modulation === CC1101_MOD_ASK ? 0x11 : 0x10;
      await writeReg(CC1101_REG_MDMCFG2, newMdmcfg2);
      await writeReg(CC1101_REG_FREND0, frend0);
      const paTable = new Array(CC1101_PA_TABLE_SIZE).fill(0);
      if (modulation === CC1101_MOD_ASK) {
        paTable[1] = powerSetting;
      } else {
        paTable[0] = powerSetting;
      }
      const ok = await cc1101WriteBurstReg(CC1101_PATABLE_ADDR, paTable);
      if (!ok) return false;
      const confirmMdmcfg2 = await readReg(CC1101_REG_MDMCFG2);
      const confirmFrend0 = await readReg(CC1101_REG_FREND0);
      return confirmMdmcfg2 === newMdmcfg2 && confirmFrend0 === frend0;
    },
    [cc1101GetFrequencyMHz, cc1101WriteBurstReg, readReg, writeReg],
  );

  const refreshData = useCallback(async () => {
    if (!isConnected) {
      setStatusMessage("Device not connected.");
      return;
    }

    setStatusMessage("");
    abortRef.current.cancelled = false;
    setIsLoading(true);
    setLoadingProgress(0);

    const configRegisters = CC1101_CONFIG_REGISTERS;
    const statusRegisters = CC1101_STATUS_REGISTERS;
    const steps = configRegisters.length + statusRegisters.length + CC1101_PA_TABLE_SIZE + RF_PARAMETER_STEPS;
    setTotalLoadSteps(steps);

    try {
      const initOk = await ensureCc1101Init();
      if (!initOk) {
        setIsLoading(false);
        return;
      }
      if (abortRef.current.cancelled) {
        setIsLoading(false);
        return;
      }

      let completed = 0;
      const newRegisters: Record<string, string> = {};

      for (const name of configRegisters) {
        if (abortRef.current.cancelled) break;
        setCurrentCommand(`Reading ${name}...`);
        const addr = getRegisterAddress(name);
        const value = await readReg(addr);
        newRegisters[name] = value.toString(16).toUpperCase().padStart(2, "0");
        completed += 1;
        setLoadingProgress(completed);
      }

      for (const name of statusRegisters) {
        if (abortRef.current.cancelled) break;
        setCurrentCommand(`Reading ${name}...`);
        const addr = getRegisterAddress(name);
        const value = await readReg(addr);
        newRegisters[name] = value.toString(16).toUpperCase().padStart(2, "0");
        completed += 1;
        setLoadingProgress(completed);
      }

      const paTable = await cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
      for (let i = 0; i < Math.min(paTable.length, CC1101_PA_TABLE_SIZE); i += 1) {
        if (abortRef.current.cancelled) break;
        const key = `PA_TABLE${i}`;
        newRegisters[key] = paTable[i].toString(16).toUpperCase().padStart(2, "0");
        completed += 1;
        setLoadingProgress(completed);
      }

      let rfParamsData: RfParameters | null = null;
      if (!abortRef.current.cancelled) {
        setCurrentCommand("Reading frequency...");
        const frequencyMHz = await cc1101GetFrequencyMHz();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading data rate...");
        const dataRate = await cc1101GetDataRate();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading bandwidth...");
        const bandwidth = await cc1101GetBandwidthKHz();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading deviation...");
        const deviation = await cc1101GetDeviation();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading modulation...");
        const modulation = await cc1101GetModulation();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading TX power...");
        const txPower = await cc1101GetPowerLevel();
        completed += 1;
        setLoadingProgress(completed);

        rfParamsData = {
          frequencyMHz,
          dataRate,
          bandwidth,
          deviation,
          modulation,
          txPower,
        };
      }

      if (!abortRef.current.cancelled) {
        setRegisters(newRegisters);
        setRfParams(rfParamsData);
      }
    } catch (error) {
      setStatusMessage(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
      setCurrentCommand("");
    }
  }, [
    cc1101GetBandwidthKHz,
    cc1101GetDataRate,
    cc1101GetDeviation,
    cc1101GetFrequencyMHz,
    cc1101GetModulation,
    cc1101GetPowerLevel,
    cc1101ReadBurstReg,
    ensureCc1101Init,
    getRegisterAddress,
    isConnected,
    readReg,
  ]);

  const openHexEditDialog = (title: string, value: string, onSave: (val: string) => Promise<void>) => {
    setEditDialog({
      isOpen: true,
      title,
      value,
      mode: "hex",
      allowDecimal: false,
      onSave,
    });
  };

  const openNumberEditDialog = (
    title: string,
    value: string,
    allowDecimal: boolean,
    onSave: (val: string) => Promise<void>,
  ) => {
    setEditDialog({
      isOpen: true,
      title,
      value,
      mode: "number",
      allowDecimal,
      onSave,
    });
  };

  const handleEditRegister = (name: string) => {
    const currentVal = registers[name] ?? "";
    openHexEditDialog(`Edit ${name}`, currentVal, async (newVal) => {
      const parsed = Number.parseInt(newVal, 16);
      if (!Number.isFinite(parsed)) {
        setStatusMessage("Invalid hexadecimal value.");
        return;
      }
      if (name.startsWith("PA_TABLE")) {
        const index = Number.parseInt(name.replace("PA_TABLE", ""), 10);
        if (!Number.isFinite(index) || index < 0 || index >= CC1101_PA_TABLE_SIZE) {
          setStatusMessage("Invalid PA table index.");
          return;
        }
        const table = await cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
        if (table.length < CC1101_PA_TABLE_SIZE) {
          setStatusMessage("Failed to read PA table.");
          return;
        }
        table[index] = parsed & 0xff;
        const ok = await cc1101WriteBurstReg(CC1101_PATABLE_ADDR, Array.from(table));
        if (!ok) {
          setStatusMessage("Failed to write PA table.");
          return;
        }
        const verify = await cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
        if (verify.length >= CC1101_PA_TABLE_SIZE) {
          const updated: Record<string, string> = { ...registers };
          for (let i = 0; i < CC1101_PA_TABLE_SIZE; i += 1) {
            updated[`PA_TABLE${i}`] = verify[i].toString(16).toUpperCase().padStart(2, "0");
          }
          setRegisters(updated);
          return;
        }
      } else {
        await writeReg(getRegisterAddress(name), parsed);
      }
      const confirm = await readReg(getRegisterAddress(name));
      setRegisters((prev) => ({
        ...prev,
        [name]: confirm.toString(16).toUpperCase().padStart(2, "0"),
      }));
    });
  };

  const handleEditRfParam = (param: keyof RfParameters, title: string) => {
    if (!rfParams) return;
    const value = rfParams[param];
    const allowDecimal = param === "frequencyMHz" || param === "bandwidth";
    openNumberEditDialog(title, String(value), allowDecimal, async (newVal) => {
      const numeric = Number.parseFloat(newVal);
      if (!Number.isFinite(numeric)) {
        setStatusMessage("Invalid value.");
        return;
      }
      let appliedValue = numeric;
      let ok = true;
      if (param === "frequencyMHz") {
        ok = await cc1101SetFrequencyMHz(numeric);
      } else if (param === "dataRate") {
        appliedValue = Math.round(numeric);
        ok = await cc1101SetDataRate(appliedValue);
      } else if (param === "bandwidth") {
        ok = await cc1101SetBandwidth(numeric);
      } else if (param === "deviation") {
        appliedValue = Math.round(numeric);
        ok = await cc1101SetDeviation(appliedValue);
      }
      if (!ok) {
        setStatusMessage(`Failed to set ${title.toLowerCase()}.`);
        return;
      }
      setRfParams((prev) => (prev ? { ...prev, [param]: appliedValue } : prev));
    });
  };

  const modulationOptions = useMemo(() => CC1101_MODULATION_OPTIONS, []);
  const powerOptions = useMemo(() => CC1101_POWER_LEVELS_DBM, []);

  return (
    <section className="flex flex-1 flex-col bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">ISM</h2>
          <p className="text-sm text-slate-400">CC1101 control and registers</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Device</h3>

              <button
                onClick={refreshData}
                disabled={!isConnected || isLoading}
                className="w-full rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Initialize & Read
              </button>

              <p className="text-xs text-slate-400">TX power updates PATABLE[0] and PATABLE[1] for ASK/OOK.</p>

              {statusMessage && <p className="text-xs text-amber-300">{statusMessage}</p>}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">RF Parameters</h3>
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Frequency (MHz)</span>
                  <button
                    className="text-sm font-mono text-slate-200 hover:text-blue-300"
                    onClick={() => handleEditRfParam("frequencyMHz", "Frequency (MHz)")}
                    disabled={!rfParams}
                  >
                    {rfParams ? rfParams.frequencyMHz.toFixed(6) : "--"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Data Rate (bps)</span>
                  <button
                    className="text-sm font-mono text-slate-200 hover:text-blue-300"
                    onClick={() => handleEditRfParam("dataRate", "Data Rate (bps)")}
                    disabled={!rfParams}
                  >
                    {rfParams ? rfParams.dataRate : "--"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Bandwidth</span>
                  <button
                    className="text-sm font-mono text-slate-200 hover:text-blue-300"
                    onClick={() => handleEditRfParam("bandwidth", "Bandwidth")}
                    disabled={!rfParams}
                  >
                    {rfParams ? rfParams.bandwidth.toFixed(1) : "--"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Deviation (Hz)</span>
                  <button
                    className="text-sm font-mono text-slate-200 hover:text-blue-300"
                    onClick={() => handleEditRfParam("deviation", "Deviation (Hz)")}
                    disabled={!rfParams}
                  >
                    {rfParams ? rfParams.deviation : "--"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Modulation</span>
                  <select
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                    value={rfParams ? rfParams.modulation : modulationOptions[0].value}
                    onChange={async (event) => {
                      if (!rfParams) return;
                      const value = Number.parseInt(event.target.value, 10);
                      const ok = await cc1101SetModulationAndPower(value, rfParams.txPower);
                      if (!ok) {
                        setStatusMessage("Failed to update CC1101 modulation/power.");
                        return;
                      }
                      setRfParams((prev) => (prev ? { ...prev, modulation: value } : prev));
                    }}
                    disabled={!rfParams}
                  >
                    {modulationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">TX Power (dBm)</span>
                  <select
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                    value={rfParams ? rfParams.txPower : powerOptions[0]}
                    onChange={async (event) => {
                      if (!rfParams) return;
                      const value = Number.parseInt(event.target.value, 10);
                      const ok = await cc1101SetModulationAndPower(rfParams.modulation, value);
                      if (!ok) {
                        setStatusMessage("Failed to update CC1101 modulation/power.");
                        return;
                      }
                      setRfParams((prev) => (prev ? { ...prev, txPower: value } : prev));
                    }}
                    disabled={!rfParams}
                  >
                    {powerOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Registers</h3>

            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Config</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {CC1101_CONFIG_REGISTERS.map((name) => (
                    <button
                      key={name}
                      className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left hover:border-slate-600"
                      onClick={() => handleEditRegister(name)}
                    >
                      <span className="text-[10px] uppercase text-slate-500">{name}</span>
                      <span className="font-mono text-sm text-slate-200">{registers[name] ?? "--"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {CC1101_STATUS_REGISTERS.map((name) => (
                    <button
                      key={name}
                      className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left hover:border-slate-600"
                      onClick={() => handleEditRegister(name)}
                    >
                      <span className="text-[10px] uppercase text-slate-500">{name}</span>
                      <span className="font-mono text-sm text-slate-200">{registers[name] ?? "--"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">PA Table</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {Array.from({ length: CC1101_PA_TABLE_SIZE }, (_, index) => {
                    const name = `PA_TABLE${index}`;
                    return (
                      <button
                        key={name}
                        className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left hover:border-slate-600"
                        onClick={() => handleEditRegister(name)}
                      >
                        <span className="text-[10px] uppercase text-slate-500">{name}</span>
                        <span className="font-mono text-sm text-slate-200">{registers[name] ?? "--"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">Initializing CC1101</h3>
            <div className="w-full bg-slate-800 rounded-full h-3 mb-3 overflow-hidden">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-100 ease-linear"
                style={{
                  width: totalLoadSteps > 0 ? `${Math.round((loadingProgress / totalLoadSteps) * 100)}%` : "0%",
                }}
              ></div>
            </div>
            <div className="text-xs text-slate-400 mb-2">
              <span>
                {loadingProgress} / {totalLoadSteps}
              </span>
            </div>
            <div className="text-xs text-slate-500 mb-4 font-mono break-all min-h-[1rem]">
              {currentCommand || "Preparing..."}
            </div>
            <button
              onClick={() => {
                abortRef.current.cancelled = true;
                setIsLoading(false);
              }}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editDialog.isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-80 border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">{editDialog.title}</h3>
            <input
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded p-2 mb-4 font-mono"
              value={editDialog.value}
              onChange={(e) => setEditDialog((prev) => ({ ...prev, value: e.target.value }))}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditDialog((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const value = editDialog.value.trim();
                  const hexOk = /^[0-9a-fA-F]+$/.test(value);
                  const numberOk = editDialog.allowDecimal
                    ? /^[0-9]+(\\.[0-9]+)?$/.test(value)
                    : /^[0-9]+$/.test(value);
                  if (editDialog.mode === "hex" && !hexOk) {
                    setStatusMessage("Invalid hexadecimal value.");
                    return;
                  }
                  if (editDialog.mode === "number" && !numberOk) {
                    setStatusMessage("Invalid number value.");
                    return;
                  }
                  editDialog.onSave(value);
                  setEditDialog((prev) => ({ ...prev, isOpen: false }));
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
