WaveletConsole.subscribe(render);
render();

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: 'BadUSB Hello World', font: 'title2', fontWeight: 'semibold' }),
            UI.text({ text: 'Send a simple HID payload to the connected host.', foregroundColor: '#6B7280' }),
            UI.button({ label: 'Execute Payload', backgroundColor: '#1D4ED8', foregroundColor: '#FFFFFF', onTap: runDemo }),
            WaveletConsole.view({
                minHeight: 160,
                backgroundColor: '#111827',
                foregroundColor: '#F9FAFB',
                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                cornerRadius: 8
            })
        ]
    }));
}

function runDemo() {
    print('[BadUSB] Setting up HID attack mode...');
    BLEService.sendString('usb ATTACKMODE HID');
    Utils.delay(2000);
    BLEService.sendString('usb STRING_DELAY 10');
    Utils.delay(500);
    BLEService.sendString('usb STRING Hello, World!');
    Utils.delay(500);
    BLEService.sendString('usb ENTER');
    Utils.delay(500);
    print('[BadUSB] Payload complete.');
}
