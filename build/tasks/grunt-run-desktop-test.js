module.exports = function (grunt) {
    grunt.registerTask('run-desktop-test', 'Runs tests of the desktop main process', function () {
        const done = this.async();
        const Mocha = require('mocha');
        const mocha = new Mocha();
        for (const file of grunt.file.expand('desktop/test/**/*.test.js')) {
            mocha.addFile(file);
        }
        mocha.run((failures) => {
            if (failures) {
                grunt.warn(`Failed ${failures} desktop test${failures > 1 ? 's' : ''}.`);
            }
            done();
        });
    });
};
