import { useEffect, useState, useRef } from 'react';
import { useDevice } from '../utils/DeviceContext';
import {
  CONFIG_REGISTERS,
  STATUS_REGISTERS,
  REGISTER_MAP,
  REG_FRFMSB,
  REG_FRFMID,
  REG_FRFLSB,
  REG_BITRATEMSB,
  REG_BITRATELSB,
  REG_FDEVMSB,
  REG_FDEVLSB,
  REG_RXBW,
  REG_DATAMODUL,
  REG_PALEVEL,
  REG_TESTPA1,
  REG_TESTPA2,
  REG_OCP,
  RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC,
  RF_DATAMODUL_MODULATIONTYPE_FSK,
  RF_DATAMODUL_MODULATIONTYPE_OOK,
  RF_DATAMODUL_MODULATIONSHAPING_00,
  RF_PALEVEL_PA0_ON,
  RF_PALEVEL_PA1_ON,
  RF_PALEVEL_PA2_ON,
  RF_PALEVEL_PA1_OFF,
  RF_PALEVEL_PA2_OFF,
  RF_OCP_ON,
  RF_OCP_OFF,
  MOD_FSK,
  MOD_OOK,
  PA_MODE_PA0,
  PA_MODE_PA1_PA2,
  PA_MODE_PA1_PA2_20DBM,
  FSTEP
} from '../utils/RFM69';

const DEVICE_NAME = "rfm69";

const CS_PIN_STORAGE_KEY = "rfm69_cs_pin";
const CS_ACTIVE_HIGH_STORAGE_KEY = "rfm69_cs_active_high";

interface RfParameters {
  frequency: number;
  dataRate: number;
  bandwidth: number;
  deviation: number;
  modulation: number;
  txPower: number;
}

export default function ISMFragment() {
  const { status, sendAndAwaitResponse } = useDevice();
  
  // Local state for UI only
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalLoadSteps, setTotalLoadSteps] = useState(0);
  const [currentCommand, setCurrentCommand] = useState("");
  const [registers, setRegisters] = useState<{ [key: string]: string }>({});
  const [rfParams, setRfParams] = useState<RfParameters | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  
  // CS pin and active high settings (with localStorage persistence)
  const [csPin, setCsPin] = useState<string>(() => {
    const stored = localStorage.getItem(CS_PIN_STORAGE_KEY);
    return stored || "36";
  });
  const [csActiveHigh, setCsActiveHigh] = useState<boolean>(() => {
    const stored = localStorage.getItem(CS_ACTIVE_HIGH_STORAGE_KEY);
    return stored ? stored === "true" : true;
  });
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [tempCsPin, setTempCsPin] = useState(csPin);
  const [tempCsActiveHigh, setTempCsActiveHigh] = useState(csActiveHigh);
  
  // Modals
  const [editDialog, setEditDialog] = useState<{
    isOpen: boolean;
    title: string;
    value: string;
    onSave: (val: string) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    value: '',
    onSave: async () => {}
  });

  // Refs for cancellation and progress tracking
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressRef = useRef(0);
  
  // Sync deviceOpen with global status
  useEffect(() => {
    if (!status.connected) {
        setDeviceOpen(false);
    }
  }, [status.connected]);

  const parseOkResponse = (response: Uint8Array | null): Uint8Array => {
    if (!response || response.length === 0) return new Uint8Array(0);
    const text = new TextDecoder().decode(response).trim();
    if (!text.startsWith("ok")) return new Uint8Array(0);

    const parts = text.split(/[\s,]+/); // Remove "ok" and split by whitespace or comma
    const bytes: number[] = [];
    for (const part of parts) {
      if (!part) continue;
      const val = parseInt(part.replace(/0x/i, ''), 16);
      if (!isNaN(val)) bytes.push(val);
    }
    return new Uint8Array(bytes);
  };

  const executeOpenCommand = async (command: string): Promise<string | null> => {
    setCurrentCommand(command);
    const response = await sendAndAwaitResponse(command, 1000);
    if (!response) return null;
    return new TextDecoder().decode(response).trim();
  };

  const openDevice = async (): Promise<boolean> => {
    if (deviceOpen) return true;

    const command = `spi open --name=${DEVICE_NAME} --miso=13 --mosi=11 --sck=12 --cs=${csPin} --mode=0 --clock=8000000 --cs_active_high=${csActiveHigh ? "1" : "0"}`;
    
    let responseStr = await executeOpenCommand(command);
    if (responseStr && responseStr.startsWith("ok")) {
      setDeviceOpen(true);
      return true;
    }

    if (responseStr && responseStr.includes("spi open: exists")) {
       // Close and retry
       await sendAndAwaitResponse(`spi close --name=${DEVICE_NAME}`);
       responseStr = await executeOpenCommand(command);
       if (responseStr && responseStr.startsWith("ok")) {
         setDeviceOpen(true);
         return true;
       }
    }

    return false;
  };
  
  const handleSaveSettings = async () => {
    const pinNum = parseInt(tempCsPin);
    if (isNaN(pinNum) || pinNum <= 0) {
      alert("Invalid CS pin value");
      return;
    }
    
    // Close device if open
    if (deviceOpen) {
      await sendAndAwaitResponse(`spi close --name=${DEVICE_NAME}`);
      setDeviceOpen(false);
    }
    
    // Update state and save to localStorage
    setCsPin(tempCsPin);
    setCsActiveHigh(tempCsActiveHigh);
    localStorage.setItem(CS_PIN_STORAGE_KEY, tempCsPin);
    localStorage.setItem(CS_ACTIVE_HIGH_STORAGE_KEY, String(tempCsActiveHigh));
    
    setShowSettingsDialog(false);
  };

  const readReg = async (addr: number): Promise<number> => {
    const txData = `0x${(addr & 0x7F).toString(16).padStart(2, '0')},0x00`;
    const command = `spi xfer --name=${DEVICE_NAME} --tx=${txData} --rx=2`;
    setCurrentCommand(command);
    
    const response = await sendAndAwaitResponse(command);
    const parsed = parseOkResponse(response);
    if (parsed.length > 0) {
      // Return last byte (MISO response during second byte)
      return parsed[parsed.length - 1];
    }
    return 0;
  };

  const writeReg = async (addr: number, value: number) => {
    const txAddr = (addr | 0x80).toString(16).padStart(2, '0');
    const txVal = value.toString(16).padStart(2, '0');
    const txData = `0x${txAddr},0x${txVal}`;
    const command = `spi xfer --name=${DEVICE_NAME} --tx=${txData}`;
    setCurrentCommand(command);
    await sendAndAwaitResponse(command);
  };

  // --- High Level API (matching RFM69.java) ---

  const getFrequency = async (): Promise<number> => {
    const msb = await readReg(REG_FRFMSB);
    const mid = await readReg(REG_FRFMID);
    const lsb = await readReg(REG_FRFLSB);
    const freqHz = ((msb << 16) | (mid << 8) | lsb);
    return (freqHz * FSTEP) / 1000000.0;
  };

  const setFrequency = async (freqMHz: number) => {
    const freqHz = Math.floor((freqMHz * 1000000.0) / FSTEP);
    await writeReg(REG_FRFMSB, (freqHz >> 16) & 0xFF);
    await writeReg(REG_FRFMID, (freqHz >> 8) & 0xFF);
    await writeReg(REG_FRFLSB, freqHz & 0xFF);
  };

  const getDataRate = async (): Promise<number> => {
    const msb = await readReg(REG_BITRATEMSB);
    const lsb = await readReg(REG_BITRATELSB);
    const bitrate = (msb << 8) | lsb;
    if (bitrate === 0) return 0;
    return Math.floor(32000000 / bitrate);
  };

  const setDataRate = async (bps: number) => {
    if (bps <= 0) return;
    const bitrate = Math.floor(32000000 / bps);
    await writeReg(REG_BITRATEMSB, (bitrate >> 8) & 0xFF);
    await writeReg(REG_BITRATELSB, bitrate & 0xFF);
  };

  const getBandwidth = async (): Promise<number> => {
    const reg = await readReg(REG_RXBW);
    return reg & 0x1F; 
  };
  
  const setBandwidth = async (bw: number) => {
     const current = await readReg(REG_RXBW);
     await writeReg(REG_RXBW, (current & 0xE0) | (bw & 0x1F));
  };

  const getDeviation = async (): Promise<number> => {
    const msb = await readReg(REG_FDEVMSB);
    const lsb = await readReg(REG_FDEVLSB);
    return ((msb << 8) | lsb) * 61;
  };

  const setDeviation = async (devHz: number) => {
    const dev = Math.floor(devHz / 61);
    await writeReg(REG_FDEVMSB, (dev >> 8) & 0xFF);
    await writeReg(REG_FDEVLSB, dev & 0xFF);
  };

  const getModulation = async (): Promise<number> => {
    const reg = await readReg(REG_DATAMODUL);
    return ((reg & RF_DATAMODUL_MODULATIONTYPE_OOK) !== 0) ? MOD_OOK : MOD_FSK;
  };

  const setModulation = async (mod: number) => {
    if (mod === MOD_OOK) {
      await writeReg(REG_DATAMODUL, RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC | RF_DATAMODUL_MODULATIONTYPE_OOK | RF_DATAMODUL_MODULATIONSHAPING_00);
    } else {
      await writeReg(REG_DATAMODUL, RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC | RF_DATAMODUL_MODULATIONTYPE_FSK | RF_DATAMODUL_MODULATIONSHAPING_00);
    }
  };

  const getTxPower = async (): Promise<number> => {
    const paLevel = await readReg(REG_PALEVEL);
    const outputPower = paLevel & 0x1F;
    const pa0 = (paLevel & RF_PALEVEL_PA0_ON) !== 0;
    const pa1 = (paLevel & RF_PALEVEL_PA1_ON) !== 0;
    const pa2 = (paLevel & RF_PALEVEL_PA2_ON) !== 0;
    
    const testPa1 = await readReg(REG_TESTPA1);
    const testPa2 = await readReg(REG_TESTPA2);
    const is20dBm = (testPa1 === 0x5D) && (testPa2 === 0x7C);

    if (pa0 && !pa1 && !pa2) return outputPower - 18;
    if (!pa0 && pa1 && !pa2) return outputPower - 18;
    if (!pa0 && pa1 && pa2) {
      return is20dBm ? outputPower - 11 : outputPower - 14;
    }
    return 0;
  };

  const setTxPower = async (dbm: number) => {
    let paMode = PA_MODE_PA0;
    let ocp = true;
    
    if (dbm <= 13) paMode = PA_MODE_PA0;
    else if (dbm <= 17) paMode = PA_MODE_PA1_PA2;
    else paMode = PA_MODE_PA1_PA2_20DBM; // >17

    let paLevelVal = 0;
    if (paMode === PA_MODE_PA0) {
        paLevelVal = RF_PALEVEL_PA0_ON | RF_PALEVEL_PA1_OFF | RF_PALEVEL_PA2_OFF;
        paLevelVal |= (dbm > 13 ? 31 : (dbm + 18));
    }
    
    await writeReg(REG_PALEVEL, paLevelVal);
    await writeReg(REG_OCP, ocp ? RF_OCP_ON : RF_OCP_OFF);
  };


  // --- Main Refresh Logic ---

  const refreshData = async () => {
    if (!status.connected) return;
    
    // Reset state
    setIsLoading(true);
    setLoadingProgress(0);
    const totalSteps = CONFIG_REGISTERS.length + STATUS_REGISTERS.length + 6;
    setTotalLoadSteps(totalSteps);
    abortControllerRef.current = new AbortController();

    // Use microtask scheduling to prevent blocking
    setTimeout(async () => {
      try {
        if (!await openDevice()) {
          throw new Error("Failed to open device");
        }

        let currentStep = 0;
        const newRegisters: { [key: string]: string } = {};
        
        // Load Config Registers - only update progress, not register state
        for (let i = 0; i < CONFIG_REGISTERS.length; i++) {
          if (abortControllerRef.current.signal.aborted) break;
          
          const name = CONFIG_REGISTERS[i];
          const addr = REGISTER_MAP[name];
          
          const val = await readReg(addr);
          newRegisters[name] = val.toString(16).toUpperCase().padStart(2, '0');
          
          currentStep++;
          
          // Only update progress and command text, not registers
          if (i % 3 === 0) {
            setCurrentCommand(`Reading ${name}...`);
            setLoadingProgress(currentStep);
          }
        }

        // Load Status Registers
        for (let i = 0; i < STATUS_REGISTERS.length; i++) {
          if (abortControllerRef.current.signal.aborted) break;
          
          const name = STATUS_REGISTERS[i];
          const addr = REGISTER_MAP[name];
          
          const val = await readReg(addr);
          newRegisters[name] = val.toString(16).toUpperCase().padStart(2, '0');
          currentStep++;
          
          setCurrentCommand(`Reading ${name}...`);
          setLoadingProgress(currentStep);
        }

        // Load RF Params
        let rfParamsData: RfParameters | null = null;
        
        if (!abortControllerRef.current.signal.aborted) {
          setCurrentCommand("Reading frequency...");
          const freq = await getFrequency();
          currentStep++;
          setLoadingProgress(currentStep);
          
          setCurrentCommand("Reading data rate...");
          const dr = await getDataRate();
          currentStep++;
          setLoadingProgress(currentStep);
          
          setCurrentCommand("Reading bandwidth...");
          const bw = await getBandwidth();
          currentStep++;
          setLoadingProgress(currentStep);
          
          setCurrentCommand("Reading deviation...");
          const dev = await getDeviation();
          currentStep++;
          setLoadingProgress(currentStep);
          
          setCurrentCommand("Reading modulation...");
          const mod = await getModulation();
          currentStep++;
          setLoadingProgress(currentStep);
          
          setCurrentCommand("Reading TX power...");
          const pwr = await getTxPower();
          currentStep++;
          setLoadingProgress(currentStep);

          rfParamsData = {
            frequency: freq,
            dataRate: dr,
            bandwidth: bw,
            deviation: dev,
            modulation: mod,
            txPower: pwr
          };
        }

        // Single batch update at the end
        setRegisters(newRegisters);
        if (rfParamsData) {
          setRfParams(rfParamsData);
        }

      } catch (e) {
        console.error("Refresh failed", e);
        alert("Refresh failed: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setIsLoading(false);
        setCurrentCommand("");
      }
    }, 0);
  };

  const handleEditRegister = (name: string, currentVal: string) => {
    setEditDialog({
      isOpen: true,
      title: `Edit ${name}`,
      value: currentVal,
      onSave: async (newVal) => {
        try {
          const val = parseInt(newVal, 16);
          if (isNaN(val)) throw new Error("Invalid hex");
          await writeReg(REGISTER_MAP[name], val);
          const verify = await readReg(REGISTER_MAP[name]);
          setRegisters(prev => ({ ...prev, [name]: verify.toString(16).toUpperCase().padStart(2, '0') }));
        } catch (e) {
          console.error("Failed to update register", e);
          alert("Failed to update register");
        }
      }
    });
  };

  const handleEditRfParam = (param: keyof RfParameters, title: string) => {
    if (!rfParams) return;
    setEditDialog({
      isOpen: true,
      title: `Edit ${title}`,
      value: rfParams[param].toString(),
      onSave: async (newVal) => {
        const val = parseFloat(newVal);
        if (isNaN(val)) return;
        
        switch (param) {
          case 'frequency': await setFrequency(val); break;
          case 'dataRate': await setDataRate(val); break;
          case 'bandwidth': await setBandwidth(val); break;
          case 'deviation': await setDeviation(val); break;
        }
        // Refresh this param
        // For simplicity, maybe just refresh all or update local state
        // Let's do a partial refresh or just update state assuming success
        setRfParams(prev => prev ? ({ ...prev, [param]: val }) : null);
      }
    });
  };

  return (
    <section className="flex flex-1 flex-col bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">ISM (RFM69)</h2>
          <p className="text-sm text-slate-400">Sub-GHz radio control</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              setTempCsPin(csPin);
              setTempCsActiveHigh(csActiveHigh);
              setShowSettingsDialog(true);
            }}
            className="px-3 py-1.5 text-sm bg-slate-700 text-white rounded hover:bg-slate-600"
          >
            Settings
          </button>
          <button 
            onClick={refreshData}
            disabled={!status.connected || isLoading}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </header>
      
      <div className="flex flex-col flex-1 min-h-0 gap-4 px-4 py-4">
        {/* RF Parameters - Fixed */}
        <div className="flex-shrink-0 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">Frequency (MHz)</label>
                <div 
                  className="text-lg font-mono text-slate-200 cursor-pointer hover:text-blue-400"
                  onClick={() => handleEditRfParam('frequency', 'Frequency (MHz)')}
                >
                    {rfParams ? rfParams.frequency.toFixed(6) : '--'}
                </div>
            </div>
            <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">Data Rate (bps)</label>
                <div 
                   className="text-lg font-mono text-slate-200 cursor-pointer hover:text-blue-400"
                   onClick={() => handleEditRfParam('dataRate', 'Data Rate (bps)')}
                >
                    {rfParams ? rfParams.dataRate : '--'}
                </div>
            </div>
            <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">Bandwidth</label>
                <div 
                   className="text-lg font-mono text-slate-200 cursor-pointer hover:text-blue-400"
                   onClick={() => handleEditRfParam('bandwidth', 'Bandwidth')}
                >
                    {rfParams ? rfParams.bandwidth.toFixed(1) : '--'}
                </div>
            </div>
            <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">Deviation (Hz)</label>
                <div 
                   className="text-lg font-mono text-slate-200 cursor-pointer hover:text-blue-400"
                   onClick={() => handleEditRfParam('deviation', 'Deviation (Hz)')}
                >
                    {rfParams ? rfParams.deviation : '--'}
                </div>
            </div>
             <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">Modulation</label>
                <select 
                    className="w-full bg-slate-800 text-slate-200 rounded mt-1 border border-slate-700 text-sm p-1"
                    value={rfParams ? rfParams.modulation : 0}
                    onChange={async (e) => {
                        const val = parseInt(e.target.value);
                        await setModulation(val);
                        setRfParams(prev => prev ? ({...prev, modulation: val}) : null);
                    }}
                    disabled={!status.connected}
                >
                    <option value={MOD_FSK}>FSK</option>
                    <option value={MOD_OOK}>OOK</option>
                </select>
            </div>
             <div className="bg-slate-900 p-3 rounded-lg">
                <label className="text-xs text-slate-500 uppercase">TX Power (dBm)</label>
                <select 
                    className="w-full bg-slate-800 text-slate-200 rounded mt-1 border border-slate-700 text-sm p-1"
                    value={rfParams ? rfParams.txPower : -30}
                    onChange={async (e) => {
                         const val = parseInt(e.target.value);
                         await setTxPower(val);
                         setRfParams(prev => prev ? ({...prev, txPower: val}) : null);
                    }}
                    disabled={!status.connected}
                >
                    {[-30, -20, -15, -10, 0, 5, 7, 10].map(v => (
                        <option key={v} value={v}>{v}</option>
                    ))}
                </select>
            </div>
        </div>

        {/* Registers - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-4">
            <div>
                <h3 className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">Configuration Registers</h3>
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2">
                    {CONFIG_REGISTERS.map(name => (
                        <div key={name} className="flex flex-col bg-slate-900 p-1.5 rounded border border-slate-800">
                            <span className="text-[9px] text-slate-500 truncate">{name}</span>
                            <span 
                                className="font-mono text-sm text-slate-200 cursor-pointer hover:text-blue-400"
                                onClick={() => handleEditRegister(name, registers[name] || '')}
                            >
                                {registers[name] || '--'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
            
             <div>
                <h3 className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">Status Registers</h3>
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2">
                    {STATUS_REGISTERS.map(name => (
                        <div key={name} className="flex flex-col bg-slate-900 p-1.5 rounded border border-slate-800">
                            <span className="text-[9px] text-slate-500 truncate">{name}</span>
                            <span className="font-mono text-sm text-slate-200">
                                {registers[name] || '--'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>

      {/* Loading Modal */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
                <h3 className="text-lg font-medium text-slate-100 mb-4">Initializing RFM69</h3>
                <div className="w-full bg-slate-800 rounded-full h-3 mb-3 overflow-hidden">
                    <div 
                        className="bg-blue-600 h-3 rounded-full transition-all duration-100 ease-linear"
                        style={{ 
                            width: totalLoadSteps > 0 
                                ? `${Math.round((loadingProgress / totalLoadSteps) * 100)}%` 
                                : '0%'
                        }}
                    ></div>
                </div>
                <div className="text-xs text-slate-400 mb-2">
                    <span>{loadingProgress} / {totalLoadSteps}</span>
                </div>
                <div className="text-xs text-slate-500 mb-4 font-mono break-all min-h-[1rem]">
                    {currentCommand || "Preparing..."}
                </div>
                 <button 
                   onClick={() => abortControllerRef.current?.abort()}
                   className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                 >
                   Cancel
                 </button>
            </div>
        </div>
      )}

      {/* Edit Dialog */}
      {editDialog.isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
             <div className="bg-slate-900 p-6 rounded-lg w-80 border border-slate-700 shadow-xl">
                <h3 className="text-lg font-medium text-slate-100 mb-4">{editDialog.title}</h3>
                <input 
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded p-2 mb-4 font-mono"
                    value={editDialog.value}
                    onChange={e => setEditDialog(prev => ({ ...prev, value: e.target.value }))}
                />
                <div className="flex justify-end gap-2">
                     <button 
                       onClick={() => setEditDialog(prev => ({ ...prev, isOpen: false }))}
                       className="px-4 py-2 text-slate-300 hover:text-white"
                     >
                       Cancel
                     </button>
                     <button 
                       onClick={() => {
                           editDialog.onSave(editDialog.value);
                           setEditDialog(prev => ({ ...prev, isOpen: false }));
                       }}
                       className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                     >
                       OK
                     </button>
                </div>
            </div>
        </div>
      )}

      {/* Settings Dialog */}
      {showSettingsDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
            <h3 className="text-lg font-medium text-slate-100 mb-4">ISM Settings</h3>
            
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-300">CS Pin:</label>
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
                <label className="text-sm text-slate-300">CS Active High:</label>
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