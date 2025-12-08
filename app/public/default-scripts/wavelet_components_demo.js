// Wavelet Components Demo - Shows all available UI components

const root = UI.column({
    spacing: 16,
    padding: 12,
    children: [
        UI.text({ text: "Wavelet Component Gallery" }),
        UI.divider(),
        
        // Buttons
        UI.text({ text: "Buttons:" }),
        UI.row({
            spacing: 8,
            children: [
                UI.button({
                    label: "Primary",
                    onTap: () => print("Primary button tapped")
                }),
                UI.button({
                    label: "Secondary",
                    onTap: () => print("Secondary button tapped")
                })
            ]
        }),
        
        UI.spacer({ height: 8 }),
        
        // Slider
        UI.text({ text: "Slider:" }),
        UI.slider({
            label: "Volume",
            min: 0,
            max: 100,
            value: 50,
            step: 1,
            onChange: (value) => print("Slider value: " + value)
        }),
        
        UI.spacer({ height: 8 }),
        
        // Text Field
        UI.text({ text: "Text Field:" }),
        UI.textField({
            label: "Enter name",
            placeholder: "Your name...",
            value: "",
            onChange: (value) => print("Text changed: " + value),
            onSubmit: (value) => print("Submitted: " + value)
        }),
        
        UI.spacer({ height: 8 }),
        
        // Text Editor
        UI.text({ text: "Text Editor:" }),
        UI.textEditor({
            label: "Notes",
            placeholder: "Write something...",
            rows: 3,
            value: "",
            onChange: (value) => print("Editor changed")
        }),
        
        UI.spacer({ height: 8 }),
        
        // Picker
        UI.text({ text: "Picker:" }),
        UI.picker({
            label: "Select mode",
            options: ["Scan", "Transmit", "Analyze", "Monitor"],
            value: "Scan",
            onChange: (value) => print("Selected: " + value)
        }),
        
        UI.spacer({ height: 8 }),
        
        // Progress
        UI.text({ text: "Progress:" }),
        UI.progress({
            label: "Loading...",
            value: 65,
            max: 100
        }),
        
        UI.spacer({ height: 8 }),
        
        // Grid
        UI.text({ text: "Grid Layout:" }),
        UI.grid({
            columns: 3,
            spacing: 8,
            children: [
                UI.button({ label: "1", onTap: () => print("Grid 1") }),
                UI.button({ label: "2", onTap: () => print("Grid 2") }),
                UI.button({ label: "3", onTap: () => print("Grid 3") }),
                UI.button({ label: "4", onTap: () => print("Grid 4") }),
                UI.button({ label: "5", onTap: () => print("Grid 5") }),
                UI.button({ label: "6", onTap: () => print("Grid 6") })
            ]
        }),
        
        UI.divider(),
        
        // Scrollable area
        UI.text({ text: "Scroll Area (max height 150px):" }),
        UI.scroll({
            maxHeight: 150,
            children: [
                UI.text({ text: "Line 1 - This is a scrollable area" }),
                UI.text({ text: "Line 2" }),
                UI.text({ text: "Line 3" }),
                UI.text({ text: "Line 4" }),
                UI.text({ text: "Line 5" }),
                UI.text({ text: "Line 6" }),
                UI.text({ text: "Line 7" }),
                UI.text({ text: "Line 8" }),
                UI.text({ text: "Line 9" }),
                UI.text({ text: "Line 10 - End of scroll" })
            ]
        }),
        
        UI.divider(),
        
        // Log viewer
        UI.logViewer({ text: "Console output will appear here" })
    ]
});

UI.render(root);
