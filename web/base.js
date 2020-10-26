const Template = require('./template');
const Log = require('debug')('web');

class Base {

  constructor(name) {
    this._name = name;
    this._websocket = null;
    this._pending = {};
    this.state = {};

    if (!process.env.DEBUG) {
      Template.load();
      this.template = Template[this._name];
    }

    this.main = this.main.bind(this);
    this.ws = this.ws.bind(this);
  }

  main(ctx) {
    if (process.env.DEBUG) {
      Template.load();
      this.template = Template[this._name];
    }
    ctx.body = this.template(this.state);
    ctx.type = 'text/html';
  }

  ws(ctx) {

    if (this._websocket) {
      this._websocket.close();
      this.unwatch();
    }
    this._websocket = ctx.websocket;
    this.watch();

    ctx.websocket.on('close', () => {
      if (this._websocket === ctx.websocket) {
        this._websocket = null;
        this.unwatch();
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
            Log(JSON.stringify(msg, null, 2));
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

  watch() {
  }

  unwatch() {
  }

}

module.exports = Base;
