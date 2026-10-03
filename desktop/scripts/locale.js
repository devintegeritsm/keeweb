const { EventEmitter } = require('events');

class Locale extends EventEmitter {}

const locale = new Locale();

// the page sends these values, it can set only menu texts: other keys could replace
// the emitter methods, and no other text shown by the main process should come from the page
const AllowedKeyRegex = /^sysMenu[A-Za-z]+$/;
const MaxValueLength = 200;

let localeValues;

function sanitizeLocaleValues(values) {
    const result = {};
    if (!values || typeof values !== 'object') {
        return result;
    }
    for (const [key, value] of Object.entries(values)) {
        if (
            (key === 'locale' || AllowedKeyRegex.test(key)) &&
            typeof value === 'string' &&
            value.length <= MaxValueLength
        ) {
            result[key] = value;
        }
    }
    return result;
}

function setLocale(values) {
    values = sanitizeLocaleValues(values);
    localeValues = values;

    let changed = false;
    for (const [key, value] of Object.entries(values)) {
        if (locale[key] !== value) {
            changed = true;
            locale[key] = value;
        }
    }

    if (changed) {
        locale.emit('changed');
    }
}

function getLocaleValues() {
    return localeValues;
}

module.exports = { locale, setLocale, getLocaleValues };
