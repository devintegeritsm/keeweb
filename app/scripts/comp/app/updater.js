import { Events } from 'framework/events';
import { RuntimeInfo } from 'const/runtime-info';
import { Launcher } from 'comp/launcher';
import { AppSettingsModel } from 'models/app-settings-model';
import { UpdateModel } from 'models/update-model';
import { SemVer } from 'util/data/semver';
import { Logger } from 'util/logger';

const logger = new Logger('updater');

const ValidVersionRegex = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;

const Updater = {
    UpdateInterval: 1000 * 60 * 60 * 24,
    MinUpdateTimeout: 500,
    MinUpdateSize: 10000,
    nextCheckTimeout: null,
    updateCheckDate: new Date(0),
    enabled: Launcher?.updaterEnabled(),

    getAutoUpdateType() {
        if (!this.enabled) {
            return false;
        }
        let autoUpdate = AppSettingsModel.autoUpdate;
        if (autoUpdate && autoUpdate === true) {
            autoUpdate = 'install';
        }
        return autoUpdate;
    },

    updateInProgress() {
        return (
            UpdateModel.status === 'checking' ||
            ['downloading', 'extracting', 'updating'].indexOf(UpdateModel.updateStatus) >= 0
        );
    },

    init() {
        this.scheduleNextCheck();
        if (!Launcher && navigator.serviceWorker && !RuntimeInfo.beta && !RuntimeInfo.devMode) {
            navigator.serviceWorker
                .register('service-worker.js')
                .then((reg) => {
                    logger.info('Service worker registered');
                    reg.addEventListener('updatefound', () => {
                        if (reg.active) {
                            logger.info('Service worker found an update');
                            UpdateModel.set({ updateStatus: 'ready' });
                        }
                    });
                })
                .catch((e) => {
                    logger.error('Failed to register a service worker', e);
                });
        }
    },

    scheduleNextCheck() {
        if (this.nextCheckTimeout) {
            clearTimeout(this.nextCheckTimeout);
            this.nextCheckTimeout = null;
        }
        if (!this.getAutoUpdateType()) {
            return;
        }
        let timeDiff = this.MinUpdateTimeout;
        const lastCheckDate = UpdateModel.lastCheckDate;
        if (lastCheckDate) {
            timeDiff = Math.min(
                Math.max(this.UpdateInterval + (lastCheckDate - new Date()), this.MinUpdateTimeout),
                this.UpdateInterval
            );
        }
        this.nextCheckTimeout = setTimeout(this.check.bind(this), timeDiff);
        logger.info('Next update check will happen in ' + Math.round(timeDiff / 1000) + 's');
    },

    check(startedByUser) {
        if (!this.enabled || this.updateInProgress()) {
            return;
        }
        UpdateModel.set({ status: 'checking' });
        if (!startedByUser) {
            // additional protection from broken program logic, to ensure that auto-checks are not performed more than once an hour
            const diffMs = new Date() - this.updateCheckDate;
            if (isNaN(diffMs) || diffMs < 1000 * 60 * 60) {
                logger.error(
                    'Prevented update check; last check was performed at ' + this.updateCheckDate
                );
                this.scheduleNextCheck();
                return;
            }
            this.updateCheckDate = new Date();
        }
        logger.info('Checking for update...');
        // the main process downloads and verifies updates
        Launcher.checkForUpdate().then(
            (updateJson) => {
                const dt = new Date();
                logger.info('Update check: ' + (updateJson.version || 'unknown'));
                if (!updateJson.version || !ValidVersionRegex.test(updateJson.version)) {
                    // the version is used in file paths and installer arguments
                    const errMsg = updateJson.version
                        ? 'Invalid version info'
                        : 'No version info found';
                    UpdateModel.set({
                        status: 'error',
                        lastCheckDate: dt,
                        lastCheckError: errMsg
                    });
                    UpdateModel.save();
                    this.scheduleNextCheck();
                    return;
                }
                const prevLastVersion = UpdateModel.lastVersion;
                UpdateModel.set({
                    status: 'ok',
                    lastCheckDate: dt,
                    lastSuccessCheckDate: dt,
                    lastVersionReleaseDate: new Date(updateJson.date),
                    lastVersion: updateJson.version,
                    lastCheckError: null,
                    lastCheckUpdMin: updateJson.minVersion || null
                });
                UpdateModel.save();
                this.scheduleNextCheck();
                if (!this.canAutoUpdate()) {
                    return;
                }
                if (
                    prevLastVersion === UpdateModel.lastVersion &&
                    UpdateModel.updateStatus === 'ready'
                ) {
                    logger.info('Waiting for the user to apply downloaded update');
                    return;
                }
                if (!startedByUser && this.getAutoUpdateType() === 'install') {
                    this.update(startedByUser);
                } else if (
                    SemVer.compareVersions(UpdateModel.lastVersion, RuntimeInfo.version) > 0
                ) {
                    UpdateModel.set({ updateStatus: 'found' });
                }
            },
            (e) => {
                logger.error('Update check error', e);
                UpdateModel.set({
                    status: 'error',
                    lastCheckDate: new Date(),
                    lastCheckError: 'Error checking last version'
                });
                UpdateModel.save();
                this.scheduleNextCheck();
            }
        );
    },

    canAutoUpdate() {
        const minLauncherVersion = UpdateModel.lastCheckUpdMin;
        if (minLauncherVersion) {
            const cmp = SemVer.compareVersions(RuntimeInfo.version, minLauncherVersion);
            if (cmp < 0) {
                UpdateModel.set({ updateStatus: 'ready', updateManual: true });
                return false;
            }
        }
        return true;
    },

    update(startedByUser, successCallback) {
        const ver = UpdateModel.lastVersion;
        if (!this.enabled) {
            logger.info('Updater is disabled');
            return;
        }
        if (SemVer.compareVersions(RuntimeInfo.version, ver) >= 0) {
            logger.info('You are using the latest version');
            return;
        }
        UpdateModel.set({ updateStatus: 'downloading', updateError: null });
        logger.info('Downloading update', ver);
        Launcher.downloadUpdate(ver).then(
            () => {
                logger.info('Update is ready', ver);
                UpdateModel.set({ updateStatus: 'ready', updateError: null });
                if (!startedByUser) {
                    Events.emit('update-app');
                }
                if (typeof successCallback === 'function') {
                    successCallback();
                }
            },
            (e) => {
                logger.error('Error downloading update', e);
                UpdateModel.set({
                    updateStatus: 'error',
                    updateError: e === 'Invalid update signature' ? e : 'Error downloading update'
                });
            }
        );
    },

    installAndRestart() {
        if (!Launcher) {
            return;
        }
        Launcher.requestRestartAndUpdate(UpdateModel.lastVersion);
    }
};

export { Updater };
