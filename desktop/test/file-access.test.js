const path = require('path');
const { expect } = require('chai');
const mock = require('./mock-electron');

function loadFileAccess() {
    delete require.cache[require.resolve('../scripts/file-access')];
    return require('../scripts/file-access');
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 10));
}

const dir = path.join(mock.tempDir, 'files');

describe('file-access', () => {
    let fileAccess;

    beforeEach(() => {
        mock.reset();
        fileAccess = loadFileAccess();
    });

    it('rejects relative paths and NUL characters', () => {
        expect(() => fileAccess.normalizePath('db.kdbx')).to.throw('Bad path');
        expect(() => fileAccess.normalizePath('/tmp/db.kdbx\0.txt')).to.throw('Bad path');
        expect(() => fileAccess.normalizePath('')).to.throw('Bad path');
        expect(() => fileAccess.normalizePath(42)).to.throw('Bad path');
        expect(fileAccess.normalizePath('/tmp/a/../db.kdbx')).to.eql('/tmp/db.kdbx');
    });

    it('allows only files granted by the user', async () => {
        await fileAccess.load();
        fileAccess.grantFile(path.join(dir, 'db.kdbx'));
        expect(fileAccess.canAccessFile(path.join(dir, 'db.kdbx'))).to.be.true;
        expect(fileAccess.canAccessFile(path.join(dir, 'other.kdbx'))).to.be.false;
        expect(fileAccess.canAccessFile(path.join(dir, 'db.kdbx', 'x'))).to.be.false;
        expect(fileAccess.canAccessFolder(dir)).to.be.false;
    });

    it('allows only database files in granted folders', async () => {
        await fileAccess.load();
        fileAccess.grantFolder(path.join(dir, 'Backups'));
        expect(fileAccess.canAccessFile(path.join(dir, 'Backups', 'db.bak'))).to.be.true;
        expect(fileAccess.canAccessFile(path.join(dir, 'Backups', 'sub', 'db.kdbx'))).to.be.true;
        expect(fileAccess.canAccessFile(path.join(dir, 'Backups', 'run.sh'))).to.be.false;
        expect(fileAccess.canAccessFile(path.join(dir, 'Backups2', 'db.bak'))).to.be.false;
        expect(fileAccess.canAccessFile(path.join(dir, 'db.bak'))).to.be.false;
        expect(fileAccess.canAccessFolder(path.join(dir, 'Backups', 'sub'))).to.be.true;
        expect(fileAccess.canAccessFolder(dir)).to.be.false;
    });

    it('allows the app folders but not the configs', async () => {
        await fileAccess.load();
        const offlineFile = path.join(mock.userData, 'OfflineFiles', 'id');
        expect(fileAccess.canAccessFile(offlineFile)).to.be.true;
        expect(fileAccess.canAccessFile(path.join(mock.userData, 'PluginFiles', 'p.js'))).to.be
            .true;
        expect(fileAccess.canAccessFile(path.join(mock.userData, 'app-settings.json'))).to.be.false;
        expect(fileAccess.canAccessFile(path.join(mock.userData, 'OfflineFiles2', 'id'))).to.be
            .false;
        await fileAccess.ensureOwnPath(offlineFile);
        let error;
        await fileAccess.ensureOwnPath(path.join(dir, 'db.kdbx')).catch((e) => (error = e));
        expect(error.code).to.eql('EACCES');
    });

    it('asks once and saves the answer', async () => {
        const allowed = path.join(dir, 'allowed.kdbx');
        const denied = path.join(dir, 'denied.kdbx');

        mock.electron.dialog.promptResponse = 0;
        await fileAccess.ensureFileAccess(allowed);
        expect(mock.prompts.length).to.eql(1);
        expect(mock.prompts[0].detail).to.contain(allowed);

        mock.electron.dialog.promptResponse = 1;
        let error;
        await fileAccess.ensureFileAccess(denied).catch((e) => (error = e));
        expect(error.code).to.eql('EACCES');
        await fileAccess.ensureFileAccess(denied).catch((e) => (error = e));
        expect(mock.prompts.length).to.eql(2);

        await fileAccess.ensureFileAccess(denied, { prompt: false }).catch((e) => (error = e));
        expect(mock.prompts.length).to.eql(2);

        await flush();
        const saved = JSON.parse(mock.configs['file-access']);
        expect(saved.files).to.eql([allowed]);
    });

    it('asks once when the same file is requested twice at the same time', async () => {
        mock.electron.dialog.promptResponse = 0;
        const file = path.join(dir, 'db.kdbx');
        await Promise.all([fileAccess.ensureFileAccess(file), fileAccess.ensureFileAccess(file)]);
        expect(mock.prompts.length).to.eql(1);
    });

    it('asks about folders for backups', async () => {
        mock.electron.dialog.promptResponse = 0;
        const backups = path.join(dir, 'Backups');
        await fileAccess.ensureFolderAccess(backups);
        expect(mock.prompts[0].message).to.contain('folder');
        await fileAccess.ensureFileAccess(path.join(backups, 'db.bak'));
        expect(mock.prompts.length).to.eql(1);
    });

    it('migrates files from the list of recent files', async () => {
        mock.configs['file-info'] = JSON.stringify([
            {
                storage: 'file',
                path: path.join(dir, 'local.kdbx'),
                keyFilePath: path.join(dir, 'key.keyx'),
                backup: { storage: 'file', path: path.join(dir, 'Backups', '{name}.{date}.bak') }
            },
            { storage: 'webdav', path: 'https://example.com/db.kdbx' },
            { storage: 'file', path: 'relative.kdbx' }
        ]);
        await fileAccess.load();
        expect(fileAccess.canAccessFile(path.join(dir, 'local.kdbx'))).to.be.true;
        expect(fileAccess.canAccessFile(path.join(dir, 'key.keyx'))).to.be.true;
        expect(fileAccess.canAccessFolder(path.join(dir, 'Backups'))).to.be.true;
        expect(JSON.parse(mock.configs['file-access'])).to.eql({
            files: [path.join(dir, 'local.kdbx'), path.join(dir, 'key.keyx')],
            folders: [path.join(dir, 'Backups')]
        });
    });

    it("doesn't migrate again when grants are saved", async () => {
        mock.configs['file-access'] = JSON.stringify({ files: [], folders: [] });
        mock.configs['file-info'] = JSON.stringify([
            { storage: 'file', path: path.join(dir, 'local.kdbx') }
        ]);
        await fileAccess.load();
        expect(fileAccess.canAccessFile(path.join(dir, 'local.kdbx'))).to.be.false;
    });

    it('keeps saved grants when a file is granted while loading', async () => {
        mock.configs['file-access'] = JSON.stringify({
            files: [path.join(dir, 'saved.kdbx')],
            folders: []
        });
        fileAccess.grantFile(path.join(dir, 'new.kdbx'));
        await fileAccess.load();
        await flush();
        expect(JSON.parse(mock.configs['file-access']).files.sort()).to.eql([
            path.join(dir, 'new.kdbx'),
            path.join(dir, 'saved.kdbx')
        ]);
    });
});
