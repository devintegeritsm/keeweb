import EventEmitter from 'events';
import { Logger } from 'util/logger';
import { Launcher } from 'comp/launcher';
import { KeeWebLogo } from 'const/inline-images';
import oauthPageTemplate from 'templates/oauth/complete.hbs';

const DefaultPort = 48149;
const logger = new Logger('storage-oauth-listener');

const StorageOAuthListener = {
    listening: false,
    unsubscribe: null,

    listen(storageName) {
        if (this.listening) {
            this.stop();
        }

        const listener = {};
        Object.keys(EventEmitter.prototype).forEach((key) => {
            listener[key] = EventEmitter.prototype[key];
        });

        logger.info(`Starting OAuth listener on port ${DefaultPort}...`);
        // the server runs in the main process
        const pageHtml = oauthPageTemplate({ logoSrc: KeeWebLogo });
        Launcher.oauthListen(storageName, pageHtml).then(({ error }) => {
            if (error) {
                logger.error('Failed to start OAuth listener', error);
                listener.emit('error', error);
                return;
            }
            this.listening = true;
            this.unsubscribe = Launcher.ipcOn('oauthResult', (url) => {
                this.stop();
                this.handleResult(url, listener);
            });
            listener.emit('ready');
        });

        listener.redirectUri = `http://localhost:${DefaultPort}/oauth-result/${storageName}.html`;
        return listener;
    },

    stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.listening) {
            this.listening = false;
            Launcher.oauthStop();
            logger.info('OAuth listener stopped');
        }
    },

    handleResult(url, listener) {
        url = new URL(url, listener.redirectUri);
        if (url.origin + url.pathname !== listener.redirectUri) {
            logger.info('Skipped result', url, listener.redirectUri);
            return;
        }
        logger.info('OAuth result with code received');
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        listener.emit('result', { state, code });
    }
};

export { StorageOAuthListener };
