const { handle } = require('../ipc-validation');
const { setLocale } = require('../locale');

handle('setLocale', (e, values) => setLocale(values));
