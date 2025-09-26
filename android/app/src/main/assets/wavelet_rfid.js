const state = {
    blockAddress: "",
    authMode: "A",
    keyInputs: Array.from({ length: 6 }, () => ""),
    data: "",
    result: null
};

function formatHexInput(input, maxLength) {
    if (!input) {
        return "";
    }
    const sanitized = String(input).toUpperCase().replace(/[^0-9A-F ]/g, "");
    return sanitized.slice(0, maxLength);
}

function updateBlockAddress(value) {
    setState({ blockAddress: formatHexInput(value, 2) });
}

function updateKey(index, value) {
    const nextKeys = state.keyInputs.slice();
    nextKeys[index] = formatHexInput(value, 2);
    setState({ keyInputs: nextKeys });
}

function updateData(value) {
    setState({ data: formatHexInput(value, 47) });
}

function handleRead() {
    const block = state.blockAddress || "00";
    print(`[Wavelet/RFID] Read block ${block} using Key ${state.authMode}`);
    setState({
        result: {
            kind: "info",
            text: `Read command queued for block ${block} (Key ${state.authMode}).`
        }
    });
}

function handleWrite() {
    const block = state.blockAddress || "00";
    const byteCount = state.data.trim().length === 0
        ? 0
        : state.data.trim().split(/\\s+/).filter(Boolean).length;
    print(`[Wavelet/RFID] Write block ${block} using Key ${state.authMode}`);
    setState({
        result: {
            kind: "success",
            text: `Write command queued with ${byteCount} byte(s) for block ${block}.`
        }
    });
}

function setState(patch) {
    Object.assign(state, patch);
    render();
}

function render() {
    UI.render(
        UI.scroll({
            padding: 16,
            spacing: 16,
            children: [
                UI.column({
                    spacing: 16,
                    children: [
                        UI.text({
                            text: "RFID Tools",
                            font: "title2",
                            fontWeight: "semibold"
                        }),
                        UI.text({
                            text: "Send quick read/write commands to nearby tags using the EMWaver RFID module.",
                            foregroundColor: "#6B7280"
                        }),
                        UI.textField({
                            label: "Block Address",
                            placeholder: "00",
                            value: state.blockAddress,
                            keyboard: "ascii",
                            autocapitalize: "none",
                            onChange: updateBlockAddress
                        }),
                        UI.picker({
                            label: "Authentication Mode",
                            style: "segmented",
                            selected: state.authMode,
                            options: [
                                { label: "Key A", value: "A" },
                                { label: "Key B", value: "B" }
                            ],
                            onChange: function(value) {
                                setState({ authMode: value });
                            }
                        }),
                        UI.column({
                            spacing: 8,
                            children: [
                                UI.text({ text: "Key (6 bytes)", font: "headline" }),
                                UI.grid({
                                    columns: 3,
                                    spacing: 8,
                                    children: state.keyInputs.map(function(keyValue, index) {
                                        return UI.textField({
                                            placeholder: "00",
                                            value: keyValue,
                                            keyboard: "ascii",
                                            autocapitalize: "none",
                                            onChange: function(nextValue) {
                                                updateKey(index, nextValue);
                                            }
                                        });
                                    })
                                })
                            ]
                        }),
                        UI.textEditor({
                            label: "Data (16 bytes)",
                            placeholder: "Enter 16 bytes of data (e.g. FF FF ...)",
                            value: state.data,
                            onChange: updateData
                        }),
                        UI.row({
                            spacing: 12,
                            children: [
                                UI.button({
                                    label: "Read",
                                    icon: "arrow.down.doc.fill",
                                    backgroundColor: "#1D4ED8",
                                    foregroundColor: "#FFFFFF",
                                    cornerRadius: 10,
                                    onTap: handleRead
                                }),
                                UI.button({
                                    label: "Write",
                                    icon: "arrow.up.doc.fill",
                                    backgroundColor: "#15803D",
                                    foregroundColor: "#FFFFFF",
                                    cornerRadius: 10,
                                    onTap: handleWrite
                                })
                            ]
                        }),
                        state.result ? UI.text({
                            text: state.result.text,
                            backgroundColor: state.result.kind === "info" ? "#DBEAFE" : "#DCFCE7",
                            foregroundColor: state.result.kind === "info" ? "#1D4ED8" : "#166534",
                            padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                            cornerRadius: 8
                        }) : null
                    ]
                })
            ]
        })
    );
}

render();
