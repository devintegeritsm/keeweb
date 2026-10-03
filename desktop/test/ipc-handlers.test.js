const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { expect } = require('chai');
const mock = require('./mock-electron');

const { isAllowedYkmanCommand } = require('../scripts/ipc-handlers/external-tools');
const { isHttpRequestAllowed } = require('../scripts/ipc-handlers/launcher');
const { getAsset, getAssetName, isNewerVersion } = require('../scripts/ipc-handlers/updater');
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

    it('compares versions', () => {
        expect(isNewerVersion('1.19.0', '1.18.9')).to.be.true;
        expect(isNewerVersion('1.18.10', '1.18.9')).to.be.true;
        expect(isNewerVersion('2.0.0', '1.99.99')).to.be.true;
        expect(isNewerVersion('1.18.9', '1.18.9-beta.1')).to.be.true;
        expect(isNewerVersion('1.18.9', '1.18.9')).to.be.false;
        expect(isNewerVersion('1.18.8', '1.18.9')).to.be.false;
        expect(isNewerVersion('1.9.0', '1.18.9')).to.be.false;
        expect(isNewerVersion('1.18.9-beta.1', '1.18.9')).to.be.false;
    });

    it("doesn't download or install older versions", () => {
        for (const version of ['1.18.9', '1.18.8', '1.5.0']) {
            expect(() => getAsset(version)).to.throw('Not newer');
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

describe('files', () => {
    before(() => {
        require('../scripts/ipc-handlers/files');
    });

    it("doesn't reveal whether files the user didn't choose exist", async () => {
        mock.reset();
        const existing = path.join(mock.tempDir, 'existing.txt');
        fs.writeFileSync(existing, 'x');
        const missing = path.join(mock.tempDir, 'missing.txt');
        const resExisting = await mock.handlers.fsStat(mock.trustedEvent(), existing);
        const resMissing = await mock.handlers.fsStat(mock.trustedEvent(), missing);
        expect(JSON.stringify(resExisting).replace(existing, 'path')).to.eql(
            JSON.stringify(resMissing).replace(missing, 'path')
        );
        expect(resExisting.error.code).to.eql('ENOENT');
        expect(resMissing.error.code).to.eql('ENOENT');
        expect(mock.prompts.length).to.eql(0);
    });

    it('stats files in the app folders', async () => {
        const offlineFiles = path.join(mock.userData, 'OfflineFiles');
        fs.mkdirSync(offlineFiles, { recursive: true });
        fs.writeFileSync(path.join(offlineFiles, 'id'), 'abc');
        const res = await mock.handlers.fsStat(mock.trustedEvent(), path.join(offlineFiles, 'id'));
        expect(res.result.size).to.eql(3);
        expect(res.result.isDirectory).to.be.false;
    });
});

describe('links', () => {
    before(() => {
        mock.electron.shell.openExternal = (url) => {
            mock.openedLinks.push(url);
        };
        mock.openedLinks = [];
    });

    it('opens only web and mail links', async () => {
        const open = (url) => mock.handlers.launcherOpenLink(mock.trustedEvent(), url);
        await open('https://keeweb.info');
        await open('mailto:x@example.com');
        await open('file:///etc/passwd');
        await open('javascript:alert(1)');
        await open('not a url');
        await open(undefined);
        expect(mock.openedLinks).to.eql(['https://keeweb.info', 'mailto:x@example.com']);
    });
});
