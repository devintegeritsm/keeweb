import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import { ModalView } from 'views/modal-view';

const logger = new Logger('alerts');

const Alerts = {
    alertDisplayed: false,
    views: new Set(),

    buttons: {
        ok: {
            result: 'yes',
            get title() {
                return Locale.alertOk;
            }
        },
        yes: {
            result: 'yes',
            get title() {
                return Locale.alertYes;
            }
        },
        allow: {
            result: 'yes',
            get title() {
                return Locale.alertAllow;
            }
        },
        no: {
            result: '',
            get title() {
                return Locale.alertNo;
            }
        },
        cancel: {
            result: '',
            get title() {
                return Locale.alertCancel;
            }
        },
        deny: {
            result: '',
            get title() {
                return Locale.alertDeny;
            }
        }
    },

    alert(config) {
        if (config.skipIfAlertDisplayed && Alerts.alertDisplayed) {
            return null;
        }
        const view = new ModalView(config);
        Alerts.views.add(view);
        Alerts.alertDisplayed = true;
        view.render();
        view.once('result', (res, check) => {
            if (res && config.success) {
                config.success(res, check);
            }
            if (!res && config.cancel) {
                config.cancel();
            }
            if (config.complete) {
                config.complete(res, check);
            }
        });
        view.on('will-close', () => {
            Alerts.views.delete(view);
            Alerts.alertDisplayed = Alerts.views.size > 0;
        });
        return view;
    },

    closeAll() {
        // closing an alert calls its callbacks, which can show another one
        for (let attempt = 0; attempt < 10 && Alerts.views.size; attempt++) {
            for (const view of [...Alerts.views]) {
                try {
                    view.closeImmediate();
                } catch (e) {
                    logger.error('Error closing alert', e);
                    Alerts.views.delete(view);
                    if (!view.removed) {
                        view.unbindEvents();
                        view.remove();
                    }
                }
            }
        }
        Alerts.alertDisplayed = Alerts.views.size > 0;
    },

    notImplemented() {
        this.alert({
            header: Locale.notImplemented,
            body: '',
            icon: 'exclamation-triangle',
            buttons: [this.buttons.ok],
            esc: '',
            click: '',
            enter: ''
        });
    },

    info(config) {
        this.alert({
            header: '',
            body: '',
            icon: 'info',
            buttons: [this.buttons.ok],
            esc: '',
            click: '',
            enter: '',
            ...config
        });
    },

    error(config) {
        this.alert({
            header: '',
            body: '',
            icon: 'exclamation-circle',
            buttons: [this.buttons.ok],
            esc: '',
            click: '',
            enter: '',
            ...config
        });
    },

    yesno(config) {
        this.alert({
            header: '',
            body: '',
            icon: 'question',
            buttons: [this.buttons.yes, this.buttons.no],
            esc: '',
            click: '',
            enter: 'yes',
            ...config
        });
    }
};

export { Alerts };
