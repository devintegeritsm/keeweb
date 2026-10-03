const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The app page has no access to node.js, this is all it can call in the main process

const InvokeChannels = new Set([
    'appRightsNeedRunInstaller',
    'appRightsRunInstaller',
    'browserExtensionConnectorCloseSocket',
    'browserExtensionConnectorEnable',
    'browserExtensionConnectorSocketEvent',
    'browserExtensionConnectorSocketResult',
    'browserExtensionConnectorStart',
    'browserExtensionConnectorStop',
    'fsDeleteFile',
    'fsExists',
    'fsMkdir',
    'fsReadFile',
    'fsShowSaveDialog',
    'fsStat',
    'fsUnwatchFile',
    'fsWatchFile',
    'fsWriteFile',
    'hardwareCryptoDeleteKey',
    'hardwareDecrypt',
    'hardwareEncrypt',
    'launcherClearClipboard',
    'launcherHideApp',
    'launcherHttpRequest',
    'launcherLoadConfig',
    'launcherMaximizeMainWindow',
    'launcherMinimizeApp',
    'launcherMinimizeMainWindow',
    'launcherMinimizeThenHideIfInTray',
    'launcherOpenDevTools',
    'launcherOpenLink',
    'launcherQuit',
    'launcherRestoreMainWindow',
    'launcherSaveConfig',
    'launcherSetAboutPanelOptions',
    'launcherSetGlobalShortcuts',
    'launcherSetHookBeforeQuitEvent',
    'launcherShowMainWindow',
    'launcherWriteClipboard',
    'oauthListen',
    'oauthStop',
    'setLocale',
    'updaterCheck',
    'updaterDownload',
    'updaterInstall',
    'ykmanRun'
]);
const SendChannels = new Set(['nativeModuleCall']);
const SendSyncChannels = new Set(['launcherIsMainWindowMaximized']);
const EventChannels = new Set([
    'browserExtensionSocketClosed',
    'browserExtensionSocketConnected',
    'browserExtensionSocketRequest',
    'fsFileChanged',
    'log',
    'nativeModuleCallback',
    'nativeModuleHostDisconnect',
    'nativeModuleHostError',
    'nativeModuleHostExit',
    'oauthResult',
    'remote-app-event'
]);

function checkChannel(channels, channel) {
    if (!channels.has(channel)) {
        throw new Error(`Unknown channel: ${channel}`);
    }
}

contextBridge.exposeInMainWorld('kwDesktop', {
    platform: process.platform,
    arch: process.arch,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome
    },
    paths: ipcRenderer.sendSync('launcherGetInfo'),

    invoke(channel, ...args) {
        checkChannel(InvokeChannels, channel);
        return ipcRenderer.invoke(channel, ...args);
    },

    send(channel, ...args) {
        checkChannel(SendChannels, channel);
        ipcRenderer.send(channel, ...args);
    },

    sendSync(channel, ...args) {
        checkChannel(SendSyncChannels, channel);
        return ipcRenderer.sendSync(channel, ...args);
    },

    on(channel, listener) {
        checkChannel(EventChannels, channel);
        const wrapped = (e, ...args) => listener(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },

    getPathForFile(file) {
        // only files picked or dropped by the user have a path, the app can access them
        const filePath = webUtils.getPathForFile(file);
        if (filePath && ipcRenderer.sendSync('fsGrantUserFile', filePath)) {
            return filePath;
        }
        return undefined;
    }
});
