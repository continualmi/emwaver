const root = UI.column({
    spacing: 12,
    padding: 8,
    children: [
        UI.text({ text: "Wavelet Demo" }),
        UI.text({ text: "Use UI.button, UI.row, and UI.column to compose layouts." }),
        UI.row({
            spacing: 8,
            children: [
                UI.button({
                    label: "Pulse LED once",
                    onTap: () => {
                        print('Pulse LED requested');
                    }
                }),
                UI.button({
                    label: "Log Message",
                    onTap: () => {
                        print('Wavelet button pressed');
                    }
                })
            ]
        }),
        UI.logViewer({ text: "Console messages will appear below." })
    ]
});

UI.render(root);
