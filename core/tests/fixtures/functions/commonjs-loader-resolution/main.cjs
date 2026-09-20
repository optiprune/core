const { live } = require('./library.cjs');
function local(require) { require('./not-a-loader.cjs'); }
void live;
