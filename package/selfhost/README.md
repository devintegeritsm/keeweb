# Self-hosted KeeWeb with WebDAV

A build of the web app for your own server, with cloud storage providers turned off
and a stricter Content Security Policy than the default build.

## Build

```sh
package/selfhost/build.sh
```

Needs Node.js (see `.nvmrc`). The result:

- `dist-selfhost/www`: the web root to deploy
- `dist-selfhost/keeweb-<version>-<commit>-selfhost.tar.gz`: the same files as an archive

What the script changes compared to the regular build:

- `index.html` loads `config.json` from the `kw-config` meta tag. Because of that, the `?config=`
  url parameter is ignored, so nobody can change your settings with a crafted link.
- The CSP no longer allows `ws:` connections and images from `services.keeweb.info`
  (the favicon download feature, which sends entry hostnames there, stops working),
  and adds `base-uri 'none'`.
- The `oauth-result` pages used only by Dropbox, Google Drive and OneDrive are removed.

## Deploy

1. Serve `dist-selfhost/www` over HTTPS on its own origin, e.g. `https://keeweb.example.com`.
   Don't put anything else on that origin, especially files other people can upload.
2. Add the security headers from `nginx.conf.example`. The CSP inside `index.html` can't set
   `frame-ancestors`, so the header is needed to stop other sites from framing the app.
3. Make `index.html`, `service-worker.js` and `config.json` revalidate on every load
   (`Cache-Control: no-cache`), otherwise browsers can keep an old version.

## config.json

Settings in `config.json` are applied on every load, overriding changes made in the app:

| Setting | Value | Why |
|---|---|---|
| `dropbox`, `gdrive`, `onedrive`, `msteams` | `false` | only WebDAV is offered |
| `webdavSaveMethod` | `put` | upload with `If-Match`, so a save can't overwrite changes made on another device after KeeWeb checked the file; use `move` if your server writes uploads in place instead of to a temp file like Nextcloud and Apache mod_dav do |
| `canOpenDemo` | `false` | no demo database |
| `autoSaveInterval` | `-1` | save on every change, so other devices see it and nothing waits in the browser |
| `idleMinutes` | `5` | lock after 5 minutes without activity |
| `rememberKeyFiles` | `""` | don't keep key file data in the browser |

Browsers don't let web pages clear the clipboard, so a copied password stays there until something
else is copied, unlike in the desktop app, which clears it after 15 seconds by default.

`config.json` is publicly readable, never put passwords or tokens there. To show your database
on the open screen, add a `files` list next to `settings`, without credentials:

```json
"files": [
    {
        "storage": "webdav",
        "name": "Passwords",
        "path": "https://dav.example.com/keepass/Passwords.kdbx",
        "options": { "user": "me" }
    }
]
```

Other settings are listed in `app/scripts/const/default-app-settings.js`.

## WebDAV

- Use HTTPS. The CSP blocks plain `http://` WebDAV on another origin.
- Use a separate app password with access only to the folder with the database,
  e.g. a Nextcloud app password. KeeWeb remembers the WebDAV password in the browser,
  obfuscated with a key stored inside the database.
- If WebDAV is on another origin than KeeWeb, it must allow KeeWeb with CORS: methods
  `GET, HEAD, PUT, MOVE, DELETE, OPTIONS`, request headers
  `Authorization, Cache-Control, Content-Type, Destination, Overwrite, If-Match`, the `ETag`
  response header exposed with `Access-Control-Expose-Headers`, and preflight `OPTIONS` requests
  answered without authentication. See the second part of `nginx.conf.example`. Without the `ETag`
  header KeeWeb can't make saves conditional and relies on `Last-Modified`, which has a resolution
  of one second.
- Enable versioning or snapshots on the server, KeeWeb doesn't keep backups of WebDAV files.

## Updating

Pull the changes, run `package/selfhost/build.sh` again and replace the deployed files.
Open browsers pick up the new version through the service worker on the next load.
