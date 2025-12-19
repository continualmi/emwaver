import { useCallback, useState } from "react";
import { useDevice } from "../utils/DeviceContext";

const CC1101_F_XTAL_HZ = 26_000_000.0;
const DEFAULT_FREQ_MHZ = 433.92;
const DEFAULT_DATARATE_BPS = 2500;
const DEFAULT_TX_POWER_DBM = 10;

const DEFAULT_TESLA_SYNC_WORD = [0xcb, 0x8a];
const DEFAULT_TESLA_PAYLOAD = [
  0x32, 0xcc, 0xcc, 0xcb, 0x4d, 0x2d, 0x4a, 0xd3, 0x4c, 0xab, 0x4b, 0x15, 0x96, 0x65, 0x99, 0x99,
  0x96, 0x9a, 0x5a, 0x95, 0xa6, 0x99, 0x56, 0x96, 0x2b, 0x2c, 0xcb, 0x33, 0x33, 0x2d, 0x34, 0xb5,
  0x2b, 0x4d, 0x32, 0xad, 0x28,
];

const CC1101_SYNC1 = 0x04;
const CC1101_SYNC0 = 0x05;
const CC1101_PKTLEN = 0x06;
const CC1101_PKTCTRL0 = 0x08;
const CC1101_FREQ2 = 0x0d;
const CC1101_FREQ1 = 0x0e;
const CC1101_FREQ0 = 0x0f;
const CC1101_MDMCFG4 = 0x10;
const CC1101_MDMCFG2 = 0x12;
const CC1101_MDMCFG1 = 0x13;
const CC1101_DEVIATN = 0x15;

const CC1101_RXBYTES = 0x3b;
const CC1101_TXFIFO = 0x3f;
const CC1101_RXFIFO = 0x3f;

const CC1101_SRES = 0x30;
const CC1101_SCAL = 0x33;
const CC1101_SRX = 0x34;
const CC1101_STX = 0x35;
const CC1101_SIDLE = 0x36;
const CC1101_SFRX = 0x3a;
const CC1101_SFTX = 0x3b;

const MOD_2FSK = 0;
const MOD_ASK = 3;
const BYTES_IN_RXFIFO = 0x7f;
const PKTCTRL0_PACKET_MODE = 0x00;

const MODULATION_OPTIONS = ["ASK", "FSK"] as const;
const PREAMBLE_OPTIONS = ["2", "3", "4", "6", "8", "12", "16", "24"];
const SYNC_MODE_OPTIONS = [
  "No preamble/sync word",
  "15/16 bits",
  "16/16 bits",
  "30/32 bits",
  "No preamble/sync + carrier sense above threshold",
  "15/16 + carrier sense above threshold",
  "16/16 + carrier sense above threshold",
  "30/32 + carrier sense above threshold",
];

function sanitizeHex(value: string, maxLength?: number): string {
  const filtered = value
    .split("")
    .filter((ch) => /[0-9a-fA-F]/.test(ch))
    .join("")
    .toUpperCase();
  if (maxLength && filtered.length > maxLength) {
    return filtered.slice(0, maxLength);
  }
  return filtered;
}

function bytesToHexString(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function convertHexStringToByteArray(hexString: string): Uint8Array | null {
  const cleaned = sanitizeHex(hexString);
  if (cleaned.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
  }
  return bytes;
}

function isAckOk(response: Uint8Array | null): boolean {
  return !!response && response.length === 1 && response[0] === 0x00;
}

export default function PacketModeFragment() {
  const { status, sendCommand, addNotificationListener, removeNotificationListener } = useDevice();
  const [statusText, setStatusText] = useState("");
  const [manchesterEnabled, setManchesterEnabled] = useState(false);
  const [modulation, setModulation] = useState<(typeof MODULATION_OPTIONS)[number]>("ASK");
  const [preambleIndex, setPreambleIndex] = useState(1);
  const [syncModeIndex, setSyncModeIndex] = useState(2);
  const [syncWord, setSyncWord] = useState("CB8A");
  const [dataRate, setDataRate] = useState(String(DEFAULT_DATARATE_BPS));
  const [deviation, setDeviation] = useState("");
  const [rxPayload, setRxPayload] = useState("");
  const [txPayload, setTxPayload] = useState(bytesToHexString(DEFAULT_TESLA_PAYLOAD));

  const isConnected = status.connected;

  const awaitNotification = useCallback(
    (matcher: (data: Uint8Array) => boolean, timeoutMs: number) =>
      new Promise<Uint8Array | null>((resolve) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          removeNotificationListener(listener);
          resolve(null);
        }, timeoutMs);

        const listener = (data: Uint8Array) => {
          if (settled || !matcher(data)) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          removeNotificationListener(listener);
          resolve(data);
        };

        addNotificationListener(listener);
      }),
    [addNotificationListener, removeNotificationListener],
  );

  const sendCommandString = useCallback(
    async (command: string, timeoutMs = 1000, matcher?: (data: Uint8Array) => boolean) => {
      if (!status.connected) {
        return null;
      }
      const payload = new TextEncoder().encode(command.endsWith("\n") ? command : `${command}\n`);
      const responsePromise = awaitNotification(matcher ?? ((data) => data.length > 0), timeoutMs);
      await sendCommand(payload);
      return await responsePromise;
    },
    [awaitNotification, sendCommand, status.connected],
  );

  const spiStrobe = useCallback(
    async (commandStrobe: number) => {
      await sendCommandString(`cc1101 strobe --cmd=0x${commandStrobe.toString(16).padStart(2, "0")}`, 1000);
    },
    [sendCommandString],
  );

  const writeReg = useCallback(
    async (addr: number, data: number) => {
      await sendCommandString(
        `cc1101 write --reg=0x${addr.toString(16).padStart(2, "0")} --val=0x${data
          .toString(16)
          .padStart(2, "0")}`,
        1000,
      );
    },
    [sendCommandString],
  );

  const readReg = useCallback(
    async (addr: number) => {
      const response = await sendCommandString(
        `cc1101 read --reg=0x${addr.toString(16).padStart(2, "0")}`,
        1000,
        (data) => data.length > 0,
      );
      if (!response || response.length < 1) {
        return 0;
      }
      return response[0];
    },
    [sendCommandString],
  );

  const writeBurstReg = useCallback(
    async (addr: number, data: Uint8Array) => {
      if (!data || data.length === 0) {
        return;
      }
      const hex = Array.from(data)
        .map((value) => `0x${value.toString(16).padStart(2, "0").toUpperCase()}`)
        .join(",");
      await sendCommandString(`cc1101 write_burst --reg=0x${addr.toString(16).padStart(2, "0")} --data=${hex}`, 1000);
    },
    [sendCommandString],
  );

  const readBurstReg = useCallback(
    async (addr: number, len: number) => {
      if (len <= 0) {
        return new Uint8Array(0);
      }
      const response = await sendCommandString(
        `cc1101 read_burst --reg=0x${addr.toString(16).padStart(2, "0")} --len=${len}`,
        1000,
        (data) => data.length >= len,
      );
      if (!response || response.length < len) {
        return null;
      }
      return response.slice(0, len);
    },
    [sendCommandString],
  );

  const setModulationAndPower = useCallback(
    async (modValue: number, dbm: number) => {
      const response = await sendCommandString(`cc1101 set_mod_power --mod=${modValue} --dbm=${dbm}`, 1000);
      return isAckOk(response);
    },
    [sendCommandString],
  );

  const sendData = useCallback(
    async (txBuffer: Uint8Array, waitMs: number) => {
      if (!txBuffer || txBuffer.length === 0) {
        return;
      }
      await writeReg(CC1101_PKTCTRL0, PKTCTRL0_PACKET_MODE);
      await writeReg(CC1101_PKTLEN, txBuffer.length & 0xff);
      await spiStrobe(CC1101_SIDLE);
      await spiStrobe(CC1101_SFTX);
      await writeBurstReg(CC1101_TXFIFO, txBuffer);
      await spiStrobe(CC1101_STX);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await spiStrobe(CC1101_SIDLE);
      await spiStrobe(CC1101_SFTX);
    },
    [spiStrobe, writeBurstReg, writeReg],
  );

  const receiveData = useCallback(async () => {
    const sizeReading = await readReg(CC1101_RXBYTES);
    if ((sizeReading & BYTES_IN_RXFIFO) > 0) {
      const rxBuffer = await readBurstReg(CC1101_RXFIFO, sizeReading & 0xff);
      await spiStrobe(CC1101_SFRX);
      await spiStrobe(CC1101_SRX);
      return rxBuffer;
    }
    await spiStrobe(CC1101_SFRX);
    await spiStrobe(CC1101_SRX);
    return null;
  }, [readBurstReg, readReg, spiStrobe]);

  const setFrequencyMHz = useCallback(async (frequencyMHz: number) => {
    const word = Math.round((frequencyMHz * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ);
    const freq2 = (word >> 16) & 0xff;
    const freq1 = (word >> 8) & 0xff;
    const freq0 = word & 0xff;
    await writeReg(CC1101_FREQ2, freq2);
    await writeReg(CC1101_FREQ1, freq1);
    await writeReg(CC1101_FREQ0, freq0);
    await spiStrobe(CC1101_SIDLE);
    await spiStrobe(CC1101_SCAL);
  }, [spiStrobe, writeReg]);

  const setDataRateValue = useCallback(async (bitRate: number) => {
    const drateMMax = 255;
    const drateEMax = 15;
    const target = (bitRate * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
    let minDifference = Number.MAX_VALUE;
    let bestM = 0;
    let bestE = 0;

    for (let e = 0; e <= drateEMax; e += 1) {
      for (let m = 0; m <= drateMMax; m += 1) {
        const currentValue = (256 + m) * Math.pow(2, e);
        const difference = Math.abs(currentValue - target);
        if (difference < minDifference) {
          minDifference = difference;
          bestM = m;
          bestE = e;
        }
      }
    }

    const mdmcfg4Current = await readReg(CC1101_MDMCFG4);
    const bandwidthPart = mdmcfg4Current & 0xf0;
    const combinedE = bandwidthPart | (bestE & 0x0f);
    const mdmcfg = new Uint8Array([combinedE, bestM & 0xff]);
    await writeBurstReg(CC1101_MDMCFG4, mdmcfg);
    const confirmValue = await readBurstReg(CC1101_MDMCFG4, 2);
    return !!confirmValue && confirmValue[0] === mdmcfg[0] && confirmValue[1] === mdmcfg[1];
  }, [readBurstReg, readReg, writeBurstReg]);

  const setModulationValue = useCallback(async (modValue: number) => {
    let currentValue = await readReg(CC1101_MDMCFG2);
    const mask = 0b01110000;
    currentValue &= ~mask;
    currentValue |= (modValue << 4) & mask;
    await writeReg(CC1101_MDMCFG2, currentValue);
    const confirm = await readReg(CC1101_MDMCFG2);
    return confirm === currentValue;
  }, [readReg, writeReg]);

  const setManchesterEncoding = useCallback(async (enabled: boolean) => {
    let mdmcfg2 = await readReg(CC1101_MDMCFG2);
    if (enabled) {
      mdmcfg2 |= 0b00001000;
    } else {
      mdmcfg2 &= 0b11110111;
    }
    await writeReg(CC1101_MDMCFG2, mdmcfg2);
    return (await readReg(CC1101_MDMCFG2)) === mdmcfg2;
  }, [readReg, writeReg]);

  const setSyncMode = useCallback(async (syncMode: number) => {
    let currentValue = await readReg(CC1101_MDMCFG2);
    const mask = 0b00000111;
    currentValue &= ~mask;
    currentValue |= syncMode & mask;
    await writeReg(CC1101_MDMCFG2, currentValue);
    return (await readReg(CC1101_MDMCFG2)) === currentValue;
  }, [readReg, writeReg]);

  const setSyncWordValue = useCallback(async (sync: Uint8Array) => {
    if (sync.length !== 2) {
      return false;
    }
    await writeReg(CC1101_SYNC1, sync[0]);
    await writeReg(CC1101_SYNC0, sync[1]);
    const check1 = await readReg(CC1101_SYNC1);
    const check0 = await readReg(CC1101_SYNC0);
    return check1 === sync[0] && check0 === sync[1];
  }, [readReg, writeReg]);

  const setNumPreambleBytes = useCallback(async (index: number) => {
    if (index < 0 || index > 7) {
      return false;
    }
    let mdmcfg1 = await readReg(CC1101_MDMCFG1);
    mdmcfg1 &= 0b10001111;
    mdmcfg1 |= (index & 0x07) << 4;
    await writeReg(CC1101_MDMCFG1, mdmcfg1);
    return (await readReg(CC1101_MDMCFG1)) === mdmcfg1;
  }, [readReg, writeReg]);

  const setDeviationValue = useCallback(async (deviationHz: number) => {
    const deviationMMax = 7;
    const deviationEMax = 7;
    const target = (deviationHz * Math.pow(2, 17)) / CC1101_F_XTAL_HZ;
    let minDifference = Number.MAX_VALUE;
    let bestM = 0;
    let bestE = 0;

    for (let e = 0; e <= deviationEMax; e += 1) {
      for (let m = 0; m <= deviationMMax; m += 1) {
        const currentValue = (8 + m) * Math.pow(2, e);
        const difference = Math.abs(currentValue - target);
        if (difference < minDifference) {
          minDifference = difference;
          bestM = m;
          bestE = e;
        }
      }
    }

    const deviatn = ((bestE & 0x07) << 4) | (bestM & 0x07);
    await writeReg(CC1101_DEVIATN, deviatn);
    return (await readReg(CC1101_DEVIATN)) === deviatn;
  }, [readReg, writeReg]);

  const sendInit = useCallback(async () => {
    await sendCommandString("cc1101 init", 1500);
    await spiStrobe(CC1101_SRES);
    await sendCommandString("cc1101 apply_defaults", 1500);
    await writeReg(CC1101_PKTCTRL0, PKTCTRL0_PACKET_MODE);

    let defaultPktLen = DEFAULT_TESLA_PAYLOAD.length;
    const parsed = convertHexStringToByteArray(txPayload);
    if (parsed && parsed.length > 0) {
      defaultPktLen = parsed.length;
    }
    await writeReg(CC1101_PKTLEN, defaultPktLen & 0xff);

    await setFrequencyMHz(DEFAULT_FREQ_MHZ);
    await setDataRateValue(DEFAULT_DATARATE_BPS);
    await setModulationAndPower(MOD_ASK, DEFAULT_TX_POWER_DBM);
    await spiStrobe(CC1101_SIDLE);
    await spiStrobe(CC1101_SFTX);
  }, [sendCommandString, setDataRateValue, setFrequencyMHz, setModulationAndPower, spiStrobe, txPayload, writeReg]);

  const sendInitRx = useCallback(async () => {
    await sendInit();
    await spiStrobe(CC1101_SFRX);
    await spiStrobe(CC1101_SRX);
  }, [sendInit, spiStrobe]);

  const sendTeslaFromUi = useCallback(async () => {
    await sendInit();

    await setModulationAndPower(MOD_ASK, DEFAULT_TX_POWER_DBM);
    await setManchesterEncoding(false);
    await setSyncMode(2);
    await setNumPreambleBytes(1);

    const parsedRate = parseInt(dataRate, 10);
    if (!Number.isNaN(parsedRate)) {
      await setDataRateValue(parsedRate);
    }

    let syncWordBytes = new Uint8Array(DEFAULT_TESLA_SYNC_WORD);
    const parsedSync = convertHexStringToByteArray(syncWord);
    if (parsedSync && parsedSync.length === 2) {
      syncWordBytes = parsedSync;
    }
    await setSyncWordValue(syncWordBytes);

    let payload = convertHexStringToByteArray(txPayload);
    if (!payload || payload.length === 0) {
      payload = new Uint8Array(DEFAULT_TESLA_PAYLOAD);
    } else if (
      payload.length >= 5 &&
      payload[0] === 0xaa &&
      payload[1] === 0xaa &&
      payload[2] === 0xaa
    ) {
      const sw = payload.slice(3, 5);
      await setSyncWordValue(sw);
      payload = payload.slice(5);
    }

    if (payload.length === 0) {
      return false;
    }

    await sendData(payload, 300);
    return true;
  }, [
    dataRate,
    sendData,
    sendInit,
    setDataRateValue,
    setManchesterEncoding,
    setModulationAndPower,
    setNumPreambleBytes,
    setSyncMode,
    setSyncWordValue,
    syncWord,
    txPayload,
  ]);

  const handleManchesterToggle = async (enabled: boolean) => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const ok = await setManchesterEncoding(enabled);
    if (!ok) {
      setStatusText("Failed to set encoding");
      setManchesterEnabled(!enabled);
      return;
    }
    setManchesterEnabled(enabled);
    setStatusText(`Manchester encoding set to ${enabled}`);
  };

  const handleDataRateSubmit = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const value = parseInt(dataRate, 10);
    if (Number.isNaN(value)) {
      setStatusText("Invalid data rate entered");
      return;
    }
    const ok = await setDataRateValue(value);
    setStatusText(ok ? `Data rate set to ${value}` : "Error setting data rate");
  };

  const handleDeviationSubmit = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const value = parseInt(deviation, 10);
    if (Number.isNaN(value)) {
      setStatusText("Invalid deviation entered");
      return;
    }
    const ok = await setDeviationValue(value);
    setStatusText(ok ? `Deviation set to ${value}` : "Error setting deviation");
  };

  const handleSyncWordSubmit = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    if (syncWord.length !== 4) {
      setStatusText("Input must be a 4-character hex value");
      return;
    }
    const parsed = convertHexStringToByteArray(syncWord);
    if (!parsed || parsed.length !== 2) {
      setStatusText("Invalid hex input");
      return;
    }
    const ok = await setSyncWordValue(parsed);
    setStatusText(ok ? `Sync word set to ${syncWord}` : "Error setting sync word");
  };

  const handleModulationChange = async (value: (typeof MODULATION_OPTIONS)[number]) => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const modValue = value === "ASK" ? MOD_ASK : MOD_2FSK;
    const ok = await setModulationValue(modValue);
    setStatusText(ok ? `Modulation set to ${value}` : "Failed to set modulation");
    if (ok) {
      setModulation(value);
    }
  };

  const handlePreambleChange = async (index: number) => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const ok = await setNumPreambleBytes(index);
    setStatusText(ok ? `Preamble set to ${PREAMBLE_OPTIONS[index]}` : "Failed to set preamble");
    if (ok) {
      setPreambleIndex(index);
    }
  };

  const handleSyncModeChange = async (index: number) => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const ok = await setSyncMode(index);
    setStatusText(ok ? `Sync mode set to ${SYNC_MODE_OPTIONS[index]}` : "Failed to set sync mode");
    if (ok) {
      setSyncModeIndex(index);
    }
  };

  const handleReceivePayload = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const received = await receiveData();
    if (!received || received.length === 0) {
      setStatusText("No data in FIFO");
      return;
    }
    setRxPayload(bytesToHexString(received));
    setStatusText("RX payload received");
  };

  const handleSendTesla = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    const ok = await sendTeslaFromUi();
    setStatusText(ok ? "Sent" : "Send failed");
  };

  const handleInitTx = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    await sendInit();
    setStatusText("Init TX sent");
  };

  const handleInitRx = async () => {
    if (!isConnected) {
      setStatusText("Not connected");
      return;
    }
    await sendInitRx();
    setStatusText("Init RX sent");
  };

  return (
    <section className="flex flex-1 flex-col bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Packet Mode</h2>
          <p className="text-sm text-slate-400">CC1101 fixed-length packet tooling</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-6 py-5 overflow-y-auto">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSendTesla}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              disabled={!isConnected}
            >
              Send (Tesla)
            </button>
            <button
              onClick={handleInitTx}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
              disabled={!isConnected}
            >
              Init TX
            </button>
            <button
              onClick={handleInitRx}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
              disabled={!isConnected}
            >
              Init RX
            </button>
            <button
              onClick={handleReceivePayload}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              disabled={!isConnected}
            >
              Receive
            </button>
            <button
              onClick={() => setTxPayload(rxPayload)}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
              disabled={!rxPayload}
            >
              Copy RX {"->"} TX
            </button>
          </div>
          {statusText ? <div className="text-sm text-slate-300">{statusText}</div> : null}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 grid gap-4 lg:grid-cols-2">
          <label className="flex items-center justify-between text-sm text-slate-300">
            Manchester encoding
            <input
              type="checkbox"
              checked={manchesterEnabled}
              onChange={(event) => handleManchesterToggle(event.target.checked)}
              className="h-4 w-4"
            />
          </label>

          <div>
            <label className="text-xs text-slate-400 uppercase">Modulation</label>
            <select
              value={modulation}
              onChange={(event) => handleModulationChange(event.target.value as (typeof MODULATION_OPTIONS)[number])}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {MODULATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase">Preamble</label>
            <select
              value={preambleIndex}
              onChange={(event) => handlePreambleChange(Number(event.target.value))}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {PREAMBLE_OPTIONS.map((option, index) => (
                <option key={option} value={index}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase">Sync mode</label>
            <select
              value={syncModeIndex}
              onChange={(event) => handleSyncModeChange(Number(event.target.value))}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {SYNC_MODE_OPTIONS.map((option, index) => (
                <option key={option} value={index}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase">Sync word</label>
            <input
              value={syncWord}
              onChange={(event) => setSyncWord(sanitizeHex(event.target.value, 4))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSyncWordSubmit();
                }
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase">Data rate (bps)</label>
            <input
              value={dataRate}
              onChange={(event) => setDataRate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleDataRateSubmit();
                }
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase">Deviation (Hz)</label>
            <input
              value={deviation}
              onChange={(event) => setDeviation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleDeviationSubmit();
                }
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <label className="text-xs text-slate-400 uppercase">RX (hex)</label>
          <textarea
            value={rxPayload}
            onChange={(event) => setRxPayload(sanitizeHex(event.target.value))}
            className="mt-2 min-h-[120px] w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <label className="text-xs text-slate-400 uppercase">TX payload (hex, no preamble/sync)</label>
          <textarea
            value={txPayload}
            onChange={(event) => setTxPayload(sanitizeHex(event.target.value))}
            className="mt-2 min-h-[160px] w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
          />
        </div>
      </div>
    </section>
  );
}
