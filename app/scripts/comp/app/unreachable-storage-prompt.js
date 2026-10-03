import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';

// Asks what to do if a server can't be reached, for example if it's available only through a VPN:
// there's time to connect and try again before a copy saved on this device is used

const UnreachableStoragePrompt = {
    askToRetryOpen(fileName) {
        return this.ask({
            body: Locale.storageUnreachableOpenBody.replace('{}', fileName),
            localTitle: Locale.storageUnreachableOpenLocal
        });
    },

    askToRetrySave(fileName, { skipIfAlertDisplayed } = {}) {
        return this.ask({
            body: Locale.storageUnreachableSaveBody.replace('{}', fileName),
            localTitle: Locale.storageUnreachableSaveLater,
            skipIfAlertDisplayed
        });
    },

    isUserEditing() {
        // a dialog shown in the middle of typing would take the focus and the rest of the text
        const el = document.activeElement;
        return (
            !!el &&
            (el.matches('input:not([type=checkbox]):not([type=radio]), textarea') ||
                el.isContentEditable)
        );
    },

    // resolves to 'retry' or 'local', or null if the question wasn't asked or the dialog was closed,
    // for example by auto-lock
    ask({ body, localTitle, skipIfAlertDisplayed }) {
        return new Promise((resolve) => {
            const alert = Alerts.alert({
                icon: 'plug',
                header: Locale.storageUnreachableHeader,
                body,
                buttons: [
                    { result: 'retry', title: Locale.storageUnreachableRetry },
                    { result: 'local', title: localTitle, silent: true }
                ],
                esc: 'local',
                enter: 'retry',
                skipIfAlertDisplayed,
                complete: (res) => resolve(res === 'retry' || res === 'local' ? res : null)
            });
            if (!alert) {
                resolve(null);
            }
        });
    }
};

export { UnreachableStoragePrompt };
