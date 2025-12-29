import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevice } from "../utils/DeviceContext";
import {
  CONFIG_REGISTERS as RFM69_CONFIG_REGISTERS,
  STATUS_REGISTERS as RFM69_STATUS_REGISTERS,
  REGISTER_MAP as RFM69_REGISTER_MAP,
  MOD_FSK,
  MOD_OOK,
} from "../utils/RFM69";

type RadioChip = "UNKNOWN" | "CC1101" | "RFM69";

const CHIP_STORAGE_KEY = "ism_selected_chip";
const CS_PIN_STORAGE_KEY = "rfm69_cs_pin";
const CS_ACTIVE_HIGH_STORAGE_KEY = "rfm69_cs_active_high";
const SETTINGS_EVENT = "emwaver-settings-change";

const RF_PARAMETER_STEPS = 6;

const DEFAULT_RFM69_MISO = 13;
const DEFAULT_RFM69_MOSI = 11;
const DEFAULT_RFM69_SCK = 12;
const DEFAULT_RFM69_CS = 36;
const DEFAULT_RFM69_CS_ACTIVE_HIGH = true;

const DEFAULT_CC1101_MISO = 13;
const DEFAULT_CC1101_MOSI = 11;
const DEFAULT_CC1101_SCK = 12;
const DEFAULT_CC1101_CS = 10;
const DEFAULT_CC1101_CS_ACTIVE_HIGH = false;

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

const CHIP_OPTIONS: { label: string; value: RadioChip }[] = [
  { label: "Select chip...", value: "UNKNOWN" },
  { label: "CC1101", value: "CC1101" },
  { label: "RFM69", value: "RFM69" },
];

const CC1101_MODULATION_OPTIONS = [
  { label: "2-FSK", value: CC1101_MOD_2FSK },
  { label: "GFSK", value: CC1101_MOD_GFSK },
  { label: "ASK/OOK", value: CC1101_MOD_ASK },
  { label: "4-FSK", value: CC1101_MOD_4FSK },
  { label: "MSK", value: CC1101_MOD_MSK },
];

const RFM69_MODULATION_OPTIONS = [
  { label: "FSK", value: MOD_FSK },
  { label: "OOK", value: MOD_OOK },
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

function getInitialChip(): RadioChip {
  const stored = localStorage.getItem(CHIP_STORAGE_KEY);
  if (stored === "CC1101" || stored === "RFM69") {
    return stored;
  }
  return "UNKNOWN";
}

export default function ISMFragment() {
  const { status, send } = useDevice();

  const [selectedChip, setSelectedChip] = useState<RadioChip>(() => getInitialChip());
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalLoadSteps, setTotalLoadSteps] = useState(0);
  const [currentCommand, setCurrentCommand] = useState("");
  const [registers, setRegisters] = useState<Record<string, string>>({});
  const [rfParams, setRfParams] = useState<RfParameters | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const [csPin, setCsPin] = useState<string>(() => {
    const stored = localStorage.getItem(CS_PIN_STORAGE_KEY);
    return stored || String(DEFAULT_RFM69_CS);
  });
  const [csActiveHigh, setCsActiveHigh] = useState<boolean>(() => {
    const stored = localStorage.getItem(CS_ACTIVE_HIGH_STORAGE_KEY);
    return stored ? stored === "true" : DEFAULT_RFM69_CS_ACTIVE_HIGH;
  });
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [tempCsPin, setTempCsPin] = useState(csPin);
  const [tempCsActiveHigh, setTempCsActiveHigh] = useState(csActiveHigh);

  const [editDialog, setEditDialog] = useState<EditDialogState>({
    isOpen: false,
    title: "",
    value: "",
    mode: "hex",
    allowDecimal: false,
    onSave: async () => {},
  });

  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (detail?.scope && detail.scope !== "ism") {
        return;
      }
      const storedPin = localStorage.getItem(CS_PIN_STORAGE_KEY);
      const storedActive = localStorage.getItem(CS_ACTIVE_HIGH_STORAGE_KEY);
      const nextPin = storedPin || String(DEFAULT_RFM69_CS);
      const nextActive = storedActive ? storedActive === "true" : DEFAULT_RFM69_CS_ACTIVE_HIGH;
      setCsPin(nextPin);
      setCsActiveHigh(nextActive);
      setTempCsPin(nextPin);
      setTempCsActiveHigh(nextActive);
    };

    window.addEventListener(SETTINGS_EVENT, handler);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, handler);
    };
  }, []);

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

  const isPaddedPacket = (response: Uint8Array | null, first: number) => {
    if (!response || response.length !== 64) return false;
    if (response[0] !== first) return false;
    for (let i = 1; i < response.length; i++) {
      if (response[i] !== 0) return false;
    }
    return true;
  };

  const isOkAck = (response: Uint8Array | null) =>
    (!!response && response.length === 1 && response[0] === 0x00) || isPaddedPacket(response, 0x00);
  const isErr = (response: Uint8Array | null) =>
    (!!response && response.length === 1 && response[0] === 0xff) || isPaddedPacket(response, 0xff);

  const parseRawPayload = (response: Uint8Array | null) => {
    if (!response || response.length === 0) return new Uint8Array(0);
    if (isOkAck(response) || isErr(response)) return new Uint8Array(0);
    return response;
  };

  const parseRawString = (response: Uint8Array | null) => {
    if (!response || response.length === 0) return "";
    if (isOkAck(response) || isErr(response)) return "";
    const firstZero = response.indexOf(0);
    const end = firstZero >= 0 ? firstZero : response.length;
    return new TextDecoder().decode(response.slice(0, end)).trim();
  };

  const getConfigRegisters = useMemo(() => {
    if (selectedChip === "CC1101") return CC1101_CONFIG_REGISTERS;
    if (selectedChip === "RFM69") return RFM69_CONFIG_REGISTERS;
    return [];
  }, [selectedChip]);

  const getStatusRegisters = useMemo(() => {
    if (selectedChip === "CC1101") return CC1101_STATUS_REGISTERS;
    if (selectedChip === "RFM69") return RFM69_STATUS_REGISTERS;
    return [];
  }, [selectedChip]);

  const getRegisterAddress = useCallback(
    (name: string) => {
      if (selectedChip === "CC1101") {
        return CC1101_REGISTER_MAP[name] ?? 0;
      }
      return RFM69_REGISTER_MAP[name] ?? 0;
    },
    [selectedChip],
  );

  const readReg = useCallback(
    async (addr: number) => {
      const verb = selectedChip === "CC1101" ? "cc1101" : "rfm69";
      const response = await sendCommandString(`${verb} read --reg=${addr}`, 1000);
      if (isErr(response)) return 0;
      const payload = parseRawPayload(response);
      return payload.length > 0 ? payload[0] : 0;
    },
    [parseRawPayload, selectedChip, sendCommandString],
  );

  const writeReg = useCallback(
    async (addr: number, value: number) => {
      const verb = selectedChip === "CC1101" ? "cc1101" : "rfm69";
      await sendCommandString(`${verb} write --reg=${addr} --val=${value}`, 1000);
    },
    [selectedChip, sendCommandString],
  );

  const cc1101ReadBurstReg = useCallback(
    async (addr: number, len: number) => {
      if (selectedChip !== "CC1101") return new Uint8Array(0);
      const packets = Math.max(1, Math.ceil(len / 64));
      const response = await sendCommandString(
        `cc1101 read_burst --reg=${addr} --len=${len}`,
        1500,
        packets,
      );
      if (isErr(response)) return new Uint8Array(0);
      const payload = parseRawPayload(response);
      return payload.slice(0, len);
    },
    [parseRawPayload, selectedChip, sendCommandString],
  );

  const cc1101WriteBurstReg = useCallback(
    async (addr: number, data: number[]) => {
      if (selectedChip !== "CC1101") return false;
      const payload = data
        .map((value) => `0x${value.toString(16).padStart(2, "0").toUpperCase()}`)
        .join(",");
      const response = await sendCommandString(`cc1101 write_burst --reg=${addr} --data=${payload}`, 1500);
      return isOkAck(response);
    },
    [selectedChip, sendCommandString],
  );

  const ensureRfm69Init = useCallback(async () => {
    const cs = Number.parseInt(csPin.trim(), 10);
    if (!Number.isFinite(cs)) {
      setStatusMessage("Invalid RFM69 CS pin.");
      return false;
    }
    // Keep commands <=64 bytes for the desktop BLE transport. Firmware already has sane defaults
    // for MISO/MOSI/SCK; only override CS polarity/pin here.
    const command = `rfm69 init --cs=${cs} --cs_active_high=${csActiveHigh ? 1 : 0}`;
    const response = await sendCommandString(command, 2000);
    if (isOkAck(response)) return true;
    if (isErr(response)) {
      setStatusMessage("RFM69 init failed: device returned error.");
      return false;
    }
    if (!response || response.length === 0) {
      setStatusMessage("RFM69 init failed: no response.");
      return false;
    }
    setStatusMessage("RFM69 init failed: unexpected response.");
    return false;
  }, [csActiveHigh, csPin, sendCommandString]);

  const ensureCc1101Init = useCallback(async () => {
    const probe = await sendCommandString("cc1101 read --reg=49", 1000);
    if (probe && probe.length > 0 && !isErr(probe)) {
      return true;
    }
    // Keep commands <=64 bytes for the desktop BLE transport. Firmware defaults cover pinout.
    const command = `cc1101 init --cs=${DEFAULT_CC1101_CS} --cs_active_high=${DEFAULT_CC1101_CS_ACTIVE_HIGH ? 1 : 0}`;
    const response = await sendCommandString(command, 1500);
    if (isOkAck(response)) return true;
    if (isErr(response)) {
      setStatusMessage("CC1101 init failed: device returned error.");
      return false;
    }
    if (!response || response.length === 0) {
      setStatusMessage("CC1101 init failed: no response.");
      return false;
    }
    setStatusMessage("CC1101 init failed: unexpected response.");
    return false;
  }, [sendCommandString]);

  const ensureSelectedChipInit = useCallback(async () => {
    if (selectedChip === "RFM69") {
      return ensureRfm69Init();
    }
    if (selectedChip === "CC1101") {
      return ensureCc1101Init();
    }
    return false;
  }, [ensureCc1101Init, ensureRfm69Init, selectedChip]);

  const cc1101Strobe = useCallback(
    async (cmd: number) => {
      await sendCommandString(`cc1101 strobe --cmd=${cmd}`, 1000);
    },
    [sendCommandString],
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

  const rfm69GetFrequency = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_freq", 1000);
    const str = parseRawString(response);
    const value = Number.parseFloat(str);
    return Number.isFinite(value) ? value : 0;
  }, [parseRawString, sendCommandString]);

  const rfm69SetFrequency = useCallback(
    async (frequencyMHz: number) => {
      await sendCommandString(`rfm69 set_freq --mhz=${frequencyMHz.toFixed(6)}`, 1000);
    },
    [sendCommandString],
  );

  const rfm69GetDataRate = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_bitrate", 1000);
    const value = Number.parseInt(parseRawString(response), 10);
    return Number.isFinite(value) ? value : 0;
  }, [parseRawString, sendCommandString]);

  const rfm69SetDataRate = useCallback(
    async (bitRate: number) => {
      await sendCommandString(`rfm69 set_bitrate --bps=${bitRate}`, 1000);
    },
    [sendCommandString],
  );

  const rfm69GetBandwidth = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_bw", 1000);
    const value = Number.parseFloat(parseRawString(response));
    return Number.isFinite(value) ? value : 0;
  }, [parseRawString, sendCommandString]);

  const rfm69SetBandwidth = useCallback(
    async (bw: number) => {
      await sendCommandString(`rfm69 set_bw --val=${bw}`, 1000);
    },
    [sendCommandString],
  );

  const rfm69GetDeviation = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_dev", 1000);
    const value = Number.parseInt(parseRawString(response), 10);
    return Number.isFinite(value) ? value : 0;
  }, [parseRawString, sendCommandString]);

  const rfm69SetDeviation = useCallback(
    async (hz: number) => {
      await sendCommandString(`rfm69 set_dev --hz=${hz}`, 1000);
    },
    [sendCommandString],
  );

  const rfm69GetModulation = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_mod", 1000);
    return parseRawString(response).toLowerCase() === "ook" ? MOD_OOK : MOD_FSK;
  }, [parseRawString, sendCommandString]);

  const rfm69GetPower = useCallback(async () => {
    const response = await sendCommandString("rfm69 get_power", 1000);
    const value = Number.parseInt(parseRawString(response), 10);
    return Number.isFinite(value) ? value : 0;
  }, [parseRawString, sendCommandString]);

  const refreshData = useCallback(async () => {
    if (!isConnected) {
      setStatusMessage("Device not connected.");
      return;
    }
    if (selectedChip === "UNKNOWN") {
      setStatusMessage("Select a radio chip first.");
      return;
    }

    setStatusMessage("");
    abortRef.current.cancelled = false;
    setIsLoading(true);
    setLoadingProgress(0);

    const configRegisters = getConfigRegisters;
    const statusRegisters = getStatusRegisters;
    let steps = configRegisters.length + statusRegisters.length;
    if (selectedChip === "CC1101") {
      steps += CC1101_PA_TABLE_SIZE;
    }
    steps += RF_PARAMETER_STEPS;
    setTotalLoadSteps(steps);

    try {
      const initOk = await ensureSelectedChipInit();
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

      if (selectedChip === "CC1101") {
        const paTable = await cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
        for (let i = 0; i < Math.min(paTable.length, CC1101_PA_TABLE_SIZE); i += 1) {
          if (abortRef.current.cancelled) break;
          const key = `PA_TABLE${i}`;
          newRegisters[key] = paTable[i].toString(16).toUpperCase().padStart(2, "0");
          completed += 1;
          setLoadingProgress(completed);
        }
      }

      let rfParamsData: RfParameters | null = null;
      if (!abortRef.current.cancelled) {
        setCurrentCommand("Reading frequency...");
        const frequencyMHz =
          selectedChip === "CC1101" ? await cc1101GetFrequencyMHz() : await rfm69GetFrequency();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading data rate...");
        const dataRate = selectedChip === "CC1101" ? await cc1101GetDataRate() : await rfm69GetDataRate();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading bandwidth...");
        const bandwidth =
          selectedChip === "CC1101" ? await cc1101GetBandwidthKHz() : await rfm69GetBandwidth();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading deviation...");
        const deviation = selectedChip === "CC1101" ? await cc1101GetDeviation() : await rfm69GetDeviation();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading modulation...");
        const modulation = selectedChip === "CC1101" ? await cc1101GetModulation() : await rfm69GetModulation();
        completed += 1;
        setLoadingProgress(completed);

        setCurrentCommand("Reading TX power...");
        const txPower = selectedChip === "CC1101" ? await cc1101GetPowerLevel() : await rfm69GetPower();
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
    ensureSelectedChipInit,
    getConfigRegisters,
    getRegisterAddress,
    getStatusRegisters,
    isConnected,
    readReg,
    rfm69GetBandwidth,
    rfm69GetDataRate,
    rfm69GetDeviation,
    rfm69GetFrequency,
    rfm69GetModulation,
    rfm69GetPower,
    selectedChip,
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
      if (selectedChip === "CC1101" && name.startsWith("PA_TABLE")) {
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
    const allowDecimal = param === "frequencyMHz" || (selectedChip === "CC1101" && param === "bandwidth");
    openNumberEditDialog(title, String(value), allowDecimal, async (newVal) => {
      const numeric = Number.parseFloat(newVal);
      if (!Number.isFinite(numeric)) {
        setStatusMessage("Invalid value.");
        return;
      }
      let appliedValue = numeric;
      if (selectedChip === "CC1101") {
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
      } else {
        if (param === "frequencyMHz") {
          await rfm69SetFrequency(numeric);
        } else if (param === "dataRate") {
          appliedValue = Math.round(numeric);
          await rfm69SetDataRate(appliedValue);
        } else if (param === "bandwidth") {
          appliedValue = Math.round(numeric);
          await rfm69SetBandwidth(appliedValue);
        } else if (param === "deviation") {
          appliedValue = Math.round(numeric);
          await rfm69SetDeviation(appliedValue);
        }
      }
      setRfParams((prev) => (prev ? { ...prev, [param]: appliedValue } : prev));
    });
  };

  const handleChipChange = (value: RadioChip) => {
    setSelectedChip(value);
    localStorage.setItem(CHIP_STORAGE_KEY, value);
    setRegisters({});
    setRfParams(null);
    setStatusMessage("");
  };

  const handleSaveSettings = async () => {
    const pinNum = Number.parseInt(tempCsPin.trim(), 10);
    if (!Number.isFinite(pinNum) || pinNum <= 0) {
      setStatusMessage("Invalid CS pin value.");
      return;
    }
    setCsPin(tempCsPin);
    setCsActiveHigh(tempCsActiveHigh);
    localStorage.setItem(CS_PIN_STORAGE_KEY, tempCsPin);
    localStorage.setItem(CS_ACTIVE_HIGH_STORAGE_KEY, String(tempCsActiveHigh));
    setShowSettingsDialog(false);
  };

  const modulationOptions = selectedChip === "CC1101" ? CC1101_MODULATION_OPTIONS : RFM69_MODULATION_OPTIONS;
  const powerOptions = selectedChip === "CC1101" ? CC1101_POWER_LEVELS_DBM : [-30, -20, -15, -10, 0, 5, 7, 10];

  return (
    <section className="flex flex-1 flex-col bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">ISM</h2>
          <p className="text-sm text-slate-400">RFM69 + CC1101 control and registers</p>
        </div>
        <button
          onClick={() => {
            setTempCsPin(csPin);
            setTempCsActiveHigh(csActiveHigh);
            setShowSettingsDialog(true);
          }}
          className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded hover:bg-slate-700"
        >
          Settings
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-4">
              <div>
                <label className="text-xs uppercase text-slate-400">Chip</label>
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={selectedChip}
                  onChange={(event) => handleChipChange(event.target.value as RadioChip)}
                >
                  {CHIP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={refreshData}
                disabled={!isConnected || selectedChip === "UNKNOWN" || isLoading}
                className="w-full rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Initialize & Read
              </button>

              {selectedChip === "CC1101" && (
                <p className="text-xs text-slate-400">
                  CC1101 note: TX Power updates PATABLE[0] and PATABLE[1] for ASK/OOK.
                </p>
              )}

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
                      if (selectedChip === "CC1101") {
                        const ok = await cc1101SetModulationAndPower(value, rfParams.txPower);
                        if (!ok) {
                          setStatusMessage("Failed to update CC1101 modulation/power.");
                          return;
                        }
                      } else {
                        await sendCommandString(`rfm69 set_mod --mod=${value === MOD_OOK ? "ook" : "fsk"}`, 1000);
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
                      if (selectedChip === "CC1101") {
                        const ok = await cc1101SetModulationAndPower(rfParams.modulation, value);
                        if (!ok) {
                          setStatusMessage("Failed to update CC1101 modulation/power.");
                          return;
                        }
                      } else {
                        await sendCommandString(`rfm69 set_power --dbm=${value}`, 1000);
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
            {selectedChip === "UNKNOWN" ? (
              <p className="text-sm text-slate-400">Select a chip, then tap Initialize & Read.</p>
            ) : (
              <>
                <div>
                  <h4 className="text-xs uppercase text-slate-500 mb-2">Configuration</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {getConfigRegisters.map((name) => (
                      <button
                        key={name}
                        className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left hover:border-slate-600"
                        onClick={() => handleEditRegister(name)}
                      >
                        <span className="text-[10px] uppercase text-slate-500">{name}</span>
                        <span className="font-mono text-sm text-slate-200">
                          {registers[name] ?? "--"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs uppercase text-slate-500 mb-2">Status</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {getStatusRegisters.map((name) => (
                      <div
                        key={name}
                        className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5"
                      >
                        <span className="text-[10px] uppercase text-slate-500">{name}</span>
                        <span className="font-mono text-sm text-slate-200">
                          {registers[name] ?? "--"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {selectedChip === "CC1101" && (
                  <div>
                    <h4 className="text-xs uppercase text-slate-500 mb-2">PA Table</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Array.from({ length: CC1101_PA_TABLE_SIZE }, (_, index) => {
                        const name = `PA_TABLE${index}`;
                        return (
                          <button
                            key={name}
                            className="flex flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left hover:border-slate-600"
                            onClick={() => handleEditRegister(name)}
                          >
                            <span className="text-[10px] uppercase text-slate-500">{name}</span>
                            <span className="font-mono text-sm text-slate-200">
                              {registers[name] ?? "--"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">
              Initializing {selectedChip === "CC1101" ? "CC1101" : "RFM69"}
            </h3>
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
                  const numberOk = editDialog.allowDecimal ? /^[0-9]+(\.[0-9]+)?$/.test(value) : /^[0-9]+$/.test(value);
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

      {showSettingsDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">ISM Settings</h3>
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-300">RFM69 CS Pin</label>
                <input
                  type="number"
                  value={tempCsPin}
                  onChange={(e) => setTempCsPin(e.target.value)}
                  className="w-24 bg-slate-950 border border-slate-700 text-slate-100 rounded px-3 py-2 text-sm"
                  min="1"
                  max="48"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-300">CS Active High</label>
                <input
                  type="checkbox"
                  checked={tempCsActiveHigh}
                  onChange={(e) => setTempCsActiveHigh(e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSettingsDialog(false)}
                className="px-4 py-2 text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
