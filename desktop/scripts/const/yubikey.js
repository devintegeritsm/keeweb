// YubiKey support is switched off, set this to true to bring it back,
// together with supportsYubiKey in app/scripts/util/features.js
const YubiKeySupported = false;

function checkYubiKeySupported() {
    if (!YubiKeySupported) {
        throw new Error('YubiKey support is switched off');
    }
}

module.exports = { YubiKeySupported, checkYubiKeySupported };
