import { expect } from 'chai';
import { StorageWebDav } from 'storage/impl/storage-webdav';

const FilePath = 'https://dav.example.com/dir/file.kdbx';

class FakeWebDavServer {
    files = {};
    requests = [];
    honorIfMatch = true;
    exposeEtag = true;
    weakEtags = false;
    blockIfMatchByCors = false;
    onRequest = null;
    version = 0;

    setFile(path, data) {
        this.version++;
        this.files[path] = {
            data,
            etag: (this.weakEtags ? 'W/' : '') + `"v${this.version}"`,
            // Last-Modified has a 1 second resolution, so it doesn't change in fast tests
            lastModified: 'Sat, 03 Oct 2026 10:00:00 GMT'
        };
    }

    handle(req) {
        this.requests.push(req);
        this.onRequest?.(req);
        const path = req.url;
        const file = this.files[path];
        const ifMatch = req.headers['If-Match'];
        if (ifMatch && this.blockIfMatchByCors) {
            return { error: true };
        }
        switch (req.method) {
            case 'HEAD':
            case 'GET':
                if (!file) {
                    return { status: 404 };
                }
                return { status: 200, headers: this.fileHeaders(file), body: file.data };
            case 'PUT':
                if (ifMatch && this.honorIfMatch && (!file || file.etag !== ifMatch)) {
                    return { status: 412 };
                }
                if (ifMatch && !this.honorIfMatch) {
                    // a server that can't match its own etags
                    return { status: 412 };
                }
                this.setFile(path, req.body);
                return { status: file ? 204 : 201, headers: { ETag: this.files[path].etag } };
            case 'MOVE': {
                if (!file) {
                    return { status: 404 };
                }
                const dest = req.headers.Destination;
                this.files[dest] = file;
                delete this.files[path];
                return { status: 204 };
            }
            case 'DELETE':
                delete this.files[path];
                return { status: 204 };
        }
        return { status: 405 };
    }

    fileHeaders(file) {
        const headers = { 'Last-Modified': file.lastModified };
        if (this.exposeEtag) {
            headers.ETag = file.etag;
        }
        return headers;
    }
}

function createFakeXhrClass(server) {
    return class FakeXhr {
        status = 0;
        response = null;
        headers = {};
        responseHeaders = {};
        listeners = {};

        addEventListener(name, listener) {
            this.listeners[name] = listener;
        }

        open(method, url) {
            this.method = method;
            this.url = url;
        }

        setRequestHeader(name, value) {
            this.headers[name] = value;
        }

        getResponseHeader(name) {
            const key = Object.keys(this.responseHeaders).find(
                (h) => h.toLowerCase() === name.toLowerCase()
            );
            return key ? this.responseHeaders[key] : null;
        }

        getAllResponseHeaders() {
            return Object.entries(this.responseHeaders)
                .map(([name, value]) => `${name.toLowerCase()}: ${value}\r\n`)
                .join('');
        }

        send(body) {
            setTimeout(async () => {
                this.body = body instanceof Blob ? await body.text() : body;
                const res = server.handle(this);
                if (res.error) {
                    this.listeners.error();
                    return;
                }
                this.status = res.status;
                this.responseHeaders = res.headers || {};
                this.response = res.body || null;
                this.listeners.load();
            }, 0);
        }
    };
}

describe('StorageWebDav', () => {
    let server;
    let storage;
    let originalXhr;

    beforeEach(() => {
        server = new FakeWebDavServer();
        server.setFile(FilePath, 'v1');
        storage = new StorageWebDav().init();
        storage.appSettings = { webdavSaveMethod: 'put' };
        originalXhr = window.XMLHttpRequest;
        window.XMLHttpRequest = createFakeXhrClass(server);
    });

    afterEach(() => {
        window.XMLHttpRequest = originalXhr;
    });

    function stat() {
        return new Promise((resolve, reject) => {
            storage.stat(FilePath, null, (err, stat) => (err ? reject(err) : resolve(stat)));
        });
    }

    function save(data, rev) {
        return new Promise((resolve) => {
            storage.save(FilePath, null, data, (err, stat) => resolve({ err, stat }), rev);
        });
    }

    function puts() {
        return server.requests.filter((r) => r.method === 'PUT');
    }

    it('returns the etag in stat', async () => {
        const { rev, etag } = await stat();
        expect(rev).to.eql('Sat, 03 Oct 2026 10:00:00 GMT');
        expect(etag).to.eql('"v1"');
    });

    it('saves with If-Match', async () => {
        const { rev } = await stat();
        const { err } = await save('v2', rev);
        expect(err).to.be.null;
        expect(puts().map((r) => r.headers['If-Match'])).to.eql(['"v1"']);
        expect(server.files[FilePath].data).to.eql('v2');
    });

    it('detects a change made between stat and put in the same second', async () => {
        const { rev } = await stat();
        server.onRequest = (req) => {
            if (req.method === 'PUT' && !server.changed) {
                server.changed = true;
                server.setFile(FilePath, 'other');
            }
        };
        const { err } = await save('v2', rev);
        expect(err).to.eql({ revConflict: true });
        expect(puts().length).to.eql(1);
        expect(server.files[FilePath].data).to.eql('other');
    });

    it('saves without If-Match if the server rejects its own etag', async () => {
        server.honorIfMatch = false;
        const { rev } = await stat();
        const { err } = await save('v2', rev);
        expect(err).to.be.null;
        expect(server.files[FilePath].data).to.eql('v2');
        expect(puts().map((r) => r.headers['If-Match'])).to.eql(['"v1"', undefined]);

        const { err: err2 } = await save('v3', rev);
        expect(err2).to.be.null;
        expect(puts().map((r) => r.headers['If-Match'])).to.eql(['"v1"', undefined, undefined]);
    });

    it("retries without If-Match if CORS doesn't allow it", async () => {
        server.blockIfMatchByCors = true;
        const { rev } = await stat();
        const { err } = await save('v2', rev);
        expect(err).to.be.null;
        expect(server.files[FilePath].data).to.eql('v2');
        expect(puts().map((r) => r.headers['If-Match'])).to.eql(['"v1"', undefined]);
    });

    it('saves without If-Match if the etag is weak', async () => {
        server.weakEtags = true;
        server.setFile(FilePath, 'v1');
        const { rev, etag } = await stat();
        expect(etag).to.match(/^W\//);
        const { err } = await save('v2', rev);
        expect(err).to.be.null;
        expect(puts().map((r) => r.headers['If-Match'])).to.eql([undefined]);
    });

    it('saves without If-Match if the etag is not exposed', async () => {
        server.exposeEtag = false;
        const { rev, etag } = await stat();
        expect(etag).to.be.undefined;
        const { err } = await save('v2', rev);
        expect(err).to.be.null;
        expect(puts().map((r) => r.headers['If-Match'])).to.eql([undefined]);
    });

    it('returns a rev conflict without saving if the rev is different', async () => {
        const { err } = await save('v2', 'Fri, 02 Oct 2026 10:00:00 GMT');
        expect(err).to.eql({ revConflict: true });
        expect(puts().length).to.eql(0);
    });

    it('detects an etag change during the upload with the move method', async () => {
        storage.appSettings = { webdavSaveMethod: 'move' };
        const { rev } = await stat();
        server.onRequest = (req) => {
            if (req.method === 'PUT') {
                server.setFile(FilePath, 'other');
            }
        };
        const { err } = await save('v2', rev);
        expect(err).to.eql({ revConflict: true });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(server.files[FilePath].data).to.eql('other');
        expect(server.requests.map((r) => r.method)).to.eql([
            'HEAD',
            'HEAD',
            'PUT',
            'HEAD',
            'DELETE'
        ]);
        expect(Object.keys(server.files)).to.eql([FilePath]);
    });

    it('saves with the move method', async () => {
        storage.appSettings = { webdavSaveMethod: 'move' };
        const { rev } = await stat();
        const { err, stat: newStat } = await save('v2', rev);
        expect(err).to.be.null;
        expect(server.files[FilePath].data).to.eql('v2');
        expect(newStat.etag).to.eql(server.files[FilePath].etag);
        expect(Object.keys(server.files)).to.eql([FilePath]);
    });
});
