import { Events } from 'framework/events';
import { StartProfiler } from 'comp/app/start-profiler';
import { RuntimeInfo } from 'const/runtime-info';
import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import { noop } from 'util/fn';

const logger = new Logger('launcher');

// the app runs isolated from node.js, all it can do is in desktop/preload.js
const desktop = window.kwDesktop;

const fileWatchCallbacks = new Map();

function fsCall(channel, ...args) {
    return desktop.invoke(channel, ...args).then(({ result, error }) => {
        if (error) {
            throw Object.assign(new Error(error.message), { code: error.code });
        }
        return result;
    });
}

const Launcher = {
    name: 'electron',
    version: desktop.versions.electron,
    autoTypeSupported: true,
    thirdPartyStoragesSupported: true,
    clipboardSupported: true,
    platform() {
        return desktop.platform;
    },
    arch() {
        return desktop.arch;
    },
    ipcInvoke(channel, ...args) {
        return desktop.invoke(channel, ...args);
    },
    ipcSend(channel, ...args) {
        desktop.send(channel, ...args);
    },
    ipcOn(channel, listener) {
        return desktop.on(channel, listener);
    },
    openLink(href) {
        if (/^(http|https|ftp|sftp|mailto):/i.test(href)) {
            desktop.invoke('launcherOpenLink', href);
        }
    },
    devTools: true,
    openDevTools() {
        desktop.invoke('launcherOpenDevTools');
    },
    getSaveFileName(defaultFileName, callback) {
        desktop
            .invoke('fsShowSaveDialog', {
                title: Locale.launcherSave,
                defaultFileName,
                filterName: Locale.launcherFileFilter
            })
            .then((filePath) => callback(filePath));
    },
    getPathForFile(file) {
        // the app can access files the user picked or dropped
        return desktop.getPathForFile(file);
    },
    getUserDataPath(fileName) {
        return this.joinPath(desktop.paths.userDataPath, fileName || '');
    },
    getDocumentsPath(fileName) {
        return this.joinPath(desktop.paths.documentsPath, fileName || '');
    },
    getAppPath(fileName) {
        return this.joinPath(desktop.paths.appPath, fileName || '');
    },
    joinPath(...parts) {
        const isWindows = this.platform() === 'win32';
        const sep = isWindows ? '\\' : '/';
        let result = parts.filter((part) => part).join(sep);
        if (isWindows) {
            result = result.replace(/\//g, '\\');
            // keep the leading \\ of network paths
            return result.replace(/(?!^)\\{2,}/g, '\\');
        }
        return result.replace(/\/{2,}/g, '/');
    },
    parsePath(fileName) {
        const seps = this.platform() === 'win32' ? /[\\/]/ : /\//;
        const file = fileName.split(seps).pop();
        const sepIndex = fileName.length - file.length - 1;
        return {
            path: fileName,
            dir: fileName.substr(0, sepIndex > 0 ? sepIndex : sepIndex + 1),
            file
        };
    },
    writeFile(path, data, callback) {
        fsCall('fsWriteFile', path, data).then(() => callback?.(), callback || noop);
    },
    readFile(path, encoding, callback) {
        fsCall('fsReadFile', path).then(
            (data) => callback(encoding ? new TextDecoder().decode(data) : data),
            (err) => callback(undefined, err)
        );
    },
    fileExists(path, callback) {
        fsCall('fsExists', path).then(
            (exists) => callback(exists),
            () => callback(false)
        );
    },
    deleteFile(path, callback) {
        fsCall('fsDeleteFile', path).then(() => callback?.(), callback || noop);
    },
    statFile(path, callback) {
        fsCall('fsStat', path).then(
            ({ mtime, size, isDirectory }) =>
                callback({ mtime: new Date(mtime), size, isDirectory: () => isDirectory }),
            (err) => callback(undefined, err)
        );
    },
    mkdir(dir, callback) {
        fsCall('fsMkdir', dir).then(() => callback?.(), callback || noop);
    },
    watchFile(path, callback) {
        let watchId;
        let unwatched = false;
        fsCall('fsWatchFile', path).then(
            (id) => {
                if (!id) {
                    return;
                }
                watchId = id;
                if (unwatched) {
                    desktop.invoke('fsUnwatchFile', watchId);
                } else {
                    fileWatchCallbacks.set(watchId, callback);
                }
            },
            (err) => logger.warn('Error watching file', path, err)
        );
        return () => {
            unwatched = true;
            if (watchId) {
                fileWatchCallbacks.delete(watchId);
                desktop.invoke('fsUnwatchFile', watchId);
            }
        };
    },
    loadConfig(name) {
        return desktop.invoke('launcherLoadConfig', name);
    },
    saveConfig(name, data) {
        return desktop.invoke('launcherSaveConfig', name, data);
    },
    preventExit(e) {
        e.returnValue = false;
        return false;
    },
    exit() {
        this.exitRequested = true;
        this.requestExit();
    },
    requestExit() {
        desktop.invoke('launcherSetHookBeforeQuitEvent', false).then(() => {
            if (this.pendingUpdateVersion) {
                desktop.invoke('updaterInstall', this.pendingUpdateVersion).then(({ error }) => {
                    if (error) {
                        logger.error('Error installing update', error);
                        desktop.invoke('launcherQuit');
                    }
                });
            } else {
                desktop.invoke('launcherQuit');
            }
        });
    },
    requestRestartAndUpdate(version) {
        this.pendingUpdateVersion = version;
        this.requestExit();
    },
    cancelRestart() {
        this.pendingUpdateVersion = undefined;
    },
    checkForUpdate() {
        return this.updaterCall('updaterCheck');
    },
    downloadUpdate(version) {
        return this.updaterCall('updaterDownload', version);
    },
    updaterCall(channel, ...args) {
        return desktop.invoke(channel, ...args).then(({ result, error }) => {
            if (error) {
                throw error;
            }
            return result;
        });
    },
    setClipboardText(text, clearAfterSeconds) {
        desktop.invoke('launcherWriteClipboard', text, clearAfterSeconds);
    },
    clearClipboardText() {
        // clears only the text copied with setClipboardText, if it's still there
        desktop.invoke('launcherClearClipboard');
    },
    quitOnRealQuitEventIfMinimizeOnQuitIsEnabled() {
        return !!this.pendingUpdateVersion;
    },
    minimizeApp() {
        desktop.invoke('launcherMinimizeApp', {
            restore: Locale.menuRestoreApp.replace('{}', 'KeeWeb'),
            quit: Locale.menuQuitApp.replace('{}', 'KeeWeb')
        });
    },
    canDetectOsSleep() {
        return this.platform() !== 'linux';
    },
    updaterEnabled() {
        return this.platform() !== 'linux';
    },
    hideApp() {
        if (this.platform() === 'darwin') {
            desktop.invoke('launcherHideApp');
        } else {
            desktop.invoke('launcherMinimizeThenHideIfInTray');
        }
    },
    isAppFocused() {
        return document.hasFocus();
    },
    showMainWindow() {
        desktop.invoke('launcherShowMainWindow');
    },
    async httpRequest(config) {
        const { url, method, headers, data, dataIsMultipart } = config;
        const res = await desktop.invoke('launcherHttpRequest', {
            url,
            method,
            headers,
            data,
            dataIsMultipart
        });
        if (res.error) {
            throw Object.assign(new Error(res.error), { notAllowed: res.notAllowed });
        }
        return res;
    },
    runYkman(args, { throwOnStdErr, noStdOutLogging, complete }) {
        const ts = logger.ts();
        const cmd = `ykman ${args.join(' ')}`;
        desktop.invoke('ykmanRun', args, { throwOnStdErr }).then(
            (res) => {
                if (res.err) {
                    logger.error(`${cmd} error, ${logger.ts(ts)}`, res.err);
                    return complete?.(res.err);
                }
                const { code, stdout, stderr } = res;
                const msg = `${cmd}: ${code}, ${logger.ts(ts)}`;
                if (code !== 0) {
                    logger.error(msg + '\n' + stdout + '\n' + stderr);
                } else {
                    logger.info(msg + (stdout && !noStdOutLogging ? '\n' + stdout : ''));
                }
                complete?.(code !== 0 ? 'Exit code ' + code : null, stdout, code);
            },
            (err) => complete?.(err)
        );
    },
    appRightsNeedRunInstaller() {
        return desktop.invoke('appRightsNeedRunInstaller');
    },
    appRightsRunInstaller() {
        return desktop.invoke('appRightsRunInstaller');
    },
    oauthListen(storageName, pageHtml) {
        return desktop.invoke('oauthListen', { storageName, pageHtml });
    },
    oauthStop() {
        return desktop.invoke('oauthStop');
    },
    checkOpenFiles() {
        this.readyToOpenFiles = true;
        if (this.pendingFileToOpen) {
            this.openFile(this.pendingFileToOpen);
            delete this.pendingFileToOpen;
        }
    },
    openFile(file) {
        if (this.readyToOpenFiles) {
            Events.emit('launcher-open-file', file);
        } else {
            this.pendingFileToOpen = file;
        }
    },
    setGlobalShortcuts(appSettings) {
        const shortcuts = Object.fromEntries(
            Object.entries(appSettings).filter(([key]) => key.startsWith('globalShortcut'))
        );
        desktop.invoke('launcherSetGlobalShortcuts', shortcuts);
    },
    minimizeMainWindow() {
        desktop.invoke('launcherMinimizeMainWindow');
    },
    maximizeMainWindow() {
        desktop.invoke('launcherMaximizeMainWindow');
    },
    restoreMainWindow() {
        desktop.invoke('launcherRestoreMainWindow');
    },
    mainWindowMaximized() {
        return desktop.sendSync('launcherIsMainWindowMaximized');
    }
};

Events.on('launcher-exit-request', () => {
    setTimeout(() => Launcher.exit(), 0);
});
Events.on('launcher-minimize', () => setTimeout(() => Events.emit('app-minimized'), 0));
Events.on('launcher-maximize', () => setTimeout(() => Events.emit('app-maximized'), 0));
Events.on('launcher-unmaximize', () => setTimeout(() => Events.emit('app-unmaximized'), 0));
Events.on('launcher-started-minimized', () => setTimeout(() => Launcher.minimizeApp(), 0));
Events.on('launcher-open-file-request', (file) => {
    logger.info('Open file request', file.data);
    Launcher.openFile(file);
});
Events.on('start-profile', (data) => StartProfiler.reportAppProfile(data));

Events.on('app-ready', () =>
    setTimeout(() => {
        Launcher.checkOpenFiles();
        desktop.invoke('launcherSetAboutPanelOptions', {
            applicationVersion: RuntimeInfo.version,
            version: RuntimeInfo.commit
        });
    }, 0)
);

if (Launcher.platform() === 'darwin') {
    desktop.invoke('launcherSetHookBeforeQuitEvent', true);
}

desktop.on('remote-app-event', (e) => {
    if (window.debugRemoteAppEvents) {
        logger.debug('remote-app-event', e.name);
    }
    Events.emit(e.name, e.data);
});
desktop.on('fsFileChanged', (watchId) => {
    fileWatchCallbacks.get(watchId)?.();
});

export { Launcher };
