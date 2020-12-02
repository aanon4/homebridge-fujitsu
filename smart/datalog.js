const Path = require('path');
const FS = require('fs');
const Pako = require('pako');

const LOG_KEEPTIME = 2 * (24 * 60 * 60 * 1000); // 2 days

class DataLog {

  constructor() {
    this.log = {
      debug: console.log,
      error: console.log
    };
    this.logFile = './smart-log.json.gz';
    this.data = {
      version: 1,
      items: []
    };
    this.smart = null;
  }

  start(smart, log, hbapi) {
    this.smart = smart;
    this.log = log;
    this.logFile = Path.join(hbapi.user.persistPath(), 'smart-log.json.gz');

    this.fromFile();
  }

  mark() {
    const now = Date.now();
    const devices = this.smart.devices;
    const program = this.smart.currentProgram;
    const weather = this.smart.weather && this.smart.weather.weather;
    const item = {
      time: now,
      unit: this.smart.unit,
      program: {
        sched: this.smart.selectedSchedule,
        mode: program.targetMode,
        temp: program.targetTemperatureC,
        fan: program.fanSpeed,
        eco: this.smart.ecoActive(),
        hold: program.program === this.smart.hold,
        away: !!this.smart.restoreAwaySchedule
      },
      remote: {
        mode: this.smart.remoteTargetHeatingCoolingState,
        temp: this.smart.referenceTemperature,
        target: this.smart.remoteTargetTemperatureC,
        fan: this.smart.remoteFanSpeed
      }
    };
    if (devices) {
      item.devices = Object.keys(devices).map(name => {
        const device = devices[name];
        const item = { name: name };
        if (device.environ) {
          item.environ = Object.assign({}, device.environ);
        }
        if (device.motion) {
          item.motion = Object.assign({}, device.motion);
        }
        if (device.magnet) {
          item.magnet = Object.assign({}, device.magnet);
        }
        return item;
      });
    }
    if (weather) {
      item.weather = {
        temperature: weather.temperature,
        humidity: weather.humidity
      };
    };
    const then = now - LOG_KEEPTIME;
    this.data.items.push(item);
    while (this.data.items[0].time < then) {
      this.data.items.shift();
    }
    this.toFile();
  }

  getItems() {
    return this.data.items;
  }

  fromFile() {
    try {
      this.data = JSON.parse(Pako.ungzip(FS.readFileSync(this.logFile), { to: 'string' }));
    }
    catch (_) {
    }
  }

  toFile() {
    return;
    try {
      FS.writeFile(this.logFile, Pako.gzip(JSON.stringify(this.data)), e => {
        if (e) {
          this.log.error('toFile:', e);
        }
      });
    }
    catch (_) {
    }
  }
}

module.exports = new DataLog();
