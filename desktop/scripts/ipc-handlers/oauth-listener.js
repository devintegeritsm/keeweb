const http = require('http');
const { app } = require('electron');
const { handle } = require('../ipc-validation');

// Receives OAuth redirects of cloud storage providers

const Port = 48149;

let server = null;

handle('oauthListen', (e, { storageName, pageHtml }) => {
    if (!/^[a-z]+$/.test(storageName) || typeof pageHtml !== 'string') {
        throw new Error('Bad OAuth listener options');
    }
    stop();
    return new Promise((resolve) => {
        let resultHandled = false;
        const newServer = http.createServer((req, resp) => {
            resp.writeHead(200, 'OK', { 'Content-Type': 'text/html; charset=UTF-8' });
            resp.end(pageHtml);
            if (!resultHandled) {
                resultHandled = true;
                stop();
                app.getMainWindow()?.webContents.send('oauthResult', req.url);
            }
        });
        newServer.on('error', (err) => {
            newServer.close();
            resolve({ error: `Failed to start OAuth listener: ${err.message}` });
        });
        newServer.on('listening', () => {
            server = newServer;
            resolve({ port: Port });
        });
        newServer.listen(Port);
    });
});
handle('oauthStop', () => stop());

function stop() {
    if (server) {
        server.close();
        server = null;
    }
}
