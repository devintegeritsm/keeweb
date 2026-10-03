const fs = require('fs');
const os = require('os');
const path = require('path');

// replaces the electron module, so that main process modules can be tested with mocha

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-desktop-test-'));
const userData = path.join(tempDir, 'userData');
fs.mkdirSync(userData);

const mainFrame = {};
const mainWindow = {
    isDestroyed: () => false,
    isMaximized: () => false,
    webContents: { mainFrame, send() {} }
};
const handlers = {};
const listeners = {};
const configs = {};
const prompts = [];

const electron = {
    app: {
        getPath: (name) => (name === 'userData' ? userData : path.join(tempDir, name)),
        getAppPath: () => path.join(tempDir, 'app'),
        getMainWindow: () => mainWindow,
        loadConfig: async (name) => configs[name] ?? null,
        saveConfig: async (name, data) => {
            configs[name] = data;
        },
        on() {}
    },
    ipcMain: {
        handle: (channel, listener) => {
            handlers[channel] = listener;
        },
        on: (channel, listener) => {
            listeners[channel] = listener;
        }
    },
    dialog: {
        promptResponse: 1,
        showMessageBox: async (win, options) => {
            prompts.push(options);
            return { response: electron.dialog.promptResponse };
        }
    },
    clipboard: {},
    shell: {},
    net: {}
};

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: electron
};

function trustedEvent() {
    return { sender: mainWindow.webContents, senderFrame: mainFrame };
}

function reset() {
    for (const key of Object.keys(configs)) {
        delete configs[key];
    }
    prompts.length = 0;
    electron.dialog.promptResponse = 1;
}

module.exports = {
    electron,
    tempDir,
    userData,
    handlers,
    listeners,
    configs,
    prompts,
    mainWindow,
    trustedEvent,
    reset
};
