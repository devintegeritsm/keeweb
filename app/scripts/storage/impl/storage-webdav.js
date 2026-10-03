import * as kdbxweb from 'kdbxweb';
import { StorageBase } from 'storage/storage-base';
import { Locale } from 'util/locale';
import { Timeouts } from 'const/timeouts';

// ':' is not a base64 character, so this can't be confused with a plain btoa result
const Utf8Base64Prefix = 'utf8:';

class StorageWebDav extends StorageBase {
    name = 'webdav';
    icon = 'server';
    enabled = true;
    uipos = 10;

    // origins of servers that rejected If-Match with their own current etag
    _ifMatchUnsupported = new Set();

    needShowOpenConfig() {
        return true;
    }

    getOpenConfig() {
        return {
            fields: [
                {
                    id: 'path',
                    title: 'openUrl',
                    desc: 'openUrlDesc',
                    type: 'text',
                    required: true,
                    pattern: '^https://.+'
                },
                {
                    id: 'user',
                    title: 'openUser',
                    desc: 'openUserDesc',
                    placeholder: 'openUserPlaceholder',
                    type: 'text'
                },
                {
                    id: 'password',
                    title: 'openPass',
                    desc: 'openPassDesc',
                    placeholder: 'openPassPlaceholder',
                    type: 'password'
                }
            ]
        };
    }

    getSettingsConfig() {
        return {
            fields: [
                {
                    id: 'webdavSaveMethod',
                    title: 'webdavSaveMethod',
                    type: 'select',
                    value: this.appSettings.webdavSaveMethod || 'default',
                    options: { default: 'webdavSaveMove', put: 'webdavSavePut' }
                },
                {
                    id: 'webdavStatReload',
                    title: 'webdavStatReload',
                    type: 'checkbox',
                    value: !!this.appSettings.webdavStatReload
                }
            ]
        };
    }

    applySetting(key, value) {
        this.appSettings[key] = value;
    }

    isUnreachableError(err) {
        // no network, or the server is in a network that isn't connected yet, like a VPN
        return err === 'network error' || err === 'timeout';
    }

    load(path, opts, callback) {
        this._request(
            {
                op: 'Load',
                method: 'GET',
                path,
                user: opts ? opts.user : null,
                password: opts ? opts.password : null,
                nostat: this.appSettings.webdavStatReload
            },
            callback
                ? (err, xhr, stat) => {
                      if (this.appSettings.webdavStatReload) {
                          this._calcStatByContent(xhr).then((stat) =>
                              callback(err, xhr.response, stat)
                          );
                      } else {
                          callback(err, xhr.response, stat);
                      }
                  }
                : null
        );
    }

    stat(path, opts, callback) {
        this._statRequest(
            path,
            opts,
            'Stat',
            callback ? (err, xhr, stat) => callback(err, stat) : null
        );
    }

    _statRequest(path, opts, op, callback) {
        if (this.appSettings.webdavStatReload) {
            this._request(
                {
                    op,
                    method: 'GET',
                    path,
                    user: opts ? opts.user : null,
                    password: opts ? opts.password : null,
                    nostat: true
                },
                callback
                    ? (err, xhr) => {
                          this._calcStatByContent(xhr).then((stat) => callback(err, xhr, stat));
                      }
                    : null
            );
        } else {
            this._request(
                {
                    op,
                    method: 'HEAD',
                    path,
                    user: opts ? opts.user : null,
                    password: opts ? opts.password : null,
                    timeout: Timeouts.StorageStat
                },
                callback
                    ? (err, xhr, stat) => {
                          callback(err, xhr, stat);
                      }
                    : null
            );
        }
    }

    save(path, opts, data, callback, rev) {
        const cb = function (err, xhr, stat) {
            if (callback) {
                callback(err, stat);
                callback = null;
            }
        };
        const tmpPath = path.replace(/[^\/]+$/, (m) => '.' + m) + '.' + Date.now();
        const saveOpts = {
            path,
            user: opts ? opts.user : null,
            password: opts ? opts.password : null
        };
        this._statRequest(path, opts, 'Save:stat', (err, xhr, stat) => {
            let useTmpPath = this.appSettings.webdavSaveMethod !== 'put';
            let etag = null;
            if (err) {
                if (!err.notFound) {
                    return cb(err);
                } else {
                    this.logger.debug('Save: not found, creating');
                    useTmpPath = false;
                }
            } else if (stat.rev !== rev) {
                this.logger.debug('Save error', path, 'rev conflict', stat.rev, rev);
                return cb({ revConflict: true }, xhr, stat);
            } else {
                etag = stat.etag;
            }
            if (useTmpPath) {
                this._request(
                    {
                        ...saveOpts,
                        op: 'Save:put',
                        method: 'PUT',
                        path: tmpPath,
                        data,
                        nostat: true
                    },
                    (err) => {
                        if (err) {
                            return cb(err);
                        }
                        this._statRequest(path, opts, 'Save:stat', (err, xhr, stat) => {
                            if (err) {
                                this._request({
                                    ...saveOpts,
                                    op: 'Save:delete',
                                    method: 'DELETE',
                                    path: tmpPath
                                });
                                return cb(err, xhr, stat);
                            }
                            // MOVE can't be made conditional on the destination etag portably,
                            // so check again after the upload, the etag also catches changes
                            // made within the same second, which Last-Modified can't show
                            if (stat.rev !== rev || (etag && stat.etag && stat.etag !== etag)) {
                                this.logger.debug(
                                    'Save error',
                                    path,
                                    'rev conflict',
                                    stat.rev,
                                    rev,
                                    stat.etag,
                                    etag
                                );
                                this._request({
                                    ...saveOpts,
                                    op: 'Save:delete',
                                    method: 'DELETE',
                                    path: tmpPath
                                });
                                return cb({ revConflict: true }, xhr, stat);
                            }
                            let movePath = path;
                            if (movePath.indexOf('://') < 0) {
                                if (movePath.indexOf('/') === 0) {
                                    movePath = location.protocol + '//' + location.host + movePath;
                                } else {
                                    movePath = location.href
                                        .replace(/\?(.*)/, '')
                                        .replace(/[^/]*$/, movePath);
                                }
                            }
                            // keep existing escape sequences to prevent double encoding, see #1729
                            const encodedMovePath = movePath
                                .split(/(%[0-9A-Fa-f]{2})/)
                                .map((part, ix) => (ix % 2 ? part : encodeURI(part)))
                                .join('');
                            this._request(
                                {
                                    ...saveOpts,
                                    op: 'Save:move',
                                    method: 'MOVE',
                                    path: tmpPath,
                                    nostat: true,
                                    headers: {
                                        Destination: encodedMovePath,
                                        'Overwrite': 'T'
                                    }
                                },
                                (err) => {
                                    if (err) {
                                        return cb(err);
                                    }
                                    this._statRequest(path, opts, 'Save:stat', (err, xhr, stat) => {
                                        cb(err, xhr, stat);
                                    });
                                }
                            );
                        });
                    }
                );
            } else {
                this._putIfMatch(saveOpts, opts, data, rev, etag, (err) => {
                    if (err) {
                        return cb(err);
                    }
                    this._statRequest(path, opts, 'Save:stat', (err, xhr, stat) => {
                        cb(err, xhr, stat);
                    });
                });
            }
        });
    }

    _putIfMatch(saveOpts, opts, data, rev, etag, callback) {
        // If-Match makes the server reject the upload if the file was changed after the stat,
        // weak etags never pass it
        let origin;
        try {
            origin = new URL(saveOpts.path, location.href).origin;
        } catch {
            origin = saveOpts.path;
        }
        const conditional =
            !!etag && !etag.startsWith('W/') && !this._ifMatchUnsupported.has(origin);
        this._request(
            {
                ...saveOpts,
                op: 'Save:put',
                method: 'PUT',
                data,
                nostat: true,
                headers: conditional ? { 'If-Match': etag } : undefined
            },
            (err, xhr) => {
                if (!err || !conditional) {
                    return callback(err);
                }
                if (err.revConflict) {
                    // some servers can't match their own etags, e.g. Apache with mod_deflate,
                    // so make sure the file was really changed
                    this._statRequest(saveOpts.path, opts, 'Save:stat', (statErr, xhr, stat) => {
                        if (statErr || stat.rev !== rev || stat.etag !== etag) {
                            return callback(err);
                        }
                        this.logger.info('If-Match failed for the current etag, ignoring it');
                        this._ifMatchUnsupported.add(origin);
                        this._putIfMatch(saveOpts, opts, data, rev, null, callback);
                    });
                    return;
                }
                if (xhr.status === 0 && err === 'network error') {
                    // the CORS config of a server on another origin may not allow If-Match,
                    // the browser checks it before sending the data, so a retry costs little
                    this.logger.info('PUT with If-Match failed, retrying without it');
                    return this._putIfMatch(saveOpts, opts, data, rev, null, callback);
                }
                callback(err);
            }
        );
    }

    fileOptsToStoreOpts(opts, file) {
        const result = { user: opts.user, encpass: opts.encpass };
        if (opts.password) {
            const fileId = file.uuid;
            const password = opts.password;
            const encpass = this._xorString(password, fileId);
            result.encpass = this._stringToBase64(encpass);
        }
        return result;
    }

    storeOptsToFileOpts(opts, file) {
        const result = { user: opts.user, password: opts.password };
        if (opts.encpass) {
            const fileId = file.uuid;
            const encpass = this._base64ToString(opts.encpass);
            result.password = this._xorString(encpass, fileId);
        }
        return result;
    }

    _stringToBase64(str) {
        try {
            return btoa(str);
        } catch {
            // btoa throws on characters outside of Latin-1, encode them as UTF-8 instead
            const bytes = kdbxweb.ByteUtils.stringToBytes(str);
            return Utf8Base64Prefix + kdbxweb.ByteUtils.bytesToBase64(bytes);
        }
    }

    _base64ToString(str) {
        if (str.startsWith(Utf8Base64Prefix)) {
            const bytes = kdbxweb.ByteUtils.base64ToBytes(str.substr(Utf8Base64Prefix.length));
            return kdbxweb.ByteUtils.bytesToString(bytes);
        }
        return atob(str);
    }

    _xorString(str, another) {
        let result = '';
        for (let i = 0; i < str.length; i++) {
            const strCharCode = str.charCodeAt(i);
            const anotherIx = i % another.length;
            const anotherCharCode = another.charCodeAt(anotherIx);
            const resultCharCode = strCharCode ^ anotherCharCode;
            result += String.fromCharCode(resultCharCode);
        }
        return result;
    }

    _request(config, callback) {
        if (config.rev) {
            this.logger.debug(config.op, config.path, config.rev);
        } else {
            this.logger.debug(config.op, config.path);
        }
        const ts = this.logger.ts();
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
            if ([200, 201, 204].indexOf(xhr.status) < 0) {
                this.logger.debug(
                    config.op + ' error',
                    config.path,
                    xhr.status,
                    this.logger.ts(ts)
                );
                let err;
                switch (xhr.status) {
                    case 404:
                        err = { notFound: true };
                        break;
                    case 412:
                        err = { revConflict: true };
                        break;
                    default:
                        err = 'HTTP status ' + xhr.status;
                        break;
                }
                if (callback) {
                    callback(err, xhr);
                    callback = null;
                }
                return;
            }
            const rev = xhr.getResponseHeader('Last-Modified');
            if (!rev && !config.nostat) {
                this.logger.debug(
                    config.op + ' error',
                    config.path,
                    'no headers',
                    this.logger.ts(ts)
                );
                if (callback) {
                    callback(Locale.webdavNoLastModified, xhr);
                    callback = null;
                }
                return;
            }
            const completedOpName =
                config.op + (config.op.charAt(config.op.length - 1) === 'e' ? 'd' : 'ed');
            this.logger.debug(completedOpName, config.path, rev, this.logger.ts(ts));
            if (callback) {
                callback(null, xhr, rev ? this._statWithEtag({ rev }, xhr) : null);
                callback = null;
            }
        });
        xhr.addEventListener('error', () => {
            this.logger.debug(config.op + ' error', config.path, this.logger.ts(ts));
            if (callback) {
                callback('network error', xhr);
                callback = null;
            }
        });
        xhr.addEventListener('timeout', () => {
            this.logger.debug(config.op + ' error', config.path, 'timeout', this.logger.ts(ts));
            if (callback) {
                callback('timeout', xhr);
                callback = null;
            }
        });
        xhr.addEventListener('abort', () => {
            this.logger.debug(config.op + ' error', config.path, 'aborted', this.logger.ts(ts));
            if (callback) {
                callback('aborted', xhr);
                callback = null;
            }
        });
        xhr.open(config.method, config.path);
        xhr.responseType = 'arraybuffer';
        if (config.timeout) {
            xhr.timeout = config.timeout;
        }
        if (config.user) {
            xhr.setRequestHeader(
                'Authorization',
                'Basic ' + this._basicAuthCredentials(config.user, config.password)
            );
        }
        if (config.headers) {
            for (const [header, value] of Object.entries(config.headers)) {
                xhr.setRequestHeader(header, value);
            }
        }
        if (['GET', 'HEAD'].indexOf(config.method) >= 0) {
            xhr.setRequestHeader('Cache-Control', 'no-cache');
        }
        if (config.data) {
            const blob = new Blob([config.data], { type: 'application/octet-stream' });
            xhr.send(blob);
        } else {
            xhr.send();
        }
    }

    _basicAuthCredentials(user, password) {
        const credentials = user + ':' + password;
        try {
            return btoa(credentials);
        } catch {
            // characters outside of Latin-1 are sent as UTF-8, see RFC 7617
            return kdbxweb.ByteUtils.bytesToBase64(kdbxweb.ByteUtils.stringToBytes(credentials));
        }
    }

    _calcStatByContent(xhr) {
        if (xhr.status !== 200 || xhr.responseType !== 'arraybuffer' || !xhr.response) {
            this.logger.debug('Cannot calculate rev by content');
            return Promise.resolve(null);
        }
        return kdbxweb.CryptoEngine.sha256(xhr.response).then((hash) => {
            const rev = kdbxweb.ByteUtils.bytesToHex(hash).substr(0, 10);
            this.logger.debug('Calculated rev by content', `${xhr.response.byteLength} bytes`, rev);
            return this._statWithEtag({ rev }, xhr);
        });
    }

    _statWithEtag(stat, xhr) {
        // getResponseHeader logs an error for headers a server on another origin doesn't expose
        const match = /^etag:[ \t]*(.*?)[ \t]*$/im.exec(xhr.getAllResponseHeaders());
        if (match && match[1]) {
            stat.etag = match[1];
        }
        return stat;
    }
}

export { StorageWebDav };
