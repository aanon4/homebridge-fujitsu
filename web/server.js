const Koa = require('koa');
const Websockify = require('koa-websocket');
const CacheControl = require('koa-cache-control');
const Router = require('koa-router');
const Pages = require('./pages');

class Web {

  constructor() {
    this.app = null;
  }

  start(smart, config, hap, log) {

    this.log = log;
    this.portnr = config.portnr || 8080;
    this.app = Websockify(new Koa());
    this.app.on('error', err => console.error(err));

    this.app.use(CacheControl({ noCache: true }));

    const root = Router();
    const wsroot = Router();

    Pages(root, wsroot, smart, hap, log);

    this.app.use(root.middleware());
    this.app.ws.use(wsroot.middleware());
    this.app.ws.use(async (ctx, next) => {
      await next(ctx);
      if (ctx.websocket.listenerCount('message') === 0) {
        ctx.websocket.close();
      }
    });

    this.app.listen({ port: this.portnr });
  }

  stop() {
    this.app = null;
  }

}

module.exports = new Web();
