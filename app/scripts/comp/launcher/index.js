let Launcher;

if (window.kwDesktop) {
    Launcher = require('./launcher-electron').Launcher;
}

export { Launcher };
