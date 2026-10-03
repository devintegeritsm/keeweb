const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// replaced with the keys from app/resources during the build
const BuildPublicKeys = ['@@PUBLIC_KEY_CONTENT', '@@PUBLIC_KEY_NEW_CONTENT'];

function getPublicKeys() {
    if (!BuildPublicKeys[0].startsWith('@@')) {
        return BuildPublicKeys;
    }
    const resources = path.join(__dirname, '../../app/resources');
    return ['public-key.pem', 'public-key-new.pem'].map((name) =>
        fs.readFileSync(path.join(resources, name), 'utf8')
    );
}

async function verifyFileSignature(filePath, signature, publicKeys = getPublicKeys()) {
    for (const publicKey of publicKeys) {
        const verifier = crypto.createVerify('RSA-SHA256');
        for await (const chunk of fs.createReadStream(filePath)) {
            verifier.update(chunk);
        }
        if (verifier.verify(publicKey, signature)) {
            return true;
        }
    }
    return false;
}

module.exports = { verifyFileSignature };
