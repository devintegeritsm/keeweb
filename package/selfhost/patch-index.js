// Adjusts the built index.html for self-hosting: loads config.json and tightens the CSP.
// The CSP hashes cover only inline scripts and styles, so editing these meta tags keeps them valid.

const fs = require('fs');

const file = process.argv[2];
if (!file) {
    throw new Error('Usage: node patch-index.js <path to index.html>');
}

const replacements = [
    // a config set here is trusted, the ?config= url parameter is ignored
    [
        '<meta name="kw-config" content="(no-config)">',
        '<meta name="kw-config" content="config.json">'
    ],
    // nothing uses websockets
    ["connect-src 'self' ws: https:;", "connect-src 'self' https:;"],
    // the favicon service sends entry hostnames to keeweb.info
    ["img-src 'self' data: blob: https://services.keeweb.info/;", "img-src 'self' data: blob:;"],
    // injected html must not be able to change the base url
    ["object-src 'none';", "object-src 'none'; base-uri 'none';"]
];

let html = fs.readFileSync(file, 'utf8');
for (const [from, to] of replacements) {
    const count = html.split(from).length - 1;
    if (count !== 1) {
        throw new Error(`Expected exactly one "${from}" in ${file}, found ${count}`);
    }
    html = html.replace(from, to);
}
fs.writeFileSync(file, html);
