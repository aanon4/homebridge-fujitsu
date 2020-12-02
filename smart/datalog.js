const Path = require('path');
const FS = require('fs');

const LOG_KEEPTIME = 2 * (24 * 60 * 60 * 1000); // 2 days

class DataLog {

  constructor() {
    this.log = {
      debug: console.log,
      error: console.log
    };
    this.logFile = './smart-log.json';
    this.data = {
      version: 1,
      items: []
    };
    this.smart = null;
  }

  start(smart, log, hbapi) {
    this.smart = smart;
    this.log = log;
    this.logFile = Path.join(hbapi.user.persistPath(), 'smart-log.json');

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
    this.log.debug(JSON.stringify(item, null, 2));
    const then = now - LOG_KEEPTIME;
    this.data.items.push(item);
    while (this.data.items[0].time < then) {
      this.data.items.shift();
    }
    this.toFile();
  }

  fromFile() {
    try {
      this.data = JSON.parse(FS.readFileSync(this.logFile, { encoding: 'utf8' }));
    }
    catch (_) {
    }
  }

  toFile() {
    FS.writeFile(this.logFile, JSON.stringify(this.data), { encoding: 'utf8' }, e => {
      if (e) {
        this.log.error('Log:toFile:', e);
      }
    });
  }

}

module.exports = new DataLog();
