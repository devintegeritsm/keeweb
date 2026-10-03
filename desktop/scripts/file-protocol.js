const fs = require('fs');
const path = require('path');
const url = require('url');

// Electron gives pages on file:// extra privileges, among them reading any local file with fetch.
// The app needs them: without them it can't use localStorage, and on another origin WebDAV
// requests are blocked by CORS. Instead file:// is served here, only from the app folder,
// so a compromised page gets nothing but the app files.

const ContentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function isInFolder(filePath, folder) {
    const rel = path.relative(folder, filePath);
    return !!rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

async function serveAppFile(request, appPath) {
    let filePath;
    try {
        filePath = path.resolve(url.fileURLToPath(request.url));
    } catch {
        return new Response(null, { status: 400 });
    }
    if (!isInFolder(filePath, appPath)) {
        return new Response(null, { status: 404 });
    }
    try {
        const data = await fs.promises.readFile(filePath);
        const contentType =
            ContentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        return new Response(data, { headers: { 'Content-Type': contentType } });
    } catch {
        return new Response(null, { status: 404 });
    }
}

function handleFileProtocol(protocol, appPath) {
    protocol.handle('file', (request) => serveAppFile(request, appPath));
}

module.exports = { handleFileProtocol, serveAppFile };
