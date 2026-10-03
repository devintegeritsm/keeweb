// The app needs no web permissions: it doesn't use the camera, microphone, notifications,
// clipboard reads or devices. Electron allows most of them by default, so a compromised page
// could e.g. read the clipboard of other apps; deny everything instead.

function setPermissionHandlers(session) {
    session.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.setDevicePermissionHandler(() => false);
}

module.exports = { setPermissionHandlers };
