const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { handle, on } = require('../ipc-validation');
const { Logger } = require('../logger');
const {
    normalizePath,
    grantFile,
    ensureFileAccess,
    ensureFolderAccess,
    ensureOwnPath,
    canAccessFile,
    canAccessFolder
} = require('../file-access');

const logger = new Logger('files');

handleFs('fsReadFile', async (filePath) => {
    await ensureFileAccess(filePath);
    return new Uint8Array(await fs.promises.readFile(filePath));
});
handleFs('fsWriteFile', async (filePath, data) => {
    await ensureFileAccess(filePath);
    await writeFileReplacing(filePath, Buffer.from(data));
});
handleFs('fsStat', async (filePath) => {
    if (!canAccessFile(filePath) && !canAccessFolder(filePath)) {
        // allowing a folder here is how backups get their folder, it's asked about like a file
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat) {
            throw Object.assign(new Error(`Not found: ${filePath}`), { code: 'ENOENT' });
        }
        if (stat.isDirectory()) {
            await ensureFolderAccess(filePath);
        } else {
            await ensureFileAccess(filePath);
        }
    }
    const stat = await fs.promises.stat(filePath);
    return { mtime: stat.mtimeMs, size: stat.size, isDirectory: stat.isDirectory() };
});
handleFs('fsExists', async (filePath) => {
    if (!canAccessFile(filePath) && !canAccessFolder(filePath)) {
        return false;
    }
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
});
handleFs('fsDeleteFile', async (filePath) => {
    // only cached files are deleted
    await ensureOwnPath(filePath);
    await fs.promises.unlink(filePath);
});
handleFs('fsMkdir', async (folderPath) => {
    await ensureFolderAccess(folderPath);
    await fs.promises.mkdir(folderPath, { recursive: true });
});
handleFs('fsWatchFile', async (filePath) => {
    await ensureFileAccess(filePath, { prompt: false });
    return watchFile(filePath);
});
handle('fsUnwatchFile', (e, watchId) => unwatchFile(watchId));
handle('fsShowSaveDialog', showSaveDialog);
on('fsGrantUserFile', (e, filePath) => {
    // the preload sends paths of files picked or dropped by the user
    try {
        grantFile(filePath);
        e.returnValue = true;
    } catch {
        e.returnValue = false;
    }
});

function handleFs(channel, listener) {
    handle(channel, async (e, filePath, ...args) => {
        try {
            filePath = normalizePath(filePath);
            return { result: await listener(filePath, ...args) };
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.info(`${channel} error`, filePath, err.message);
            }
            return { error: { code: err.code, message: err.message } };
        }
    });
}

async function writeFileReplacing(filePath, data) {
    // write to a temp file and rename it, so a crash or a full disk can't truncate the file
    let targetPath = filePath;
    let mode;
    try {
        // replace the file a symlink points to, not the symlink itself
        targetPath = await fs.promises.realpath(filePath);
        mode = (await fs.promises.stat(targetPath)).mode & 0o777;
    } catch {}
    if (mode !== undefined) {
        // read-only files must not be replaced, an in-place write would fail as well
        await fs.promises.access(targetPath, fs.constants.W_OK);
    }
    const tmpPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.${Date.now()}${Math.random().toString(36).substr(2, 6)}.tmp`
    );
    let handle;
    try {
        handle = await fs.promises.open(tmpPath, 'wx', mode);
    } catch (e) {
        logger.warn('Cannot create a temp file, writing in place', e.message);
        return fs.promises.writeFile(targetPath, data);
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
        await fs.promises.unlink(tmpPath).catch(() => {});
        throw e;
    }
    try {
        await fs.promises.rename(tmpPath, targetPath);
    } catch (e) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        if (process.platform !== 'win32') {
            throw e;
        }
        // windows can't replace a file opened by another app, e.g. a sync client
        logger.warn('Cannot replace the file, writing in place', e.message);
        await fs.promises.writeFile(targetPath, data);
    }
}

const folderWatchers = new Map();
const fileWatches = new Map();
let nextWatchId = 1;

function watchFile(filePath) {
    const folder = path.dirname(filePath);
    if (folder.startsWith('\\\\')) {
        // network shares are not watched
        return null;
    }
    let folderWatcher = folderWatchers.get(folder);
    if (!folderWatcher) {
        let fsWatcher;
        try {
            fsWatcher = fs.watch(folder, { persistent: false });
        } catch (e) {
            logger.warn('Error watching folder', folder, e.message);
            return null;
        }
        folderWatcher = { fsWatcher, watchIds: new Set() };
        fsWatcher.on('change', (evt, fileName) => onFolderChange(folder, fileName));
        fsWatcher.on('error', (e) => logger.warn('Folder watcher error', folder, e.message));
        folderWatchers.set(folder, folderWatcher);
    }
    const watchId = nextWatchId++;
    folderWatcher.watchIds.add(watchId);
    fileWatches.set(watchId, { folder, fileName: path.basename(filePath) });
    return watchId;
}

function unwatchFile(watchId) {
    const watch = fileWatches.get(watchId);
    if (!watch) {
        return;
    }
    fileWatches.delete(watchId);
    const folderWatcher = folderWatchers.get(watch.folder);
    folderWatcher.watchIds.delete(watchId);
    if (!folderWatcher.watchIds.size) {
        folderWatcher.fsWatcher.close();
        folderWatchers.delete(watch.folder);
    }
}

function onFolderChange(folder, fileName) {
    const folderWatcher = folderWatchers.get(folder);
    if (!folderWatcher) {
        return;
    }
    for (const watchId of folderWatcher.watchIds) {
        if (fileWatches.get(watchId).fileName === fileName) {
            app.getMainWindow()?.webContents.send('fsFileChanged', watchId);
        }
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
    if (res.canceled || !res.filePath) {
        return undefined;
    }
    grantFile(res.filePath);
    return res.filePath;
}
