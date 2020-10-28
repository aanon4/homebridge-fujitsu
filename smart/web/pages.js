const FS = require('fs');
const Main = require('./main');

module.exports = (root, wsroot, smart, hap, log) => {

  const main = new Main(smart, hap, log);
  const pages = {
    '/':                          { fn: main.main },
    '/ws':                        { fn: main.ws },
    '/css/main.css':              { path: `${__dirname}/main.css`, type: 'text/css' },
    '/js/script.js':              { path: `${__dirname}/script.js`, type: 'text/javascript' },
    '/js/popper.js':              { path: `${__dirname}/../../node_modules/@popperjs/core/dist/umd/popper.min.js`, type: 'text/javascript' },
    '/js/tippy.js':               { path: `${__dirname}/../../node_modules/tippy.js/dist/tippy-bundle.umd.min.js`, type: 'text/javascript' },
    '/css/tippy.css':             { path: `${__dirname}/../../node_modules/tippy.js/dist/tippy.css`, type: 'text/css' },
    '/js/time-input-polyfill.js': { path: `${__dirname}/../../node_modules/time-input-polyfill/dist/time-input-polyfill.min.js`, type: 'text/javascript' }
  }

  if (!process.env.DEBUG) {
    for (let name in pages) {
      const page = pages[name];
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
    for (let name in pages) {
      const page = pages[name];
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

  for (let name in pages) {
    if (name.endsWith('/ws')) {
      wsroot.get(name, ctx => pages[name].get(ctx));
    }
    else {
      root.get(name, ctx => pages[name].get(ctx));
    }
  }
}
