/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let logLines = [];
const nativePrint = print;

render();

function log(message) {
    const text = String(message);
    logLines.push(text);
    if (logLines.length > 200) {
        logLines = logLines.slice(logLines.length - 200);
    }
    nativePrint(text);
    render();
}

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: 'BadUSB Hello World', font: 'title2', fontWeight: 'semibold' }),
            UI.text({ text: 'Send a simple HID payload to the connected host.', foregroundColor: '#6B7280' }),
            UI.button({ label: 'Execute Payload', backgroundColor: '#1D4ED8', foregroundColor: '#FFFFFF', onTap: runDemo }),
            UI.logViewer({
                text: logLines.join('\n'),
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
    log('[BadUSB] Setting up HID attack mode...');
    BLEService.sendString('usb ATTACKMODE HID');
    Utils.delay(2000);
    BLEService.sendString('usb STRING_DELAY 10');
    Utils.delay(500);
    BLEService.sendString('usb STRING Hello, World!');
    Utils.delay(500);
    BLEService.sendString('usb ENTER');
    Utils.delay(500);
    log('[BadUSB] Payload complete.');
}
