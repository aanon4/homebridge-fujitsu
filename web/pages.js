const FS = require('fs');
const Main = require('./main');

const Pages = {
  '/':                  { fn: Main.main },
  '/ws':                { fn: Main.ws },
  '/css/main.css':      { path: `${__dirname}/main.css`, type: 'text/css' },
  '/css/bootstrap.css': { path: `${__dirname}/../node_modules/bootstrap/dist/css/bootstrap.css`, type: 'text/css' },
  '/js/script.js':      { path: `${__dirname}/script.js`, type: 'text/javascript' },
  '/js/jquery.js':      { path: `${__dirname}/../node_modules/jquery/dist/jquery.js`, type: 'text/javascript' },
  '/js/bootstrap.js':   { path: `${__dirname}/../node_modules/bootstrap/dist/js/bootstrap.bundle.js`, type: 'text/javascript' }
}

if (!process.env.DEBUG) {
  for (let name in Pages) {
    const page = Pages[name];
    if (page.fn) {
      page.get = page.fn;
    }
    else {
      const data = FS.readFileSync(page.path, { encoding: page.encoding || 'utf8' });
      page.get = async ctx => {
        ctx.body = data;
        ctx.type = page.type;
      }
    }
  }
}
else {
  for (let name in Pages) {
    const page = Pages[name];
    if (page.fn) {
      page.get = page.fn;
    }
    else {
      page.get = async ctx => {
        ctx.body = FS.readFileSync(page.path, { encoding: page.encoding || 'utf8' });
        ctx.type = page.type;
      }
    }
  }
}

module.exports = (root, wsroot) => {
  for (let name in Pages) {
    if (name.endsWith('/ws')) {
      wsroot.get(name, ctx => Pages[name].get(ctx));
    }
    else {
      root.get(name, ctx => Pages[name].get(ctx));
    }
  }
}
