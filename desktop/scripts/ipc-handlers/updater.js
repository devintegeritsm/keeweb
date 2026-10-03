const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { handle } = require('../ipc-validation');
const { Logger } = require('../logger');
const { verifyFileSignature } = require('../update-signature');

// Updates are downloaded, checked and started here, the app UI can only ask for a version

const UpdateJsonUrl = 'https://app.keeweb.info/update.json';
const UpdateBaseUrl = 'https://github.com/keeweb/keeweb/releases/download/v{ver}/';
const SignaturesFileName = 'Verify.sign.sha256';
const ValidVersionRegex = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;
const RequestTimeout = 5 * 60 * 1000;

const logger = new Logger('updater');

handleUpdater('updaterCheck', async () => {
    const data = await download(UpdateJsonUrl);
    return JSON.parse(data.toString('utf8'));
});
handleUpdater('updaterDownload', async (version) => {
    const asset = getAsset(version);
    const tempPath = getTempPath();
    await fs.promises.mkdir(tempPath, { recursive: true });
    removeOtherVersions(tempPath, asset.name);

    if ((await verifyAsset(asset).catch(() => false)) === true) {
        logger.info('Update is already downloaded', asset.name);
        return true;
    }
    logger.info('Downloading update', asset.name);
    await downloadToFile(asset.url, asset.filePath);
    logger.info('Downloading update signatures');
    await downloadToFile(asset.signaturesUrl, asset.signaturesFilePath);
    if (!(await verifyAsset(asset))) {
        await fs.promises.unlink(asset.filePath).catch(() => {});
        await fs.promises.unlink(asset.signaturesFilePath).catch(() => {});
        throw new Error('Invalid update signature');
    }
    logger.info('Update is ready', asset.name);
    return true;
});
handleUpdater('updaterInstall', async (version) => {
    const asset = getAsset(version);
    if (!(await verifyAsset(asset))) {
        throw new Error('Invalid update signature');
    }
    app.restartAndUpdate(asset.filePath);
    return true;
});

function handleUpdater(channel, listener) {
    handle(channel, async (e, ...args) => {
        try {
            return { result: await listener(...args) };
        } catch (err) {
            logger.error(`${channel} error`, err.message);
            return { error: err.message };
        }
    });
}

function getTempPath() {
    return path.join(app.getPath('temp'), 'KeeWeb');
}

function getAssetName(version, platform = process.platform, arch = process.arch) {
    switch (platform) {
        case 'win32':
            if (['x64', 'ia32', 'arm64'].includes(arch)) {
                return `KeeWeb-${version}.win.${arch}.exe`;
            }
            break;
        case 'darwin':
            if (['x64', 'arm64'].includes(arch)) {
                return `KeeWeb-${version}.mac.${arch}.dmg`;
            }
            break;
    }
    return undefined;
}

function getAsset(version) {
    // the version is used in file paths and installer arguments
    if (typeof version !== 'string' || !ValidVersionRegex.test(version)) {
        throw new Error('Invalid version');
    }
    const name = getAssetName(version);
    if (!name) {
        throw new Error(`No updates for ${process.platform} ${process.arch}`);
    }
    const baseUrl = UpdateBaseUrl.replace('{ver}', version);
    const filePath = path.join(getTempPath(), name);
    return {
        name,
        url: baseUrl + name,
        filePath,
        signaturesUrl: baseUrl + SignaturesFileName,
        signaturesFilePath: filePath + '.sign'
    };
}

async function verifyAsset(asset) {
    const signatures = await fs.promises.readFile(asset.signaturesFilePath, 'utf8');
    const signatureLine = signatures
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.endsWith(asset.name));
    if (!signatureLine) {
        throw new Error('Asset signature not found');
    }
    const signature = Buffer.from(signatureLine.split(' ')[0], 'hex');
    const valid = await verifyFileSignature(asset.filePath, signature);
    logger.info(`Update asset signature is ${valid ? 'valid' : 'invalid'}`);
    return valid;
}

function removeOtherVersions(tempPath, assetName) {
    const pattern = assetName.replace(/\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?/, '');
    for (const fileName of fs.readdirSync(tempPath)) {
        const isOtherVersion =
            fileName !== assetName &&
            fileName !== assetName + '.sign' &&
            fileName.replace(/\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?/, '').startsWith(pattern);
        if (isOtherVersion) {
            fs.unlink(path.join(tempPath, fileName), () => {});
        }
    }
}

function request(url, onResponse) {
    return new Promise((resolve, reject) => {
        const req = net.request({ url, redirect: 'follow' });
        const timeout = setTimeout(() => {
            req.abort();
            reject(new Error('Timeout'));
        }, RequestTimeout);
        req.on('response', (res) => {
            if (res.statusCode !== 200) {
                clearTimeout(timeout);
                reject(new Error(`HTTP status ${res.statusCode}`));
                return;
            }
            onResponse(res).then(
                (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                (err) => {
                    clearTimeout(timeout);
                    reject(err);
                }
            );
        });
        req.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        req.end();
    });
}

function download(url) {
    logger.info('GET', url);
    return request(
        url,
        (res) =>
            new Promise((resolve, reject) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            })
    );
}

function downloadToFile(url, filePath) {
    logger.info('GET', url);
    const partPath = filePath + '.part';
    return request(
        url,
        (res) =>
            new Promise((resolve, reject) => {
                const file = fs.createWriteStream(partPath);
                res.on('data', (chunk) => file.write(chunk));
                res.on('end', () => file.end());
                res.on('error', (err) => file.destroy(err));
                file.on('finish', () => {
                    fs.promises.rename(partPath, filePath).then(resolve, reject);
                });
                file.on('error', (err) => {
                    fs.unlink(partPath, () => {});
                    reject(err);
                });
            })
    );
}

module.exports = { getAsset, getAssetName };
