const path = require('path');
const { app, ipcMain, dialog, clipboard } = require('electron');

// The app's Launcher API, it used the remote module before Electron removed it

const ConfigNames = [
    'app-settings',
    'file-info',
    'plugin-gallery',
    'plugins',
    'runtime-data',
    'update-info'
];

ipcMain.on('launcherGetInfo', (e) => {
    e.returnValue = {
        userDataPath: app.getPath('userData'),
        tempPath: app.getPath('temp'),
        documentsPath: app.getPath('documents'),
        appPath: path.dirname(app.getAppPath())
    };
});
ipcMain.on('launcherIsMainWindowMaximized', (e) => {
    e.returnValue = !!app.getMainWindow()?.isMaximized();
});

ipcMain.handle('launcherQuit', () => app.quit());
ipcMain.handle('launcherRestartAndUpdate', (e, updateFilePath) =>
    app.restartAndUpdate(updateFilePath)
);
ipcMain.handle('launcherSetHookBeforeQuitEvent', (e, hooked) => app.setHookBeforeQuitEvent(hooked));
ipcMain.handle('launcherMinimizeApp', (e, menuItemLabels) => app.minimizeApp(menuItemLabels));
ipcMain.handle('launcherMinimizeThenHideIfInTray', () => app.minimizeThenHideIfInTray());
ipcMain.handle('launcherHideApp', () => app.hide());
ipcMain.handle('launcherShowMainWindow', () => app.showAndFocusMainWindow());
ipcMain.handle('launcherSetGlobalShortcuts', (e, appSettings) =>
    app.setGlobalShortcuts(appSettings)
);
ipcMain.handle('launcherSetAboutPanelOptions', (e, options) => app.setAboutPanelOptions(options));
ipcMain.handle('launcherOpenDevTools', () =>
    app.getMainWindow()?.webContents.openDevTools({ mode: 'bottom' })
);
ipcMain.handle('launcherMinimizeMainWindow', () => app.getMainWindow()?.minimize());
ipcMain.handle('launcherMaximizeMainWindow', () => app.getMainWindow()?.maximize());
ipcMain.handle('launcherRestoreMainWindow', () => app.getMainWindow()?.restore());
ipcMain.handle('launcherLoadConfig', (e, name) => {
    checkConfigName(name);
    return app.loadConfig(name);
});
ipcMain.handle('launcherSaveConfig', (e, name, data) => {
    checkConfigName(name);
    return app.saveConfig(name, data);
});
ipcMain.handle('launcherShowSaveDialog', showSaveDialog);
ipcMain.handle('launcherResolveProxy', (e, url) =>
    app.getMainWindow().webContents.session.resolveProxy(url)
);
ipcMain.handle('launcherHttpRequest', async (e, config) => {
    try {
        return await app.httpRequest(config);
    } catch (error) {
        return { error: String(error) };
    }
});
ipcMain.handle('launcherWriteClipboard', (e, text, clearAfterSeconds) =>
    writeClipboard(text, clearAfterSeconds)
);
ipcMain.handle('launcherClearClipboard', () => clearClipboardIfUnchanged());

app.on('will-quit', (e) => {
    if (clipboardTextToClear !== null) {
        // reading the clipboard is async, quit when it's done
        e.preventDefault();
        clearClipboardIfUnchanged().finally(() => app.quit());
    }
});

function checkConfigName(name) {
    if (!ConfigNames.includes(name)) {
        throw new Error(`Bad config name: ${name}`);
    }
}

async function showSaveDialog(e, { title, defaultFileName, filterName }) {
    const res = await dialog.showSaveDialog(app.getMainWindow(), {
        title,
        defaultPath: defaultFileName
            ? path.join(app.getPath('desktop'), path.basename(defaultFileName))
            : undefined,
        filters: [{ name: filterName, extensions: ['kdbx'] }]
    });
    return res.canceled ? undefined : res.filePath;
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
