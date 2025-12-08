const cc1101 = require('cc1101');

const profiles = [
    { name: '433.92 MHz ASK (Default)', overrides: {} },
    { name: '315 MHz ASK', overrides: { frequencyMHz: 315 } },
    { name: '433.92 MHz GFSK 38.4k', overrides: { modulation: 'GFSK', dataRate: 38400 } },
    { name: '915 MHz 2-FSK 250k', overrides: { frequencyMHz: 915, modulation: '2FSK', dataRate: 250000 } }
];

const state = {
    profileIndex: 0,
    message: cc1101.isAvailable() ? 'Ready' : 'CC1101 bridge unavailable. Connect your EMWaver.',
    isError: !cc1101.isAvailable(),
    lastConfig: null
};

let cachedConstants = null;

function getConstants() {
    if (cachedConstants !== null) {
        return cachedConstants;
    }
    try {
        cachedConstants = cc1101.constants();
    } catch (error) {
        cachedConstants = null;
    }
    return cachedConstants;
}

function currentProfile() {
    return profiles[state.profileIndex] || profiles[0];
}

function currentOverrides() {
    const profile = currentProfile();
    return profile && profile.overrides ? Object.assign({}, profile.overrides) : {};
}

function log(message) {
    WaveletConsole.append(message);
}

function applyOperation(label, task) {
    try {
        const result = task();
        if (result) {
            state.lastConfig = result;
            log('[' + label + '] ' + describeConfig(result));
        } else {
            state.lastConfig = null;
            log('[' + label + '] complete');
        }
        state.message = label + ' complete';
        state.isError = false;
    } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        state.message = label + ' failed: ' + detail;
        state.isError = true;
        log('[' + label + '] ' + detail);
    }
    render();
}

function startRx() {
    applyOperation('RX', function () {
        return cc1101.startRx(currentOverrides());
    });
}

function startTx() {
    applyOperation('TX', function () {
        return cc1101.startTx(currentOverrides());
    });
}

function standby() {
    applyOperation('Standby', function () {
        cc1101.standby();
        return null;
    });
}

function flushFifos() {
    applyOperation('Flush', function () {
        cc1101.flushFifos();
        return null;
    });
}

function cycleProfile() {
    state.profileIndex = (state.profileIndex + 1) % profiles.length;
    state.lastConfig = null;
    log('Selected profile: ' + currentProfile().name);
    render();
}

function resetDefaults() {
    state.profileIndex = 0;
    state.lastConfig = null;
    state.message = cc1101.isAvailable() ? 'Defaults restored.' : 'Defaults restored (waiting for CC1101).';
    state.isError = false;
    log('Reset to default profile.');
    render();
}

function describeConfig(config) {
    if (!config) {
        return 'No configuration applied.';
    }
    const parts = [
        'Freq ' + formatNumber(config.frequencyMHz, 2) + ' MHz',
        'Rate ' + formatNumber(config.dataRate, 0) + ' bps',
        'Mod ' + modulationLabel(config.modulation),
        'Power ' + config.powerDbm + ' dBm'
    ];
    return parts.join(' · ');
}

function modulationLabel(value) {
    const constants = getConstants();
    if (!constants || !constants.modulation) {
        return String(value);
    }
    const mod = constants.modulation;
    for (var key in mod) {
        if (Object.prototype.hasOwnProperty.call(mod, key) && mod[key] === value) {
            return key.startsWith('MOD_') ? key.substring(4) : key;
        }
    }
    return String(value);
}

function formatNumber(value, decimals) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return String(value);
    }
    return num.toFixed(decimals);
}

function render() {
    const children = [
        UI.text({ text: 'CC1101 Radio (Module)', font: 'title2', fontWeight: 'semibold' }),
        UI.text({ text: 'Profile: ' + currentProfile().name, foregroundColor: '#6B7280' }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: 'Change Profile', backgroundColor: '#4F46E5', foregroundColor: '#FFFFFF', onTap: cycleProfile }),
                UI.button({ label: 'Reset Defaults', backgroundColor: '#6B7280', foregroundColor: '#FFFFFF', onTap: resetDefaults })
            ]
        }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: 'Start RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: startRx }),
                UI.button({ label: 'Start TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: startTx })
            ]
        }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: 'Standby', backgroundColor: '#0F172A', foregroundColor: '#FFFFFF', onTap: standby }),
                UI.button({ label: 'Flush FIFOs', backgroundColor: '#0EA5E9', foregroundColor: '#FFFFFF', onTap: flushFifos })
            ]
        }),
        UI.text({
            text: state.message,
            fontWeight: 'medium',
            foregroundColor: state.isError ? '#DC2626' : '#065F46'
        })
    ];
    if (state.lastConfig) {
        children.push(UI.text({ text: describeConfig(state.lastConfig), foregroundColor: '#374151' }));
    }
    children.push(
        WaveletConsole.view({
            minHeight: 160,
            backgroundColor: '#111827',
            foregroundColor: '#F9FAFB',
            padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
            cornerRadius: 8
        })
    );
    UI.render(UI.column({ padding: 16, spacing: 16, children }));
}

WaveletConsole.clear();
WaveletConsole.subscribe(render);
if (!cc1101.isAvailable()) {
    log('CC1101 binding unavailable. Connect an EMWaver device to run radio commands.');
}
render();
