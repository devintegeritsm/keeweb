const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { expect } = require('chai');
const mock = require('./mock-electron');

const { isAllowedYkmanCommand } = require('../scripts/ipc-handlers/external-tools');
const { isHttpRequestAllowed } = require('../scripts/ipc-handlers/launcher');
const { getAsset, getAssetName } = require('../scripts/ipc-handlers/updater');
const { verifyFileSignature } = require('../scripts/update-signature');
const { handle } = require('../scripts/ipc-validation');

describe('ykman commands', () => {
    it('allows the commands the app runs', () => {
        expect(isAllowedYkmanCommand(['-v'])).to.be.true;
        expect(isAllowedYkmanCommand(['list'])).to.be.true;
        expect(isAllowedYkmanCommand(['config', 'usb', '-e', 'oath', '-f'])).to.be.true;
        expect(isAllowedYkmanCommand(['-d', '12345678', 'oath', 'accounts', 'code'])).to.be.true;
        expect(
            isAllowedYkmanCommand([
                '-d',
                '12345678',
                'oath',
                'accounts',
                'code',
                '--single',
                'GitHub:me'
            ])
        ).to.be.true;
    });

    it('rejects other commands', () => {
        expect(isAllowedYkmanCommand(['--help'])).to.be.false;
        expect(isAllowedYkmanCommand(['list', '--json'])).to.be.false;
        expect(isAllowedYkmanCommand([])).to.be.false;
        expect(isAllowedYkmanCommand('list')).to.be.false;
        expect(isAllowedYkmanCommand(['-d', '1x', 'oath', 'accounts', 'code'])).to.be.false;
        expect(isAllowedYkmanCommand(['-d', '1', 'oath', 'accounts', 'delete', 'x'])).to.be.false;
        expect(isAllowedYkmanCommand(['-d', '1', 'oath', 'accounts', 'code', '--single', '--help']))
            .to.be.false;
        expect(isAllowedYkmanCommand(['-d', 1, 'oath', 'accounts', 'code'])).to.be.false;
    });
});

describe('storage HTTP requests', () => {
    it('allows cloud storage APIs over https', () => {
        expect(isHttpRequestAllowed('https://api.dropboxapi.com/2/files/download')).to.be.true;
        expect(isHttpRequestAllowed('https://content.dropboxapi.com/2/files/upload')).to.be.true;
        expect(isHttpRequestAllowed('https://www.googleapis.com/drive/v3/files')).to.be.true;
        expect(isHttpRequestAllowed('https://graph.microsoft.com/v1.0/me')).to.be.true;
        expect(isHttpRequestAllowed('https://my.microsoftpersonalcontent.com/x')).to.be.true;
        expect(isHttpRequestAllowed('https://contoso.sharepoint.com/x')).to.be.true;
    });

    it('rejects other hosts', () => {
        expect(isHttpRequestAllowed('http://api.dropboxapi.com/2/files/download')).to.be.false;
        expect(isHttpRequestAllowed('https://dropboxapi.com.evil.com/')).to.be.false;
        expect(isHttpRequestAllowed('https://evildropboxapi.com/')).to.be.false;
        expect(isHttpRequestAllowed('https://evil.com/?dropboxapi.com')).to.be.false;
        expect(isHttpRequestAllowed('https://localhost/')).to.be.false;
        expect(isHttpRequestAllowed('https://169.254.169.254/latest/meta-data')).to.be.false;
        expect(isHttpRequestAllowed('file:///etc/passwd')).to.be.false;
        expect(isHttpRequestAllowed('not a url')).to.be.false;
    });
});

describe('IPC sender validation', () => {
    it('accepts messages only from the top frame of the main window', async () => {
        handle('testChannel', () => 'ok');
        const listener = mock.handlers.testChannel;
        expect(await listener(mock.trustedEvent())).to.eql('ok');
        expect(() => listener({ sender: mock.mainWindow.webContents, senderFrame: {} })).to.throw(
            'Untrusted IPC sender'
        );
        expect(() =>
            listener({ sender: {}, senderFrame: mock.mainWindow.webContents.mainFrame })
        ).to.throw('Untrusted IPC sender');
        expect(() => listener({ sender: mock.mainWindow.webContents, senderFrame: null })).to.throw(
            'Untrusted IPC sender'
        );
    });
});

describe('updates', () => {
    it('makes asset names for platforms with updates', () => {
        expect(getAssetName('1.19.0', 'win32', 'x64')).to.eql('KeeWeb-1.19.0.win.x64.exe');
        expect(getAssetName('1.19.0', 'darwin', 'arm64')).to.eql('KeeWeb-1.19.0.mac.arm64.dmg');
        expect(getAssetName('1.19.0', 'linux', 'x64')).to.be.undefined;
        expect(getAssetName('1.19.0', 'darwin', 'ia32')).to.be.undefined;
    });

    it('rejects versions that are not version numbers', () => {
        for (const version of ['../1.0.0', '1.0.0 /S', '1.0', '', null, '1.0.0\n']) {
            expect(() => getAsset(version)).to.throw('Invalid version');
        }
    });

    it('verifies update signatures', async () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        const filePath = path.join(mock.tempDir, 'update.exe');
        fs.writeFileSync(filePath, crypto.randomBytes(100000));
        const signature = crypto.sign('sha256', fs.readFileSync(filePath), privateKey);

        expect(await verifyFileSignature(filePath, signature, [publicKey])).to.be.true;
        expect(await verifyFileSignature(filePath, signature)).to.be.false;

        fs.appendFileSync(filePath, 'x');
        expect(await verifyFileSignature(filePath, signature, [publicKey])).to.be.false;
    });
});
