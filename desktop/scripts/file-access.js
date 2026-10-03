const path = require('path');
const { app, dialog } = require('electron');
const { locale } = require('./locale');

// The app UI can access only files the user chose: in open and save dialogs, with drag and drop,
// by opening a file with the app, or by allowing it in a prompt; and the app's own folders.
// This way a compromised page can't read or overwrite other files.

const ConfigName = 'file-access';
const OwnFolderNames = ['OfflineFiles', 'PluginFiles', 'FilesCache'];
// folders are allowed for backups, only database files can be written there
const FolderFileExtensions = ['.kdbx', '.bak'];
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
// after this many denials in a row the page is probably not asking for the user, stop asking
const MaxDeniedPrompts = 3;

const files = new Map();
const folders = new Map();
const deniedInSession = new Set();
const pendingPrompts = new Map();
let promptQueue = Promise.resolve();
let deniedPrompts = 0;
let loadPromise;

function normalizePath(filePath) {
    if (
        typeof filePath !== 'string' ||
        !filePath ||
        filePath.includes('\0') ||
        !path.isAbsolute(filePath)
    ) {
        throw new Error('Bad path');
    }
    return path.resolve(filePath);
}

function pathKey(filePath) {
    return caseInsensitive ? filePath.toLowerCase() : filePath;
}

function isInFolder(filePath, folder) {
    const rel = path.relative(pathKey(folder), pathKey(filePath));
    return !!rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

function isSameOrInFolder(filePath, folder) {
    return pathKey(filePath) === pathKey(folder) || isInFolder(filePath, folder);
}

function getOwnFolders() {
    const userData = app.getPath('userData');
    return OwnFolderNames.map((name) => path.join(userData, name));
}

function isOwnPath(filePath) {
    return getOwnFolders().some((folder) => isSameOrInFolder(filePath, folder));
}

function canAccessFile(filePath) {
    if (files.has(pathKey(filePath)) || isOwnPath(filePath)) {
        return true;
    }
    const ext = path.extname(filePath).toLowerCase();
    return (
        FolderFileExtensions.includes(ext) &&
        [...folders.values()].some((folder) => isInFolder(filePath, folder))
    );
}

function canAccessFolder(folderPath) {
    return (
        isOwnPath(folderPath) ||
        [...folders.values()].some((folder) => isSameOrInFolder(folderPath, folder))
    );
}

function grantFile(filePath) {
    filePath = normalizePath(filePath);
    if (!files.has(pathKey(filePath))) {
        files.set(pathKey(filePath), filePath);
        save();
    }
}

function grantFolder(folderPath) {
    folderPath = normalizePath(folderPath);
    if (!folders.has(pathKey(folderPath))) {
        folders.set(pathKey(folderPath), folderPath);
        save();
    }
}

async function requestAccess(filePath, kind) {
    const promptKey = `${kind}:${pathKey(filePath)}`;
    if (deniedInSession.has(promptKey) || deniedPrompts >= MaxDeniedPrompts) {
        return false;
    }
    if (!pendingPrompts.has(promptKey)) {
        // one dialog at a time
        const prompt = promptQueue
            .then(() => (deniedPrompts >= MaxDeniedPrompts ? false : showPrompt(filePath, kind)))
            .then((allowed) => {
                if (allowed) {
                    deniedPrompts = 0;
                    if (kind === 'folder') {
                        grantFolder(filePath);
                    } else {
                        grantFile(filePath);
                    }
                } else {
                    deniedPrompts++;
                    deniedInSession.add(promptKey);
                }
                return allowed;
            })
            .finally(() => pendingPrompts.delete(promptKey));
        promptQueue = prompt.catch(() => {});
        pendingPrompts.set(promptKey, prompt);
    }
    return pendingPrompts.get(promptKey);
}

async function showPrompt(filePath, kind) {
    const mainWindow = app.getMainWindow();
    const options = {
        type: 'question',
        buttons: [locale.sysFileAccessAllow || 'Allow', locale.sysFileAccessDeny || 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message:
            kind === 'folder'
                ? locale.sysFileAccessFolder || 'Allow KeeWeb to save files in this folder?'
                : locale.sysFileAccessFile || 'Allow KeeWeb to open this file?',
        detail:
            filePath +
            '\n\n' +
            (locale.sysFileAccessDetail ||
                "KeeWeb can open only files you selected. Deny if you didn't ask KeeWeb to open or save it.")
    };
    const { response } = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
    return response === 0;
}

function accessDenied(filePath) {
    const err = new Error(`Access denied: ${filePath}`);
    err.code = 'EACCES';
    return err;
}

async function ensureFileAccess(filePath, { prompt = true } = {}) {
    await load();
    if (canAccessFile(filePath)) {
        return;
    }
    if (prompt && (await requestAccess(filePath, 'file'))) {
        return;
    }
    throw accessDenied(filePath);
}

async function ensureFolderAccess(folderPath, { prompt = true } = {}) {
    await load();
    if (canAccessFolder(folderPath)) {
        return;
    }
    if (prompt && (await requestAccess(folderPath, 'folder'))) {
        return;
    }
    throw accessDenied(folderPath);
}

async function ensureOwnPath(filePath) {
    await load();
    if (!isOwnPath(filePath)) {
        throw accessDenied(filePath);
    }
}

function load() {
    if (!loadPromise) {
        loadPromise = loadConfig();
    }
    return loadPromise;
}

async function loadConfig() {
    let data;
    try {
        data = await app.loadConfig(ConfigName);
    } catch {
        // without the saved grants the user is asked again, nothing is migrated
        return;
    }
    if (data === null) {
        // the first start with access checks; the page can write file-info,
        // so this runs only once and before the app window is created
        await migrateFromFileInfo();
        const config = { files: [...files.values()], folders: [...folders.values()] };
        await app.saveConfig(ConfigName, JSON.stringify(config)).catch(() => {});
        return;
    }
    let config;
    try {
        config = JSON.parse(data);
    } catch {}
    for (const filePath of config?.files || []) {
        files.set(pathKey(filePath), filePath);
    }
    for (const folderPath of config?.folders || []) {
        folders.set(pathKey(folderPath), folderPath);
    }
}

async function migrateFromFileInfo() {
    // files opened before access was limited stay available
    let fileInfos;
    try {
        fileInfos = JSON.parse((await app.loadConfig('file-info')) || '[]');
    } catch {}
    if (!Array.isArray(fileInfos)) {
        return;
    }
    const tryAdd = (map, filePath) => {
        try {
            filePath = normalizePath(filePath);
            map.set(pathKey(filePath), filePath);
        } catch {}
    };
    for (const fileInfo of fileInfos) {
        if (fileInfo.storage === 'file' && fileInfo.path) {
            tryAdd(files, fileInfo.path);
        }
        if (fileInfo.keyFilePath) {
            tryAdd(files, fileInfo.keyFilePath);
        }
        if (fileInfo.backup?.storage === 'file' && fileInfo.backup.path) {
            const folder = path.dirname(fileInfo.backup.path);
            if (!folder.includes('{')) {
                tryAdd(folders, folder);
            }
        }
    }
}

function save() {
    // grants made while loading are merged with the loaded ones
    load()
        .then(() => {
            const config = { files: [...files.values()], folders: [...folders.values()] };
            return app.saveConfig(ConfigName, JSON.stringify(config));
        })
        .catch(() => {});
}

module.exports = {
    normalizePath,
    grantFile,
    grantFolder,
    ensureFileAccess,
    ensureFolderAccess,
    ensureOwnPath,
    canAccessFile,
    canAccessFolder,
    load
};
