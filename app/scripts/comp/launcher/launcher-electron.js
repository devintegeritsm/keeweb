import { Events } from 'framework/events';
import { StartProfiler } from 'comp/app/start-profiler';
import { RuntimeInfo } from 'const/runtime-info';
import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import { noop } from 'util/fn';

const logger = new Logger('launcher');

const Launcher = {
    name: 'electron',
    version: window.process.versions.electron,
    autoTypeSupported: true,
    thirdPartyStoragesSupported: true,
    clipboardSupported: true,
    req: window.require,
    platform() {
        return process.platform;
    },
    arch() {
        return process.arch;
    },
    electron() {
        return this.req('electron');
    },
    ipcRenderer() {
        return this.electron().ipcRenderer;
    },
    info() {
        if (!this._info) {
            this._info = this.ipcRenderer().sendSync('launcherGetInfo');
        }
        return this._info;
    },
    openLink(href) {
        if (/^(http|https|ftp|sftp|mailto):/i.test(href)) {
            this.electron().shell.openExternal(href);
        }
    },
    devTools: true,
    openDevTools() {
        this.ipcRenderer().invoke('launcherOpenDevTools');
    },
    getSaveFileName(defaultFileName, callback) {
        this.ipcRenderer()
            .invoke('launcherShowSaveDialog', {
                title: Locale.launcherSave,
                defaultFileName,
                filterName: Locale.launcherFileFilter
            })
            .then((filePath) => callback(filePath));
    },
    getPathForFile(file) {
        return this.electron().webUtils.getPathForFile(file) || undefined;
    },
    getUserDataPath(fileName) {
        return this.joinPath(this.info().userDataPath, fileName || '');
    },
    getTempPath(fileName) {
        let tempPath = this.joinPath(this.info().tempPath, 'KeeWeb');
        const fs = this.req('fs');
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath);
        }
        if (fileName) {
            tempPath = this.joinPath(tempPath, fileName);
        }
        return tempPath;
    },
    getDocumentsPath(fileName) {
        return this.joinPath(this.info().documentsPath, fileName || '');
    },
    getAppPath(fileName) {
        return this.joinPath(this.info().appPath, fileName || '');
    },
    getWorkDirPath(fileName) {
        return this.joinPath(process.cwd(), fileName || '');
    },
    joinPath(...parts) {
        return this.req('path').join(...parts);
    },
    writeFile(path, data, callback) {
        this.writeFileReplacing(path, window.Buffer.from(data)).then(() => callback(), callback);
    },
    async writeFileReplacing(path, data) {
        // write to a temp file and rename it, so a crash or a full disk can't truncate the file
        const fs = this.req('fs').promises;
        const pathModule = this.req('path');
        let targetPath = path;
        let mode;
        try {
            // replace the file a symlink points to, not the symlink itself
            targetPath = await fs.realpath(path);
            mode = (await fs.stat(targetPath)).mode & 0o777;
        } catch {}
        if (mode !== undefined) {
            // read-only files must not be replaced, an in-place write would fail as well
            await fs.access(targetPath, this.req('fs').constants.W_OK);
        }
        const tmpPath = pathModule.join(
            pathModule.dirname(targetPath),
            `.${pathModule.basename(targetPath)}.${Date.now()}${Math.random()
                .toString(36)
                .substr(2, 6)}.tmp`
        );
        let handle;
        try {
            handle = await fs.open(tmpPath, 'wx', mode);
        } catch (e) {
            logger.warn('Cannot create a temp file, writing in place', e);
            return fs.writeFile(targetPath, data);
        }
        try {
            try {
                if (mode !== undefined) {
                    await handle.chmod(mode);
                }
                await handle.writeFile(data);
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch (e) {
            await fs.unlink(tmpPath).catch(noop);
            throw e;
        }
        try {
            await fs.rename(tmpPath, targetPath);
        } catch (e) {
            await fs.unlink(tmpPath).catch(noop);
            if (process.platform !== 'win32') {
                throw e;
            }
            // windows can't replace a file opened by another app, e.g. a sync client
            logger.warn('Cannot replace the file, writing in place', e);
            await fs.writeFile(targetPath, data);
        }
    },
    readFile(path, encoding, callback) {
        this.req('fs').readFile(path, encoding, (err, contents) => {
            const data = typeof contents === 'string' ? contents : new Uint8Array(contents);
            callback(data, err);
        });
    },
    fileExists(path, callback) {
        const fs = this.req('fs');
        fs.access(path, fs.constants.F_OK, (err) => callback(!err));
    },
    fileExistsSync(path) {
        const fs = this.req('fs');
        return !fs.accessSync(path, fs.constants.F_OK);
    },
    deleteFile(path, callback) {
        this.req('fs').unlink(path, callback || noop);
    },
    statFile(path, callback) {
        this.req('fs').stat(path, (err, stats) => callback(stats, err));
    },
    mkdir(dir, callback) {
        const fs = this.req('fs');
        const path = this.req('path');
        const stack = [];

        const collect = function (dir, stack, callback) {
            fs.exists(dir, (exists) => {
                if (exists) {
                    return callback();
                }

                stack.unshift(dir);
                const newDir = path.dirname(dir);
                if (newDir === dir || !newDir || newDir === '.' || newDir === '/') {
                    return callback();
                }

                collect(newDir, stack, callback);
            });
        };

        const create = function (stack, callback) {
            if (!stack.length) {
                return callback();
            }

            fs.mkdir(stack.shift(), (err) => (err ? callback(err) : create(stack, callback)));
        };

        collect(dir, stack, () => create(stack, callback));
    },
    parsePath(fileName) {
        const path = this.req('path');
        return {
            path: fileName,
            dir: path.dirname(fileName),
            file: path.basename(fileName)
        };
    },
    createFsWatcher(path) {
        return this.req('fs').watch(path, { persistent: false });
    },
    loadConfig(name) {
        return this.ipcRenderer().invoke('launcherLoadConfig', name);
    },
    saveConfig(name, data) {
        return this.ipcRenderer().invoke('launcherSaveConfig', name, data);
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
        const ipcRenderer = this.ipcRenderer();
        ipcRenderer.invoke('launcherSetHookBeforeQuitEvent', false).then(() => {
            if (this.pendingUpdateFile) {
                ipcRenderer.invoke('launcherRestartAndUpdate', this.pendingUpdateFile);
            } else {
                ipcRenderer.invoke('launcherQuit');
            }
        });
    },
    requestRestartAndUpdate(updateFilePath) {
        this.pendingUpdateFile = updateFilePath;
        this.requestExit();
    },
    cancelRestart() {
        this.pendingUpdateFile = undefined;
    },
    setClipboardText(text, clearAfterSeconds) {
        this.ipcRenderer().invoke('launcherWriteClipboard', text, clearAfterSeconds);
    },
    clearClipboardText() {
        // clears only the text copied with setClipboardText, if it's still there
        this.ipcRenderer().invoke('launcherClearClipboard');
    },
    quitOnRealQuitEventIfMinimizeOnQuitIsEnabled() {
        return !!this.pendingUpdateFile;
    },
    minimizeApp() {
        this.ipcRenderer().invoke('launcherMinimizeApp', {
            restore: Locale.menuRestoreApp.replace('{}', 'KeeWeb'),
            quit: Locale.menuQuitApp.replace('{}', 'KeeWeb')
        });
    },
    canDetectOsSleep() {
        return process.platform !== 'linux';
    },
    updaterEnabled() {
        return process.platform !== 'linux';
    },
    resolveProxy(url, callback) {
        this.ipcRenderer()
            .invoke('launcherResolveProxy', url)
            .then((proxy) => {
                const match = /^proxy\s+([\w\.]+):(\d+)+\s*/i.exec(proxy);
                proxy = match && match[1] ? { host: match[1], port: +match[2] } : null;
                callback(proxy);
            });
    },
    hideApp() {
        if (this.platform() === 'darwin') {
            this.ipcRenderer().invoke('launcherHideApp');
        } else {
            this.ipcRenderer().invoke('launcherMinimizeThenHideIfInTray');
        }
    },
    isAppFocused() {
        return document.hasFocus();
    },
    showMainWindow() {
        this.ipcRenderer().invoke('launcherShowMainWindow');
    },
    async httpRequest(config) {
        const { url, method, headers, data, dataIsMultipart } = config;
        const res = await this.ipcRenderer().invoke('launcherHttpRequest', {
            url,
            method,
            headers,
            data,
            dataIsMultipart
        });
        if (res.error) {
            throw res.error;
        }
        return res;
    },
    spawn(config) {
        const ts = logger.ts();
        const { ipcRenderer } = this.electron();
        let { complete } = config;
        delete config.complete;
        ipcRenderer
            .invoke('spawnProcess', config)
            .then((res) => {
                if (res.err) {
                    logger.error('spawn error: ' + config.cmd + ', ' + logger.ts(ts), res.err);
                    complete?.(res.err);
                } else {
                    const code = res.code;
                    const stdout = res.stdout || '';
                    const stderr = res.stderr || '';
                    const msg = 'spawn ' + config.cmd + ': ' + code + ', ' + logger.ts(ts);
                    if (code !== 0) {
                        logger.error(msg + '\n' + stdout + '\n' + stderr);
                    } else {
                        logger.info(msg + (stdout && !config.noStdOutLogging ? '\n' + stdout : ''));
                    }
                    complete?.(code !== 0 ? 'Exit code ' + code : null, stdout, code);
                }
                complete = null;
            })
            .catch((err) => {
                complete?.(err);
            });
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
        this.ipcRenderer().invoke('launcherSetGlobalShortcuts', shortcuts);
    },
    minimizeMainWindow() {
        this.ipcRenderer().invoke('launcherMinimizeMainWindow');
    },
    maximizeMainWindow() {
        this.ipcRenderer().invoke('launcherMaximizeMainWindow');
    },
    restoreMainWindow() {
        this.ipcRenderer().invoke('launcherRestoreMainWindow');
    },
    mainWindowMaximized() {
        return this.ipcRenderer().sendSync('launcherIsMainWindowMaximized');
    }
};

Events.on('launcher-exit-request', () => {
    setTimeout(() => Launcher.exit(), 0);
});
Events.on('launcher-minimize', () => setTimeout(() => Events.emit('app-minimized'), 0));
Events.on('launcher-maximize', () => setTimeout(() => Events.emit('app-maximized'), 0));
Events.on('launcher-unmaximize', () => setTimeout(() => Events.emit('app-unmaximized'), 0));
Events.on('launcher-started-minimized', () => setTimeout(() => Launcher.minimizeApp(), 0));
Events.on('start-profile', (data) => StartProfiler.reportAppProfile(data));

window.launcherOpen = (file) => Launcher.openFile(file);
if (window.launcherOpenedFile) {
    logger.info('Open file request', window.launcherOpenedFile);
    Launcher.openFile(window.launcherOpenedFile);
    delete window.launcherOpenedFile;
}
Events.on('app-ready', () =>
    setTimeout(() => {
        Launcher.checkOpenFiles();
        Launcher.ipcRenderer().invoke('launcherSetAboutPanelOptions', {
            applicationVersion: RuntimeInfo.version,
            version: RuntimeInfo.commit
        });
    }, 0)
);

if (process.platform === 'darwin') {
    Launcher.ipcRenderer().invoke('launcherSetHookBeforeQuitEvent', true);
}

Launcher.ipcRenderer().on('remote-app-event', (event, e) => {
    if (window.debugRemoteAppEvents) {
        logger.debug('remote-app-event', e.name);
    }
    Events.emit(e.name, e.data);
});

export { Launcher };
