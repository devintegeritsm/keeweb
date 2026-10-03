const { app, ipcMain } = require('electron');

// IPC is accepted only from the top frame of the main window

function isTrustedSender(e) {
    const mainWindow = app.getMainWindow();
    return (
        !!mainWindow &&
        !mainWindow.isDestroyed() &&
        e.sender === mainWindow.webContents &&
        !!e.senderFrame &&
        e.senderFrame === e.sender.mainFrame
    );
}

function handle(channel, listener) {
    ipcMain.handle(channel, (e, ...args) => {
        if (!isTrustedSender(e)) {
            throw new Error(`Untrusted IPC sender: ${channel}`);
        }
        return listener(e, ...args);
    });
}

function on(channel, listener) {
    ipcMain.on(channel, (e, ...args) => {
        if (!isTrustedSender(e)) {
            e.returnValue = undefined;
            return;
        }
        listener(e, ...args);
    });
}

module.exports = { handle, on };
