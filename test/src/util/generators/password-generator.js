import { expect } from 'chai';
import { PasswordGenerator } from 'util/generators/password-generator';

describe('PasswordGenerator', () => {
    it('should generate a password with digits', () => {
        expect(PasswordGenerator.generate({ length: 10, digits: true })).to.match(/^\d{10}$/);
    });

    it('should generate a password with lowercase letters', () => {
        expect(PasswordGenerator.generate({ length: 10, lower: true })).to.match(/^[a-z]{10}$/);
    });

    it('should generate a password with uppercase letters', () => {
        expect(PasswordGenerator.generate({ length: 10, upper: true })).to.match(/^[A-Z]{10}$/);
    });

    it('should generate a password with brackets', () => {
        expect(PasswordGenerator.generate({ length: 10, brackets: true })).to.match(
            /^[(){}[\]<>]{10}$/
        );
    });

    it('should generate a password with ambiguous characters', () => {
        expect(PasswordGenerator.generate({ length: 10, ambiguous: true })).to.match(
            new RegExp(`^[O0oIl]{10}$`)
        );
    });

    it('should generate a password with custom characters', () => {
        expect(PasswordGenerator.generate({ length: 10, include: '123' })).to.match(/^[123]{10}$/);
    });

    it('should generate a password with special characters', () => {
        expect(PasswordGenerator.generate({ length: 50, special: true })).to.match(
            /^[!-\/:-@[-`~]{50}$/
        );
    });

    it('should generate a password with high ascii characters', () => {
        expect(PasswordGenerator.generate({ length: 100, high: true })).to.match(/^[¡-þ]{100}$/);
    });

    it('should generate a pronounceable password', () => {
        for (let i = 0; i < 1000; i++) {
            expect(PasswordGenerator.generate({ length: 10, name: 'Pronounceable' })).to.match(
                /^[a-zA-Z]{10}$/
            );
        }
    });

    it('should not use Math.random for pronounceable passwords', () => {
        const mathRandom = Math.random;
        Math.random = () => 0.5;
        try {
            const passwords = new Set();
            for (let i = 0; i < 100; i++) {
                passwords.add(
                    PasswordGenerator.generate({ length: 16, name: 'Pronounceable', upper: true })
                );
            }
            expect(passwords.size).to.eql(100);
        } finally {
            Math.random = mathRandom;
        }
    });

    it('should not use ambiguous letters in pronounceable passwords', () => {
        for (let i = 0; i < 200; i++) {
            const password = PasswordGenerator.generate({
                length: 20,
                pronounceable: true,
                upper: true,
                lower: true
            });
            expect(password).to.match(/^[a-zA-Z]{20}$/);
            expect(password).not.to.match(/[O0oIl]/);
            expect(password).to.match(/[A-Z]/);
            expect(password).to.match(/[a-z]/);
        }
    });

    it('should use ambiguous letters in pronounceable passwords if allowed', () => {
        let password = '';
        for (let i = 0; i < 100; i++) {
            password += PasswordGenerator.generate({
                length: 20,
                pronounceable: true,
                lower: true,
                ambiguous: true
            });
        }
        expect(password).to.match(/^[a-z]{2000}$/);
        expect(password).to.match(/o/);
        expect(password).to.match(/l/);
    });

    it('should generate uppercase pronounceable passwords', () => {
        for (let i = 0; i < 100; i++) {
            expect(
                PasswordGenerator.generate({ length: 20, pronounceable: true, upper: true })
            ).to.match(/^[A-HJ-NP-Z]{20}$/);
        }
    });

    it('should add the number of digits and symbols to pronounceable passwords', () => {
        const opts = {
            length: 16,
            pronounceable: true,
            upper: true,
            lower: true,
            digits: true,
            digitsCount: 2,
            include: '-_',
            includeCount: 2
        };
        const digitPositions = new Set();
        const symbolPositions = new Set();
        for (let i = 0; i < 500; i++) {
            const password = PasswordGenerator.generate(opts);
            expect(password).to.match(/^[a-zA-Z][a-zA-Z0-9_-]{14}[a-zA-Z0-9]$/);
            expect(password.replace(/[^0-9]/g, '')).to.have.length(2);
            expect(password.replace(/[^_-]/g, '')).to.have.length(2);
            expect(password).not.to.match(/[_-][0-9]*[_-]/);
            expect(password).not.to.match(/[O0oIl]/);
            for (const word of password.split(/[^a-zA-Z]+/).filter((w) => w)) {
                expect(word).to.have.length.of.at.least(3);
                expect(word).to.match(/[aeiouy]/i);
            }
            for (const [ix, ch] of [...password].entries()) {
                if (/[0-9]/.test(ch)) {
                    digitPositions.add(ix);
                } else if (/[_-]/.test(ch)) {
                    symbolPositions.add(ix);
                }
            }
        }
        expect(digitPositions.size).to.be.above(5);
        expect(symbolPositions.size).to.be.above(5);
    });

    it('should not add digits and symbols to pronounceable passwords if they are disabled', () => {
        for (let i = 0; i < 100; i++) {
            const password = PasswordGenerator.generate({
                length: 16,
                pronounceable: true,
                lower: true,
                digitsCount: 2,
                includeCount: 2
            });
            expect(password).to.match(/^[a-z]{16}$/);
        }
    });

    it('should add some digits and symbols to pronounceable passwords without a count', () => {
        for (let i = 0; i < 100; i++) {
            const password = PasswordGenerator.generate({
                length: 16,
                pronounceable: true,
                lower: true,
                digits: true,
                include: '-'
            });
            expect(password).to.have.length(16);
            expect(password).to.match(/[1-9]/);
            expect(password).to.match(/-/);
        }
    });

    it('should keep letters in short pronounceable passwords with big counts', () => {
        for (let i = 0; i < 100; i++) {
            const password = PasswordGenerator.generate({
                length: 5,
                pronounceable: true,
                lower: true,
                digits: true,
                digitsCount: 10,
                include: '-',
                includeCount: 10
            });
            expect(password).to.match(/^[a-z][a-z0-9-]{4}$/);
        }
        expect(PasswordGenerator.generate({ length: 0, pronounceable: true })).to.eql('');
    });

    it('should generate a password with the number of digits and symbols', () => {
        for (let i = 0; i < 200; i++) {
            const password = PasswordGenerator.generate({
                length: 16,
                upper: true,
                lower: true,
                digits: true,
                digitsCount: 3,
                include: '-_',
                includeCount: 2
            });
            expect(password).to.match(/^[A-Za-z0-9_-]{16}$/);
            expect(password.replace(/[^0-9]/g, '')).to.have.length(3);
            expect(password.replace(/[^_-]/g, '')).to.have.length(2);
            expect(password).to.match(/[A-Z]/);
            expect(password).to.match(/[a-z]/);
        }
    });

    it('should not take counted characters from other ranges', () => {
        for (let i = 0; i < 200; i++) {
            const password = PasswordGenerator.generate({
                length: 30,
                special: true,
                ambiguous: true,
                digits: true,
                digitsCount: 1,
                include: '-_',
                includeCount: 1
            });
            expect(password).to.have.length(30);
            expect(password.replace(/[^0-9]/g, '')).to.have.length(1);
            expect(password.replace(/[^_-]/g, '')).to.have.length(1);
        }
    });

    it('should generate a password without digits if the count is zero', () => {
        for (let i = 0; i < 100; i++) {
            expect(
                PasswordGenerator.generate({
                    length: 16,
                    lower: true,
                    digits: true,
                    digitsCount: 0
                })
            ).to.match(/^[a-z]{16}$/);
        }
    });

    it('should not use counts of disabled ranges', () => {
        for (let i = 0; i < 100; i++) {
            expect(
                PasswordGenerator.generate({ length: 16, lower: true, digitsCount: 3 })
            ).to.match(/^[a-z]{16}$/);
        }
    });

    it('should not use Math.random for passwords with counts', () => {
        const mathRandom = Math.random;
        Math.random = () => 0.5;
        try {
            const passwords = new Set();
            for (let i = 0; i < 100; i++) {
                passwords.add(
                    PasswordGenerator.generate({
                        length: 16,
                        lower: true,
                        digits: true,
                        digitsCount: 2
                    })
                );
            }
            expect(passwords.size).to.eql(100);
        } finally {
            Math.random = mathRandom;
        }
    });

    it('should generate a password with pattern', () => {
        expect(
            PasswordGenerator.generate({
                length: 60,
                pattern: 'Aa1XI-',
                include: '@#',
                digits: true,
                upper: true
            })
        ).to.match(/^([A-Z][a-z][0-9][0-9A-Z@#][@#]-){10}$/);
    });

    it('should include all groups of characters at least once', () => {
        for (let i = 0; i < 10; i++) {
            const password = PasswordGenerator.generate({
                length: 6,
                upper: true,
                lower: true,
                digits: true,
                brackets: true,
                special: true,
                ambiguous: true
            });
            expect(password).to.match(/[A-Z]/);
            expect(password).to.match(/[a-z]/);
            expect(password).to.match(/[0-9]/);
            expect(password).to.match(/[(){}[\]<>]/);
            expect(password).to.match(/[!-\/:-@[-`~]/);
            expect(password).to.match(/[O0oIl]/);
        }
    });
});
