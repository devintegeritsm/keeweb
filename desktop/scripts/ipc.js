module.exports.setupIpcHandlers = () => {
    require('./ipc-handlers/browser-extension-connector');
    require('./ipc-handlers/external-tools');
    require('./ipc-handlers/files');
    require('./ipc-handlers/hardware-crypto');
    require('./ipc-handlers/launcher');
    require('./ipc-handlers/native-module-host-proxy');
    require('./ipc-handlers/oauth-listener');
    require('./ipc-handlers/set-locale');
    require('./ipc-handlers/updater');
};
