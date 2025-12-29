import { useCallback, useMemo, useState } from "react";
import { useDevice } from "../utils/DeviceContext";

const AUTH_MODES = [
  { label: "Key A", value: 0x60 },
  { label: "Key B", value: 0x61 },
];

const DEFAULT_KEYS = ["FF", "FF", "FF", "FF", "FF", "FF"];
const DEFAULT_DATA = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";

function sanitizeHex(value: string, maxLength: number, allowSpace = false): string {
  const filtered = value
    .split("")
    .filter((ch) => {
      if (allowSpace && ch === " ") {
        return true;
      }
      return /[0-9a-fA-F]/.test(ch);
    })
    .join("");
  const normalized = filtered.toUpperCase();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function buildHexCsv(values: string[]): string {
  return values
    .map((value) => {
      const trimmed = value.trim();
      const normalized = trimmed.length === 1 ? `0${trimmed}` : trimmed;
      return `0x${normalized.toUpperCase()}`;
    })
    .join(",");
}

function buildHexCsvFromString(hexString: string, expectedBytes: number): string {
  const cleaned = hexString.replace(/[^0-9a-fA-F]/g, "");
  const bytes: string[] = [];
  for (let i = 0; i < expectedBytes; i += 1) {
    const start = i * 2;
    const byteHex = start + 2 <= cleaned.length ? cleaned.slice(start, start + 2) : "00";
    bytes.push(`0x${byteHex.toUpperCase()}`);
  }
  return bytes.join(",");
}

function isAsciiPayload(data: Uint8Array): boolean {
  for (const byte of data) {
    const ch = byte & 0xff;
    if (ch === 0x0d || ch === 0x0a || ch === 0x09) {
      continue;
    }
    if (ch < 0x20 || ch > 0x7e) {
      return false;
    }
  }
  return true;
}

function extractRfidReadPayload(response: Uint8Array): Uint8Array | null {
  if (response.length === 22) {
    return response;
  }
  if (response.length < 22) {
    return null;
  }
  if (isAsciiPayload(response)) {
    return null;
  }

  for (let offset = 0; offset + 22 <= response.length; offset += 1) {
    const tagType = ((response[offset] & 0xff) << 8) | (response[offset + 1] & 0xff);
    if ([0x4400, 0x0400, 0x0200, 0x0800, 0x4403].includes(tagType)) {
      return response.slice(offset, offset + 22);
    }
  }

  return response.slice(0, 22);
}

function getTagType(b1: number, b2: number): string {
  const tagType = ((b1 & 0xff) << 8) | (b2 & 0xff);
  switch (tagType) {
    case 0x4400:
      return "Mifare_UltraLight";
    case 0x0400:
      return "Mifare_One(S50)";
    case 0x0200:
      return "Mifare_One(S70)";
    case 0x0800:
      return "Mifare_Pro(X)";
    case 0x4403:
      return "Mifare_DESFire";
    default:
      return "Unknown";
  }
}

export default function RfidFragment() {
  const { status, send } = useDevice();
  const [blockAddress, setBlockAddress] = useState("00");
  const [keys, setKeys] = useState<string[]>(DEFAULT_KEYS);
  const [combinedData, setCombinedData] = useState(DEFAULT_DATA);
  const [authModeIndex, setAuthModeIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [resultDialog, setResultDialog] = useState<{ open: boolean; result: string; data: string }>({
    open: false,
    result: "",
    data: "",
  });

  const isConnected = status.connected;
  const authValue = useMemo(() => AUTH_MODES[authModeIndex]?.value ?? 0x60, [authModeIndex]);

  const sendAsciiCommand = useCallback(
    async (command: string, timeoutMs: number) => {
      if (!status.connected) {
        return null;
      }
      return await send(command, timeoutMs, 1);
    },
    [send, status.connected],
  );

  const isKeyComplete = useCallback(
    () => keys.every((value) => /^[0-9A-F]{1,2}$/.test(value.trim())),
    [keys],
  );

  const isCombinedDataComplete = useCallback(() => {
    const cleaned = combinedData.replace(/[^0-9A-Fa-f]/g, "");
    return cleaned.length === 32;
  }, [combinedData]);

  const showError = (message: string) => {
    setErrorMessage(message);
  };

  const clearError = () => {
    setErrorMessage("");
  };

  const processReadResponse = (response: Uint8Array | null) => {
    if (!response || response.length === 0) {
      showError("No response received.");
      return;
    }

    const payload = extractRfidReadPayload(response);
    if (payload) {
      const cardType = getTagType(payload[0], payload[1]);
      const uid = `${payload[2].toString(16).padStart(2, "0").toUpperCase()} ${payload[3]
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()} ${payload[4].toString(16).padStart(2, "0").toUpperCase()} ${payload[5]
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()}`;
      const data = Array.from(payload.slice(6, 22))
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");

      const result = `Card Type: ${cardType}\nUID: ${uid}\nData: ${data}`;
      setResultDialog({ open: true, result, data });
      clearError();
      return;
    }

    const responseString = new TextDecoder("ascii").decode(response).trim();
    if (responseString === "No card detected") {
      showError("Error: No card detected");
      return;
    }
    if (responseString.startsWith("ERR:")) {
      showError(responseString);
      return;
    }
    showError("Unexpected response format.");
  };

  const processWriteResponse = (response: Uint8Array | null) => {
    if (!response || response.length === 0) {
      showError("No response received.");
      return;
    }

    const responseString = new TextDecoder("ascii").decode(response).trim();
    if (responseString === "No card detected") {
      showError("Error: No card detected");
      return;
    }
    if (responseString === "Success") {
      setResultDialog({ open: true, result: "Write successful", data: "" });
      clearError();
      return;
    }
    showError(`Error: ${responseString}`);
  };

  const sendReadCommand = async () => {
    if (!isConnected) {
      showError("Not connected");
      return;
    }
    if (!blockAddress.trim() || !isKeyComplete()) {
      showError("Please enter block address and complete key.");
      return;
    }

    const block = parseInt(blockAddress, 16) & 0xff;
    const key = buildHexCsv(keys);
    const cmd = `rfid read --block=0x${block.toString(16).padStart(2, "0").toUpperCase()} --auth=0x${authValue
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()} --key=${key}`;

    const response = await sendAsciiCommand(cmd, 2000);
    processReadResponse(response);
  };

  const sendWriteCommand = async () => {
    if (!isConnected) {
      showError("Not connected");
      return;
    }
    if (!blockAddress.trim() || !isKeyComplete() || !isCombinedDataComplete()) {
      showError("Please enter block address, complete key, and data.");
      return;
    }

    const block = parseInt(blockAddress, 16) & 0xff;
    const key = buildHexCsv(keys);
    const data = buildHexCsvFromString(combinedData, 16);
    const cmd = `rfid write --block=0x${block.toString(16).padStart(2, "0").toUpperCase()} --auth=0x${authValue
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()} --key=${key} --data=${data}`;

    const response = await sendAsciiCommand(cmd, 2000);
    processWriteResponse(response);
  };

  return (
    <section className="flex flex-1 flex-col bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">RFID</h2>
          <p className="text-sm text-slate-400">Read/write MIFARE blocks</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-6 py-5 overflow-y-auto">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-300">Block Address (Hex)</label>
              <input
                value={blockAddress}
                onChange={(event) => setBlockAddress(sanitizeHex(event.target.value, 2))}
                className="w-20 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-100"
                placeholder="00"
              />
              <label className="text-sm text-slate-300 ml-4">Auth Mode</label>
              <select
                value={authModeIndex}
                onChange={(event) => setAuthModeIndex(Number(event.target.value))}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200"
              >
                {AUTH_MODES.map((mode, index) => (
                  <option key={mode.label} value={index}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label className="text-sm text-slate-300">Key (6 bytes, Hex)</label>
              <div className="grid grid-cols-3 gap-3 mt-2">
                {keys.map((value, index) => (
                  <input
                    key={index}
                    value={value}
                    onChange={(event) => {
                      const next = [...keys];
                      next[index] = sanitizeHex(event.target.value, 2);
                      setKeys(next);
                    }}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-100"
                    placeholder="FF"
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex flex-col">
            <label className="text-sm text-slate-300">Write Data (16 bytes, Hex)</label>
            <textarea
              value={combinedData}
              onChange={(event) => setCombinedData(sanitizeHex(event.target.value, 64, true))}
              className="mt-2 flex-1 min-h-[120px] rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={sendReadCommand}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            disabled={!isConnected}
          >
            Read UID/Block
          </button>
          <button
            onClick={sendWriteCommand}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={!isConnected}
          >
            Write Block
          </button>
        </div>

        {errorMessage ? (
          <div className="text-sm text-red-400">{errorMessage}</div>
        ) : null}
      </div>

      {resultDialog.open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-[420px] border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">Result</h3>
            <p className="text-sm text-slate-200 whitespace-pre-line mb-6">{resultDialog.result}</p>
            <div className="flex justify-end gap-2">
              {resultDialog.data ? (
                <button
                  onClick={() => {
                    setCombinedData(resultDialog.data);
                    setResultDialog({ ...resultDialog, open: false });
                  }}
                  className="px-4 py-2 text-slate-200 hover:text-white"
                >
                  Copy to write
                </button>
              ) : null}
              <button
                onClick={() => setResultDialog({ ...resultDialog, open: false })}
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
