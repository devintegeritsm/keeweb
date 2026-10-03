module.exports = function (grunt) {
    grunt.registerMultiTask('electron-patch', 'Sets Electron fuses', function () {
        const done = this.async();
        const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
        const isDarwinArm64 = this.target === 'darwin-arm64';

        (async () => {
            if (!this.files.length || this.files.some(({ src }) => !src.length)) {
                throw new Error(`Electron executable not found: ${JSON.stringify(this.data)}`);
            }
            for (const { src } of this.files) {
                for (const path of src) {
                    grunt.log.writeln(`Setting fuses in ${path}...`);
                    await flipFuses(path, {
                        version: FuseVersion.V1,
                        // modifying the binary breaks its ad-hoc signature, without which it can't start
                        resetAdHocDarwinSignature: isDarwinArm64,
                        // ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect could run code inside the app
                        [FuseV1Options.RunAsNode]: false,
                        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
                        [FuseV1Options.EnableNodeCliInspectArguments]: false,
                        [FuseV1Options.OnlyLoadAppFromAsar]: true
                    });
                }
            }
        })().then(done, (e) => {
            grunt.fail.fatal(e);
            done(false);
        });
    });
};
