import * as kdbxweb from 'kdbxweb';
import { phonetic } from 'util/generators/phonetic';

const CharRanges = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnpqrstuvwxyz',
    digits: '123456789',
    special: '!@#$%^&*_+-=,./?;:`"~\'\\',
    brackets: '(){}[]<>',
    high:
        '¡¢£¤¥¦§©ª«¬®¯°±²³´µ¶¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþ',
    ambiguous: 'O0oIl'
};

// pronounceable passwords are split into words, the words are at least this long if possible
const MinWordLength = 3;

const DefaultCharRangesByPattern = {
    'A': CharRanges.upper,
    'a': CharRanges.lower,
    '1': CharRanges.digits,
    '*': CharRanges.special,
    '[': CharRanges.brackets,
    'Ä': CharRanges.high,
    '0': CharRanges.ambiguous
};

function randomInt(max) {
    // rejection sampling, a plain remainder would make small numbers more likely
    const limit = Math.floor(0x100000000 / max) * max;
    for (;;) {
        const bytes = kdbxweb.CryptoEngine.random(4);
        const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
        if (value < limit) {
            return value % max;
        }
    }
}

function randomChar(range) {
    return range[randomInt(range.length)];
}

function randomShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getCount(value) {
    // no count means any number of characters
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const count = Number(value);
    return Number.isInteger(count) && count >= 0 ? count : undefined;
}

function getDigits(opts) {
    return opts.ambiguous ? '0' + CharRanges.digits : CharRanges.digits;
}

function removeChars(chars, removed) {
    return [...chars].filter((ch) => !removed.includes(ch)).join('');
}

function randomPartition(total, parts, minPart) {
    // random sizes that add up to the total, each one at least minPart if possible
    minPart = Math.max(1, Math.min(minPart, Math.floor(total / parts)));
    const sizes = new Array(parts).fill(minPart);
    for (let i = minPart * parts; i < total; i++) {
        sizes[randomInt(parts)]++;
    }
    return sizes;
}

const PasswordGenerator = {
    generate(opts) {
        if (!opts || typeof opts.length !== 'number' || opts.length < 0) {
            return '';
        }
        if (this.isPronounceable(opts)) {
            return this.generatePronounceable(opts);
        }
        if (!opts.pattern && this.hasCounts(opts)) {
            return this.generateWithCounts(opts);
        }
        const ranges = Object.keys(CharRanges)
            .filter((r) => opts[r])
            .map((r) => CharRanges[r]);
        if (opts.include && opts.include.length) {
            ranges.push(opts.include);
        }
        if (!ranges.length) {
            return '';
        }
        const rangesByPatternChar = {
            ...DefaultCharRangesByPattern,
            'I': opts.include || ''
        };
        const pattern = opts.pattern || 'X';

        let countDefaultChars = 0;
        for (let i = 0; i < opts.length; i++) {
            const patternChar = pattern[i % pattern.length];
            if (patternChar === 'X') {
                countDefaultChars++;
            }
        }

        const rangeIxRandomBytes = kdbxweb.CryptoEngine.random(countDefaultChars);
        const rangeCharRandomBytes = kdbxweb.CryptoEngine.random(countDefaultChars);
        const defaultRangeGeneratedChars = [];
        for (let i = 0; i < countDefaultChars; i++) {
            const rangeIx = i < ranges.length ? i : rangeIxRandomBytes[i] % ranges.length;
            const range = ranges[rangeIx];
            const char = range[rangeCharRandomBytes[i] % range.length];
            defaultRangeGeneratedChars.push(char);
        }
        randomShuffle(defaultRangeGeneratedChars);

        const randomBytes = kdbxweb.CryptoEngine.random(opts.length);
        const chars = [];
        for (let i = 0; i < opts.length; i++) {
            const rand = Math.round(Math.random() * 1000) + randomBytes[i];
            const patternChar = pattern[i % pattern.length];
            if (patternChar === 'X') {
                chars.push(defaultRangeGeneratedChars.pop());
            } else {
                const range = rangesByPatternChar[patternChar];
                const char = range ? range[rand % range.length] : patternChar;
                chars.push(char);
            }
        }
        return chars.join('');
    },

    isPronounceable(opts) {
        return !!opts.pronounceable || opts.name === 'Pronounceable';
    },

    hasCounts(opts) {
        return (
            (!!opts.digits && getCount(opts.digitsCount) !== undefined) ||
            (!!opts.include && getCount(opts.includeCount) !== undefined)
        );
    },

    generateWithCounts(opts) {
        const digitsCount = opts.digits ? getCount(opts.digitsCount) : undefined;
        const include = opts.include || '';
        const includeCount = include ? getCount(opts.includeCount) : undefined;
        const digits = getDigits(opts);

        const chars = [];
        for (let i = 0; i < Math.min(digitsCount || 0, opts.length); i++) {
            chars.push(randomChar(digits));
        }
        for (let i = 0, count = includeCount || 0; i < count && chars.length < opts.length; i++) {
            chars.push(randomChar(include));
        }

        // counted characters are not taken from other ranges, so that the counts are exact
        const counted =
            (digitsCount === undefined ? '' : '0' + CharRanges.digits) +
            (includeCount === undefined ? '' : include);
        let ranges = Object.keys(CharRanges)
            .filter((range) => opts[range] && (range !== 'digits' || digitsCount === undefined))
            .map((range) => CharRanges[range]);
        if (include && includeCount === undefined) {
            ranges.push(include);
        }
        ranges = ranges.map((range) => removeChars(range, counted)).filter((range) => range);
        if (!ranges.length) {
            // nothing else is allowed, the counts can't be kept
            ranges = [(digitsCount === undefined ? '' : digits) + (include || '')];
        }
        for (let i = 0; chars.length < opts.length; i++) {
            // each range is used at least once if there's enough space
            const range = ranges[i < ranges.length ? i : randomInt(ranges.length)];
            chars.push(randomChar(range));
        }
        return randomShuffle(chars).join('');
    },

    generatePronounceable(opts) {
        const length = opts.length;
        const include = opts.include || '';
        const defaultCount = Math.max(1, Math.round(length / 10));
        let digitsCount = opts.digits ? getCount(opts.digitsCount) ?? defaultCount : 0;
        let includeCount = include ? getCount(opts.includeCount) ?? defaultCount : 0;
        // there must be letters, and symbols are only placed between them
        digitsCount = Math.max(0, Math.min(digitsCount, length - 1));
        includeCount = Math.max(
            0,
            Math.min(includeCount, Math.floor((length - digitsCount - 1) / 2))
        );
        const lettersCount = length - digitsCount - includeCount;
        if (lettersCount <= 0) {
            return '';
        }

        // symbols and digits separate words, digits can also be at the end
        const separators = [];
        for (let i = 0; i < includeCount; i++) {
            separators.push([randomChar(include)]);
        }
        const digits = getDigits(opts);
        const end = [];
        for (let i = 0; i < digitsCount; i++) {
            const canAddSeparator = (separators.length + 2) * MinWordLength <= lettersCount;
            const place = randomInt(separators.length + (canAddSeparator ? 2 : 1));
            const digit = randomChar(digits);
            if (place < separators.length) {
                separators[place].push(digit);
            } else if (place === separators.length) {
                end.push(digit);
            } else {
                separators.push([digit]);
            }
        }
        randomShuffle(separators);

        // each word is pronounceable by itself
        const wordLengths = randomPartition(lettersCount, separators.length + 1, MinWordLength);
        const words = wordLengths.map((wordLength) => {
            let word = phonetic.generate({ length: wordLength });
            // short words can be cut in the middle of a syllable, leaving only consonants
            for (let i = 0; i < 10 && !/[aeiouy]/.test(word); i++) {
                word = phonetic.generate({ length: wordLength });
            }
            word = [...word];
            if (!opts.ambiguous) {
                // o and l are replaced with letters that sound similar
                for (let ix = 0; ix < word.length; ix++) {
                    if (word[ix] === 'o') {
                        word[ix] = randomChar(removeChars('aeu', [word[ix - 1], word[ix + 1]]));
                    } else if (word[ix] === 'l') {
                        word[ix] = 'r';
                    }
                }
            }
            return word;
        });
        if (opts.upper && !opts.lower) {
            for (const word of words) {
                word.forEach((ch, ix) => {
                    word[ix] = ch === 'i' && !opts.ambiguous ? 'E' : ch.toUpperCase();
                });
            }
        } else if (opts.upper) {
            // a few capital letters at the start of random words, or anywhere if there's one word;
            // not next to each other, and not I that looks like l
            const places =
                words.length > 1
                    ? words.map((word) => [word, 0])
                    : words[0].map((ch, ix) => [words[0], ix]);
            const isLower = (ch) => !ch || ch === ch.toLowerCase();
            let upperCount = Math.min(
                Math.max(1, Math.round(lettersCount / 8)),
                Math.ceil(places.length / 2)
            );
            for (const [word, ix] of randomShuffle(places)) {
                if (
                    upperCount > 0 &&
                    (opts.ambiguous || word[ix] !== 'i') &&
                    isLower(word[ix - 1]) &&
                    isLower(word[ix + 1])
                ) {
                    word[ix] = word[ix].toUpperCase();
                    upperCount--;
                }
            }
        }

        return words
            .map((word, ix) => word.join('') + randomShuffle(separators[ix] || end).join(''))
            .join('');
    },

    deriveOpts(password) {
        const opts = {};
        let length = 0;
        if (password) {
            const charRanges = CharRanges;
            password.forEachChar((ch) => {
                length++;
                ch = String.fromCharCode(ch);
                for (const [range, chars] of Object.entries(charRanges)) {
                    if (chars.indexOf(ch) >= 0) {
                        opts[range] = true;
                    }
                }
            });
        }
        opts.length = length;
        return opts;
    }
};

export { PasswordGenerator, CharRanges };
