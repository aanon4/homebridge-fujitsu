const FS = require('fs');
const Path = require('path');
const Main = require('./main');

module.exports = (root, wsroot, smart) => {

  const popper = require.resolve('@popperjs/core');
  const tippy = require.resolve('tippy.js');
  const timepoly = require.resolve('time-input-polyfill');
  const dnd = require.resolve('mobile-drag-drop');

  const main = new Main(smart);
  const pages = {
    '/':                          { fn: main.main },
    '/ws':                        { fn: main.ws },
    '/css/main.css':              { path: `${__dirname}/main.css`, type: 'text/css' },
    '/js/script.js':              { path: `${__dirname}/script.js`, type: 'text/javascript' },
    '/js/popper.js':              { path: Path.resolve(popper, `../../umd/popper.min.js`), type: 'text/javascript' },
    '/js/tippy.js':               { path: Path.resolve(tippy, `../tippy-bundle.umd.min.js`), type: 'text/javascript' },
    '/css/tippy.css':             { path: Path.resolve(tippy, `../tippy.css`), type: 'text/css' },
    '/js/time-input-polyfill.js': { path: Path.resolve(timepoly, `../dist/time-input-polyfill.min.js`), type: 'text/javascript' },
    '/js/dnd-poly.js':            { path: Path.resolve(dnd, '../index.js'), type: 'text/javascript' }
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
