const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { handle } = require('../ipc-validation');

// The app UI can run only these programs with the arguments it needs

const AnyNumber = /^\d+$/;
const AnyValue = /^[^-\0][^\0]*$/;
const YkmanCommands = [
    ['-v'],
    ['list'],
    ['config', 'usb', '-e', 'oath', '-f'],
    ['-d', AnyNumber, 'oath', 'accounts', 'code'],
    ['-d', AnyNumber, 'oath', 'accounts', 'code', '--single', AnyValue]
];
const MacAppPath = '/Applications/KeeWeb.app';
const MacInstallerPath = `${MacAppPath}/Contents/Installer/KeeWeb Installer.app/Contents/MacOS/applet`;

handle('ykmanRun', (e, args, { throwOnStdErr } = {}) => {
    if (!isAllowedYkmanCommand(args)) {
        throw new Error('Unsupported ykman command');
    }
    return runProcess(getYkmanPath(), args, { throwOnStdErr: !!throwOnStdErr });
});
handle('appRightsNeedRunInstaller', async () => {
    if (process.platform !== 'darwin') {
        return false;
    }
    const stat = await fs.promises.stat(MacAppPath).catch(() => null);
    return !(stat && stat.uid === 0);
});
handle('appRightsRunInstaller', () => {
    if (process.platform !== 'darwin') {
        throw new Error('Not supported');
    }
    return runProcess(MacInstallerPath, ['--install']);
});

function isAllowedYkmanCommand(args) {
    return (
        Array.isArray(args) &&
        YkmanCommands.some(
            (command) =>
                command.length === args.length &&
                command.every((part, ix) =>
                    part instanceof RegExp
                        ? typeof args[ix] === 'string' && part.test(args[ix])
                        : part === args[ix]
                )
        )
    );
}

function getYkmanPath() {
    if (process.platform === 'darwin') {
        // GUI apps don't get the PATH from the shell profile, where Homebrew adds its folders
        for (const folder of ['/usr/local/bin', '/opt/homebrew/bin']) {
            const ykmanPath = path.join(folder, 'ykman');
            if (fs.existsSync(ykmanPath)) {
                return ykmanPath;
            }
        }
    }
    return 'ykman';
}

function runProcess(cmd, args, { throwOnStdErr } = {}) {
    return new Promise((resolve) => {
        const ps = spawn(cmd, args);
        [ps.stdin, ps.stdout, ps.stderr].forEach((s) => s.setEncoding('utf-8'));
        let stderr = '';
        let stdout = '';
        ps.stderr.on('data', (d) => {
            stderr += d.toString('utf-8');
            if (throwOnStdErr) {
                try {
                    ps.kill();
                } catch {}
            }
        });
        ps.stdout.on('data', (d) => {
            stdout += d.toString('utf-8');
        });
        ps.on('close', (code) => {
            resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
        ps.on('error', (err) => {
            resolve({ err: err.message });
        });
        process.nextTick(() => {
            // it should work without destroy, but a process doesn't get launched
            // xubuntu-desktop 19.04 / xfce
            // see https://github.com/keeweb/keeweb/issues/1234
            ps.stdin.destroy();
        });
    });
}

module.exports = { isAllowedYkmanCommand };
