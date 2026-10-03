const { expect } = require('chai');
require('./mock-electron');
const { locale, setLocale, getLocaleValues } = require('../scripts/locale');
const { setPermissionHandlers } = require('../scripts/permissions');

describe('locale', () => {
    it('accepts only menu texts and the locale name from the page', () => {
        setLocale({
            locale: 'de-DE',
            sysMenuQuit: 'Beenden',
            sysFileAccessAllow: 'Deny',
            emit: 'x',
            on: 'x',
            sysMenuCopy: 42,
            sysMenuPaste: 'x'.repeat(1000)
        });
        expect(getLocaleValues()).to.eql({ locale: 'de-DE', sysMenuQuit: 'Beenden' });
        expect(locale.sysMenuQuit).to.eql('Beenden');
        expect(locale.sysFileAccessAllow).to.be.undefined;
        expect(locale.emit).to.be.a('function');
        expect(locale.on).to.be.a('function');
    });

    it('ignores values that are not objects', () => {
        setLocale('x');
        setLocale(null);
        expect(getLocaleValues()).to.eql({});
    });
});

describe('permissions', () => {
    it('denies all permission requests and checks', () => {
        const session = {
            setPermissionRequestHandler(handler) {
                this.requestHandler = handler;
            },
            setPermissionCheckHandler(handler) {
                this.checkHandler = handler;
            },
            setDevicePermissionHandler(handler) {
                this.deviceHandler = handler;
            }
        };
        setPermissionHandlers(session);
        for (const permission of ['media', 'clipboard-read', 'notifications', 'openExternal']) {
            let allowed;
            session.requestHandler({}, permission, (result) => (allowed = result), {});
            expect(allowed).to.be.false;
            expect(session.checkHandler({}, permission, 'file://', {})).to.be.false;
        }
        expect(session.deviceHandler({ deviceType: 'usb' })).to.be.false;
    });
});
