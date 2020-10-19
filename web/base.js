const Template = require('./template');
const Log = require('debug')('web');

class Base {

  constructor(name) {
    Template.load();
    this.template = Template[name];
    this.state = {};
    this._websocket = null;
    this._pending = {};

    this.main = this.main.bind(this);
    this.ws = this.ws.bind(this);
  }

  main(ctx) {
    ctx.body = this.template(this.state);
    ctx.type = 'text/html';
  }

  ws(ctx) {

    if (this._websocket) {
      this._websocket.close();
    }
    this._websocket = ctx.websocket;

    ctx.websocket.on('close', () => {
      if (this._websocket === ctx.websocket) {
        this._websocket = null;
      }
    });

    ctx.websocket.on('error', () => {
      ctx.websocket.close();
    });

    ctx.websocket.on('message', async data => {
      try {
        const msg = JSON.parse(data);
        let fn = this[msg.cmd];
        if (fn) {
          try {
            Log(msg);
            await fn.call(this, msg.value);
          }
          catch (e) {
            Log(e);
          }
        }
      }
      catch (e) {
        Log(e);
      }
    });

  }

  send(cmd, value) {
    try {
      this._websocket.send(JSON.stringify({
        cmd: cmd,
        value: value
      }));
    }
    catch (e) {
      Log(e);
    }
  }

  html(id, text) {
    const pending = this._pending[id] || (this._pending[id] = {});
    if (pending.text !== text) {
      clearTimeout(pending.timeout);
      pending.text = text;
      pending.timeout = setTimeout(() => {
        this.send('html.update', { id: id, html: text });
        const mid = `id="${id}"`;
        for (let key in this._pending) {
          const kid = `id="${key}"`;
          if (this._pending[key].text !== null && (text.indexOf(kid) !== -1 || this._pending[key].text.indexOf(mid) !== -1)) {
            this._pending[key].text = null;
          }
        }
      }, 10);
    }
  }

}

module.exports = Base;
