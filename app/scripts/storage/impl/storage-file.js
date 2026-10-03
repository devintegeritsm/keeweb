import * as kdbxweb from 'kdbxweb';
import { Launcher } from 'comp/launcher';
import { StorageBase } from 'storage/storage-base';

const fileWatchers = {};

class StorageFile extends StorageBase {
    name = 'file';
    icon = 'hdd';
    enabled = !!Launcher;
    system = true;
    backup = true;

    load(path, opts, callback) {
        this.logger.debug('Load', path);
        const ts = this.logger.ts();

        const onError = (e) => {
            this.logger.error('Error reading local file', path, e);
            if (callback) {
                callback(e, null);
            }
        };

        Launcher.readFile(path, undefined, (data, err) => {
            if (err) {
                return onError(err);
            }
            Launcher.statFile(path, (stat, err) => {
                if (err) {
                    return onError(err);
                }
                const rev = stat.mtime.getTime().toString();
                this.logger.debug('Loaded', path, rev, this.logger.ts(ts));
                if (callback) {
                    callback(null, kdbxweb.ByteUtils.arrayToBuffer(data), { rev });
                }
            });
        });
    }

    stat(path, opts, callback) {
        this.logger.debug('Stat', path);
        const ts = this.logger.ts();

        Launcher.statFile(path, (stat, err) => {
            if (err) {
                this.logger.error('Error stat local file', path, err);
                if (err.code === 'ENOENT') {
                    err.notFound = true;
                }
                return callback && callback(err, null);
            }
            this.logger.debug('Stat done', path, this.logger.ts(ts));
            if (callback) {
                const fileRev = stat.mtime.getTime().toString();
                callback(null, { rev: fileRev });
            }
        });
    }

    save(path, opts, data, callback, rev) {
        this.logger.debug('Save', path, rev);
        const ts = this.logger.ts();

        const onError = (e) => {
            if (Object.prototype.hasOwnProperty.call(e, 'code') && e.code === 'EISDIR') {
                e.isDir = true;
            }
            this.logger.error('Error writing local file', path, e);
            if (callback) {
                callback(e);
            }
        };

        const write = () => {
            Launcher.writeFile(path, data, (err) => {
                if (err) {
                    return onError(err);
                }
                Launcher.statFile(path, (stat, err) => {
                    if (err) {
                        return onError(err);
                    }
                    const newRev = stat.mtime.getTime().toString();
                    this.logger.debug('Saved', path, this.logger.ts(ts));
                    if (callback) {
                        callback(undefined, { rev: newRev });
                    }
                });
            });
        };

        if (rev) {
            Launcher.statFile(path, (stat, err) => {
                if (err) {
                    return write();
                }
                const fileRev = stat.mtime.getTime().toString();
                if (fileRev !== rev) {
                    this.logger.debug('Save mtime differs', rev, fileRev);
                    return callback && callback({ revConflict: true }, { rev: fileRev });
                }
                write();
            });
        } else {
            write();
        }
    }

    mkdir(path, callback) {
        this.logger.debug('Make dir', path);
        const ts = this.logger.ts();

        Launcher.mkdir(path, (err) => {
            if (err) {
                this.logger.error('Error making local dir', path, err);
                if (callback) {
                    callback('Error making local dir');
                }
            } else {
                this.logger.debug('Made dir', path, this.logger.ts(ts));
                if (callback) {
                    callback();
                }
            }
        });
    }

    watch(path, callback) {
        this.unwatch(path);
        this.logger.debug('Watch file', path);
        fileWatchers[path] = Launcher.watchFile(path, () => {
            this.logger.debug('File changed', path);
            callback();
        });
    }

    unwatch(path) {
        if (fileWatchers[path]) {
            this.logger.debug('Stop watching file', path);
            fileWatchers[path]();
            delete fileWatchers[path];
        }
    }
}

export { StorageFile };
