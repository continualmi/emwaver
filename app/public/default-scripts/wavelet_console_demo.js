let logLines = [];
const nativePrint = print;

function log(message) {
    const text = String(message);
    logLines.push(text);
    if (logLines.length > 200) {
        logLines = logLines.slice(logLines.length - 200);
    }
    nativePrint(text);
    render();
}

var counter = 0;

function logMessage() {
    counter += 1;
    log('Log entry #' + counter + ' at ' + new Date().toISOString());
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: 'Log Viewer Demo', font: 'title2', fontWeight: 'semibold' }),
            UI.text({ text: 'Tap the button to emit a console log.', foregroundColor: '#6B7280' }),
            UI.button({ label: 'Log to Console', buttonStyle: 'borderedProminent', onTap: logMessage }),
            UI.logViewer({ text: logLines.join('\n'), minHeight: 180, backgroundColor: '#111827', foregroundColor: '#F9FAFB', cornerRadius: 8, padding: 12 })
        ]
    }));
}

log('Log viewer demo initialized.');
render();
