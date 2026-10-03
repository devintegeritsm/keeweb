const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const mock = require('./mock-electron');

// the preload lists the channels the page can use, they must match the handlers and the app code

const root = path.join(__dirname, '..', '..');
const preloadSource = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');

function preloadChannels(name) {
    const list = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(preloadSource);
    return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function sourceFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...sourceFiles(entryPath));
        } else if (entry.name.endsWith('.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

function usedChannels(dir, regex) {
    const channels = new Set();
    for (const file of sourceFiles(dir)) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(regex)) {
            channels.add(match[1]);
        }
    }
    return [...channels].sort();
}

// channels the preload itself uses, not exposed to the page
const PreloadOwnChannels = ['launcherGetInfo', 'fsGrantUserFile'];

describe('IPC channels', () => {
    before(() => {
        require('../scripts/ipc').setupIpcHandlers();
    });

    const invokeChannels = preloadChannels('InvokeChannels');
    const sendChannels = preloadChannels('SendChannels');
    const sendSyncChannels = preloadChannels('SendSyncChannels');
    const eventChannels = preloadChannels('EventChannels');

    it('has a handler for each channel the page can invoke', () => {
        for (const channel of invokeChannels) {
            expect(mock.handlers, channel).to.have.property(channel);
        }
        for (const channel of [...sendChannels, ...sendSyncChannels, ...PreloadOwnChannels]) {
            expect(mock.listeners, channel).to.have.property(channel);
        }
    });

    it('exposes each handler to the page', () => {
        const handlers = Object.keys(mock.handlers).filter((ch) => ch !== 'testChannel');
        expect(handlers.sort()).to.eql([...invokeChannels].sort());
        expect(Object.keys(mock.listeners).sort()).to.eql(
            [...sendChannels, ...sendSyncChannels, ...PreloadOwnChannels].sort()
        );
    });

    it('exposes the channels the app uses', () => {
        const appDir = path.join(root, 'app', 'scripts');
        const invoked = usedChannels(
            appDir,
            /\b(?:ipcInvoke|invoke|fsCall|updaterCall)\(\s*'([A-Za-z-]+)'/g
        );
        const sent = usedChannels(appDir, /\b(?:ipcSend|send)\(\s*'([A-Za-z-]+)'/g);
        const subscribed = usedChannels(appDir, /\b(?:ipcOn|desktop\.on)\(\s*'([A-Za-z-]+)'/g);
        expect(invoked.length).to.be.above(10);
        for (const channel of invoked) {
            expect(invokeChannels, channel).to.include(channel);
        }
        for (const channel of sent) {
            expect(sendChannels, channel).to.include(channel);
        }
        for (const channel of subscribed) {
            expect(eventChannels, channel).to.include(channel);
        }
    });

    it('lets the page receive the events the main process sends', () => {
        const desktopDir = path.join(root, 'desktop');
        const sent = usedChannels(desktopDir, /\.send\(\s*'([A-Za-z-]+)'/g).concat(
            usedChannels(desktopDir, /\bcallback\(\s*'(nativeModule[A-Za-z]+)'/g)
        );
        for (const channel of sent) {
            if (channel === 'nativeModuleCall' || channel === 'testChannel') {
                continue;
            }
            expect(eventChannels, channel).to.include(channel);
        }
    });
});
