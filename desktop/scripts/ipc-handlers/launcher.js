const path = require('path');
const { app, clipboard, shell } = require('electron');
const { handle, on } = require('../ipc-validation');

// The app's Launcher API, it used the remote module before Electron removed it

const ConfigNames = [
    'app-settings',
    'file-info',
    'plugin-gallery',
    'plugins',
    'runtime-data',
    'update-info'
];
// cloud storage APIs that need requests without CORS, other requests are made by the page
const HttpRequestHosts = [
    'dropboxapi.com',
    'googleapis.com',
    'accounts.google.com',
    'graph.microsoft.com',
    'login.microsoftonline.com',
    'sharepoint.com',
    '1drv.com',
    'livefilestore.com',
    'onedrive.com',
    'microsoftpersonalcontent.com'
];
const ExternalLinkProtocols = ['http:', 'https:', 'ftp:', 'sftp:', 'mailto:'];

on('launcherGetInfo', (e) => {
    e.returnValue = {
        userDataPath: app.getPath('userData'),
        documentsPath: app.getPath('documents'),
        appPath: path.dirname(app.getAppPath())
    };
});
on('launcherIsMainWindowMaximized', (e) => {
    e.returnValue = !!app.getMainWindow()?.isMaximized();
});

handle('launcherQuit', () => app.quit());
handle('launcherSetHookBeforeQuitEvent', (e, hooked) => app.setHookBeforeQuitEvent(hooked));
handle('launcherMinimizeApp', (e, menuItemLabels) => app.minimizeApp(menuItemLabels));
handle('launcherMinimizeThenHideIfInTray', () => app.minimizeThenHideIfInTray());
handle('launcherHideApp', () => app.hide());
handle('launcherShowMainWindow', () => app.showAndFocusMainWindow());
handle('launcherSetGlobalShortcuts', (e, appSettings) => app.setGlobalShortcuts(appSettings));
handle('launcherSetAboutPanelOptions', (e, options) => app.setAboutPanelOptions(options));
handle('launcherOpenDevTools', () =>
    app.getMainWindow()?.webContents.openDevTools({ mode: 'bottom' })
);
handle('launcherMinimizeMainWindow', () => app.getMainWindow()?.minimize());
handle('launcherMaximizeMainWindow', () => app.getMainWindow()?.maximize());
handle('launcherRestoreMainWindow', () => app.getMainWindow()?.restore());
handle('launcherLoadConfig', (e, name) => {
    checkConfigName(name);
    return app.loadConfig(name);
});
handle('launcherSaveConfig', (e, name, data) => {
    checkConfigName(name);
    return app.saveConfig(name, data);
});
handle('launcherOpenLink', (e, url) => {
    if (ExternalLinkProtocols.includes(new URL(url).protocol)) {
        return shell.openExternal(url);
    }
});
handle('launcherHttpRequest', async (e, config) => {
    if (!isHttpRequestAllowed(config.url)) {
        return { error: 'Not allowed', notAllowed: true };
    }
    try {
        return await app.httpRequest(config);
    } catch (error) {
        return { error: String(error) };
    }
});
handle('launcherWriteClipboard', (e, text, clearAfterSeconds) =>
    writeClipboard(text, clearAfterSeconds)
);
handle('launcherClearClipboard', () => clearClipboardIfUnchanged());

app.on('will-quit', (e) => {
    if (clipboardTextToClear !== null) {
        // reading the clipboard is async, quit when it's done
        e.preventDefault();
        clearClipboardIfUnchanged().finally(() => app.quit());
    }
});

function isHttpRequestAllowed(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return (
        parsed.protocol === 'https:' &&
        HttpRequestHosts.some(
            (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host)
        )
    );
}

function checkConfigName(name) {
    if (!ConfigNames.includes(name)) {
        throw new Error(`Bad config name: ${name}`);
    }
}

let clipboardTextToClear = null;
let clipboardClearTimer = null;

async function writeClipboard(text, clearAfterSeconds) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
    clipboardTextToClear = null;
    await clipboard.writeText(text);
    if (clearAfterSeconds > 0) {
        clipboardTextToClear = text;
        clipboardClearTimer = setTimeout(clearClipboardIfUnchanged, clearAfterSeconds * 1000);
    }
}

async function clearClipboardIfUnchanged() {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
    const text = clipboardTextToClear;
    clipboardTextToClear = null;
    // the user may have copied something else since then, it must stay
    if (text !== null && (await clipboard.readText()) === text) {
        clipboard.clear();
        clipboard.selection?.clear();
    }
}

module.exports = { isHttpRequestAllowed };
