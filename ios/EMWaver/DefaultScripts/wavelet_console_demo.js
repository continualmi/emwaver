WaveletConsole.clear();
WaveletConsole.append('Console demo initialized.');
print('Console demo ready.');

var counter = 0;

function logMessage() {
    counter += 1;
    print('Log entry #' + counter + ' at ' + new Date().toISOString());
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: 'Console Demo', font: 'title2', fontWeight: 'semibold' }),
            UI.text({ text: 'Tap the button to emit a console log.', foregroundColor: '#6B7280' }),
            UI.button({ label: 'Log to Console', buttonStyle: 'borderedProminent', onTap: logMessage }),
            WaveletConsole.view({ minHeight: 180, backgroundColor: '#111827', foregroundColor: '#F9FAFB', cornerRadius: 8, padding: 12 })
        ]
    }));
}

WaveletConsole.subscribe(render);
render();
