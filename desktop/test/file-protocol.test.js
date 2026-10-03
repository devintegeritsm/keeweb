const fs = require('fs');
const path = require('path');
const url = require('url');
const { expect } = require('chai');
const mock = require('./mock-electron');
const { handleFileProtocol, serveAppFile } = require('../scripts/file-protocol');

const appPath = path.join(mock.tempDir, 'app.asar');
const secretPath = path.join(mock.tempDir, 'secret.txt');

function request(filePath) {
    return new Request(url.pathToFileURL(filePath).href);
}

describe('file-protocol', () => {
    before(() => {
        fs.mkdirSync(appPath, { recursive: true });
        fs.writeFileSync(path.join(appPath, 'index.html'), '<html></html>');
        fs.writeFileSync(secretPath, 'secret');
    });

    it('serves files from the app folder', async () => {
        const res = await serveAppFile(request(path.join(appPath, 'index.html')), appPath);
        expect(res.status).to.eql(200);
        expect(res.headers.get('Content-Type')).to.eql('text/html; charset=utf-8');
        expect(await res.text()).to.eql('<html></html>');
    });

    it("doesn't serve other files", async () => {
        for (const filePath of [secretPath, appPath, path.join(appPath, '..', 'secret.txt')]) {
            const res = await serveAppFile(request(filePath), appPath);
            expect(res.status).to.eql(404);
            expect(await res.text()).to.eql('');
        }
        const res = await serveAppFile(
            new Request(url.pathToFileURL(appPath).href + '/../secret.txt'),
            appPath
        );
        expect(res.status).to.eql(404);
    });

    it('returns 404 for missing files', async () => {
        const res = await serveAppFile(request(path.join(appPath, 'missing.js')), appPath);
        expect(res.status).to.eql(404);
    });

    it('registers the handler for file://', () => {
        const protocol = {
            handle(scheme, handler) {
                this.scheme = scheme;
                this.handler = handler;
            }
        };
        handleFileProtocol(protocol, appPath);
        expect(protocol.scheme).to.eql('file');
        expect(protocol.handler).to.be.a('function');
    });
});
