const modulationOptions = [
    { label: "2-FSK", value: "0" },
    { label: "GFSK", value: "1" },
    { label: "ASK/OOK", value: "3" },
    { label: "4-FSK", value: "4" },
    { label: "MSK", value: "7" }
];

const powerOptions = [
    { label: "-30 dBm", value: "-30" },
    { label: "-20 dBm", value: "-20" },
    { label: "-15 dBm", value: "-15" },
    { label: "-10 dBm", value: "-10" },
    { label: "0 dBm", value: "0" },
    { label: "5 dBm", value: "5" },
    { label: "7 dBm", value: "7" },
    { label: "10 dBm", value: "10" }
];

const configRegisters = [
    { key: "00", name: "IOCFG2" }, { key: "01", name: "IOCFG1" }, { key: "02", name: "IOCFG0" },
    { key: "03", name: "FIFOTHR" }, { key: "04", name: "SYNC1" }, { key: "05", name: "SYNC0" },
    { key: "06", name: "PKTLEN" }, { key: "07", name: "PKTCTRL1" }, { key: "08", name: "PKTCTRL0" },
    { key: "09", name: "ADDR" }, { key: "0A", name: "CHANNR" }, { key: "0B", name: "FSCTRL1" },
    { key: "0C", name: "FSCTRL0" }, { key: "0D", name: "FREQ2" }, { key: "0E", name: "FREQ1" },
    { key: "0F", name: "FREQ0" }, { key: "10", name: "MDMCFG4" }, { key: "11", name: "MDMCFG3" },
    { key: "12", name: "MDMCFG2" }, { key: "13", name: "MDMCFG1" }, { key: "14", name: "MDMCFG0" },
    { key: "15", name: "DEVIATN" }, { key: "16", name: "MCSM2" }, { key: "17", name: "MCSM1" },
    { key: "18", name: "MCSM0" }, { key: "19", name: "FOCCFG" }, { key: "1A", name: "BSCFG" },
    { key: "1B", name: "AGCCTRL2" }, { key: "1C", name: "AGCCTRL1" }, { key: "1D", name: "AGCCTRL0" },
    { key: "1E", name: "WOREVT1" }, { key: "1F", name: "WOREVT0" }, { key: "20", name: "WORCTRL" },
    { key: "21", name: "FREND1" }, { key: "22", name: "FREND0" }, { key: "23", name: "FSCAL3" },
    { key: "24", name: "FSCAL2" }, { key: "25", name: "FSCAL1" }, { key: "26", name: "FSCAL0" },
    { key: "27", name: "RCCTRL1" }, { key: "28", name: "RCCTRL0" }, { key: "29", name: "FSTEST" },
    { key: "2A", name: "PTEST" }, { key: "2B", name: "AGCTEST" }, { key: "2C", name: "TEST2" },
    { key: "2D", name: "TEST1" }, { key: "2E", name: "TEST0" }
];

const statusRegisters = [
    { key: "30", name: "PARTNUM" }, { key: "31", name: "VERSION" }, { key: "32", name: "FREQEST" },
    { key: "33", name: "LQI" }, { key: "34", name: "RSSI" }, { key: "35", name: "MARCSTATE" },
    { key: "36", name: "WORTIME1" }, { key: "37", name: "WORTIME0" }, { key: "38", name: "PKTSTATUS" },
    { key: "39", name: "VCO_VC_DAC" }, { key: "3A", name: "TXBYTES" }, { key: "3B", name: "RXBYTES" }
];

const paTable = Array.from({ length: 8 }, (_, index) => ({ key: `PA${index}`, name: `PA[${index}]` }));

const layout = {
    gap: 10,
    rowHeight: 30,
    labelWidth: 150,
    controlMinWidth: 120,
    controlMaxWidth: 180,
    actionWidth: 60
};

function labelCell(text) {
    return UI.text({
        text,
        fontWeight: "medium",
        width: layout.labelWidth,
        alignment: "leading",
        fillsWidth: false
    });
}

function emptyCell(width) {
    return UI.text({ text: "", width, fillsWidth: false });
}

const registerDefaults = [...configRegisters, ...statusRegisters, ...paTable].reduce((map, reg) => {
    map[reg.key] = "??";
    return map;
}, {});

const state = {
    frequency: "",
    dataRate: "",
    bandwidth: "",
    deviation: "",
    modulation: modulationOptions[0].value,
    power: powerOptions[4].value,
    isLoading: false,
    status: "Idle",
    registerValues: registerDefaults
};

function setState(patch) {
    Object.assign(state, patch);
    render();
}

function updateField(key, rawValue) {
    const trimmed = String(rawValue || "").trim();
    setState({ [key]: trimmed });
}

function handleSet(key, label) {
    const value = state[key];
    if (!value) {
        print(`[Wavelet/ISM] ${label} was left empty.`);
        return;
    }
    print(`[Wavelet/ISM] Set ${label} to ${value}`);
}

function toggleLoading() {
    const next = !state.isLoading;
    setState({
        isLoading: next,
        status: next ? "Polling CC1101 registers…" : "Idle"
    });
    print(next ? "[Wavelet/ISM] Refreshing register snapshot" : "[Wavelet/ISM] Cancelled refresh" );
}

function resetRadio() {
    print("[Wavelet/ISM] Reset radio to defaults");
}

function registerRow(register) {
    const value = state.registerValues[register.key] || "??";
    return UI.row({
        spacing: 8,
        children: [
            UI.text({ text: register.name, fontWeight: "medium" }),
            UI.spacer(),
            UI.text({ text: `0x${register.key}`, foregroundColor: "#6B7280" }),
            UI.spacer(),
            UI.text({ text: `0x${value}`, fontDesign: "monospaced" })
        ]
    });
}

function sectionHeading(text) {
    return UI.text({ text, font: "subheadline", fontWeight: "semibold" });
}

function parameterRow(label, key, placeholder, keyboard) {
    return UI.row({
        spacing: layout.gap,
        alignment: "center",
        children: [
            labelCell(label),
            UI.row({
                spacing: layout.gap,
                alignment: "center",
                flex: 1,
                children: [
                    UI.textField({
                        placeholder,
                        value: state[key],
                        keyboard,
                        minWidth: layout.controlMinWidth,
                        maxWidth: layout.controlMaxWidth,
                        height: layout.rowHeight,
                        flex: 1,
                        fillsWidth: true,
                        onChange: function(value) {
                            updateField(key, value);
                        }
                    }),
                    UI.button({
                        label: "Set",
                        buttonStyle: "bordered",
                        controlSize: "small",
                        minWidth: layout.actionWidth,
                        maxWidth: layout.actionWidth,
                        fillsWidth: false,
                        onTap: function() {
                            handleSet(key, label);
                        }
                    })
                ]
            })
        ]
    });
}

function pickerRow(label, key, options) {
    return UI.row({
        spacing: layout.gap,
        alignment: "center",
        children: [
            labelCell(label),
            UI.row({
                spacing: layout.gap,
                alignment: "center",
                flex: 1,
                children: [
                    UI.picker({
                        selected: state[key],
                        options,
                        style: "menu",
                        minWidth: layout.controlMinWidth,
                        maxWidth: layout.controlMaxWidth,
                        height: layout.rowHeight,
                        fillsWidth: false,
                        onChange: function(value) {
                            setState({ [key]: value });
                            print(`[Wavelet/ISM] ${label} -> ${value}`);
                        }
                    }),
                    emptyCell(layout.actionWidth)
                ]
            })
        ]
    });
}

function render() {
    UI.render(
        UI.scroll({
            padding: 16,
            spacing: 24,
            children: [
                UI.column({
                    spacing: layout.gap,
                    children: [
                        UI.text({
                            text: "ISM Toolkit",
                            font: "title2",
                            fontWeight: "semibold"
                        }),
                        UI.text({
                            text: "Configure CC1101 parameters and inspect live register snapshots.",
                            foregroundColor: "#6B7280"
                        })
                    ]
                }),
                UI.column({
                    spacing: layout.gap,
                    children: [
                        parameterRow("Frequency (MHz):", "frequency", "2400", "decimal"),
                        parameterRow("Data Rate (bps):", "dataRate", "38400", "number"),
                        parameterRow("Bandwidth (kHz):", "bandwidth", "250", "decimal"),
                        parameterRow("Deviation (Hz):", "deviation", "5000", "number"),
                        pickerRow("Modulation Format:", "modulation", modulationOptions),
                        pickerRow("TX Power:", "power", powerOptions),
                        UI.row({
                            spacing: layout.gap,
                            alignment: "center",
                            children: [
                                emptyCell(layout.labelWidth),
                                UI.row({
                                    spacing: layout.gap,
                                    alignment: "center",
                                    flex: 1,
                                    children: [
                                        emptyCell(layout.controlMinWidth),
                                        UI.button({
                                            label: "Reset",
                                            buttonStyle: "bordered",
                                            controlSize: "small",
                                            minWidth: layout.actionWidth,
                                            maxWidth: layout.actionWidth,
                                            fillsWidth: false,
                                            icon: "arrow.counterclockwise",
                                            onTap: resetRadio
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                UI.column({
                    spacing: 12,
                    children: [
                        UI.row({
                            spacing: 12,
                            children: [
                                UI.text({ text: "CC1101 Registers", font: "headline" }),
                                UI.spacer(),
                                UI.button({
                                    label: state.isLoading ? "Cancel" : "Refresh",
                                    buttonStyle: "bordered",
                                    controlSize: "small",
                                    fillsWidth: false,
                                    icon: state.isLoading ? "xmark" : "arrow.clockwise",
                                    onTap: toggleLoading
                                })
                            ]
                        }),
                        state.isLoading ? UI.progress({
                            label: "Loading registers…",
                            detail: state.status
                        }) : null,
                        UI.column({
                            spacing: 8,
                            children: [
                                sectionHeading("Configuration Registers"),
                                ...configRegisters.map(registerRow)
                            ]
                        }),
                        UI.divider(),
                        UI.column({
                            spacing: 8,
                            children: [
                                sectionHeading("Status Registers"),
                                ...statusRegisters.map(registerRow)
                            ]
                        }),
                        UI.divider(),
                        UI.column({
                            spacing: 8,
                            children: [
                                sectionHeading("PA Table"),
                                ...paTable.map(registerRow)
                            ]
                        }),
                        UI.text({
                            text: state.status,
                            font: "footnote",
                            foregroundColor: "#6B7280"
                        })
                    ]
                })
            ]
        })
    );
}

render();
