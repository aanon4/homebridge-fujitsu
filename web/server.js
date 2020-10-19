#! /usr/bin/env node
const Koa = require('koa');
const Websockify = require('koa-websocket');
const CacheControl = require('koa-cache-control');
const Router = require('koa-router');
const Pages = require('./pages');

process.on('uncaughtException', e => {
  console.error('uncaughtException:');
  console.error(e)
});
process.on('unhandledRejection', e => {
  console.error('unhandledRejection:');
  console.error(e)
});

// Web port
const port = parseInt(process.env.PORT || 8080);

const App = Websockify(new Koa());
App.on('error', err => console.error(err));

App.use(CacheControl({ noCache: true }));

const root = Router();
const wsroot = Router();

Pages(root, wsroot);

App.use(root.middleware());
App.ws.use(wsroot.middleware());
App.ws.use(async (ctx, next) => {
  await next(ctx);
  if (ctx.websocket.listenerCount('message') === 0) {
    ctx.websocket.close();
  }
});

App.listen({ port: port });
