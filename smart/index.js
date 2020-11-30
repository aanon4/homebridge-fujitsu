const FS = require('fs');
const Path = require('path');
const Feels = require('feels');
const Bus = require('./bus');

const FJ_OFF = 0;
const FJ_AUTO = 2;
const FJ_COOL = 3;
const FJ_DRY = 4;
const FJ_FAN = 5;
const FJ_HEAT = 6;

const HK_OFF = 0;
const HK_COOL = 2;
const HK_HEAT = 1;
const HK_AUTO = 3;

const FJ2HK = { [FJ_OFF]: HK_OFF, [FJ_AUTO]: HK_AUTO, [FJ_COOL]: HK_COOL, [FJ_DRY]: HK_OFF, [FJ_FAN]: HK_OFF, [FJ_HEAT]: HK_HEAT };

const AUTOAWAY_START = 8 * 60; // 8am
const AUTOAWAY_END = 21 * 60; // 9pm
const AUTOAWAY_WAIT = 60; // 1 hour

class Smart {

  constructor() {
    this.devices = {};
    this.sensors = null;
    this.poller = null;
    this.feelsLike = false;
    this.unit = 'c';
    this.awaySchedule = null;
    this.away = {
      motion: 0,
      restore: null
    };
    this.currentProgram = {
      targetMode: HK_HEAT,
      currentTemperatureC: null,
      targetTemperatureC: null,
      programLowTempC: null,
      programHighTempC: null,
      adjustedLowTempC: null,
      adjustedHighTempC: null,
      fanSpeed: 'auto',
      program: {}
    };
    this.hold = {};
    this.airclean = {
      enable: false,
      speed: 0
    };
    this.referenceTemperature = null;
    this.remoteTargetTemperatureC = null;
    this.remoteTargetHeatingCoolingState = HK_HEAT;
    this.onUpdateCallback = null;
    this.eco = [];
  }

  async start(config, unit, log, hbapi, onUpdate) {
    this.log = log;
    this.hbapi = hbapi;
    this.stateFile = Path.join(hbapi.user.persistPath(), 'smart-state.json');
    this.feelsLike = config.feelslike || false;
    this.unit = unit ? 'f' : 'c';
    this.currentProgramUntil = 0;
    this.onUpdateCallback = onUpdate;

    this.loadState();

    this.web = require('./web/server');
    this.web.start(this, config);

    if (config.miio) {
      const miio = require('./sensors/miio');
      await miio.login(config.miio, this.log);
      this.sensors = miio;
    }

    const poll = () => {
      this._updateSensors().then(() => {
        this._checkAway();
        this._updateProgram();
        this.onUpdateCallback();
        this.poller = setTimeout(poll, Math.max(0, 60000 - Date.now() % 60000));
      });
    }
    poll();

    if (config.weather) {
      this.weather = require('./weather');
      this.weather.start(config.weather);
    }
  }

  stop() {
    if (this.poller) {
      clearTimeout(this.poller);
    }
    if (this.weather) {
      this.weather.stop();
    }
    if (this.web) {
      this.web.stop();
    }
  }

  async _updateSensors() {
    this.log.debug('_updateSensors:');
    if (!this.sensors) {
      return;
    }
    try {
      await this.sensors.updateDevices(this.devices);
      if (this.feelsLike) {
        for (let name in this.devices) {
          const device = this.devices[name];
          if ('environ' in device) {
            device.environ.feelslike = device.environ.temperature <= 20 ? device.environ.temperature : Feels.heatIndex(device.environ.temperature, device.environ.humidity);
          }
        }
      }
      Bus.emit('smart.devices.update', this.devices);
    }
    catch (e) {
      this.log.error('_updateSensors: error:', e);
    }
  }

  _updateProgram() {
    // Generate a current temperature based on the temperature of the sensors.
    // These values are weighted, based on a schedule and/or motion associated
    // with the sensors.
    const p = this.currentProgram;
    p.currentTemperatureC = this.referenceTemperature;
    const program = this._getSchedule();

    // No program to run
    if (!program) {
      p.targetMode = this.remoteTargetHeatingCoolingState || HK_OFF;
      p.targetTemperatureC = this.remoteTargetTemperatureC;
      p.program = null;
      p.programLowTempC = null;
      p.programHighTempC = null;
      p.adjustedLowTempC = null;
      p.adjustedHighTempC = null;
      p.fanSpeed = 'auto';
      return;
    }

    p.program = program;
    p.programLowTempC = program.low;
    p.programHighTempC = program.high;
    p.adjustedLowTempC = program.low;
    p.adjustedHighTempC = program.high;

    const now = new Date();
    const weekday = now.getDay();
    const daytime = now.getHours() * 60 + now.getMinutes();

    // Make eco adjustments if enabled
    if (this.ecoActive()) {
      if (daytime < this.eco.from) {
        // Time within the guard period before eco starts. We bump the heat/cool temps during this
        // period so we won't need to run the hvac later
        p.adjustedLowTempC += this.eco.gDelta;
        p.adjustedHighempC -= this.eco.gDelta;
      }
      else {
        // Time in the eco period proper. Decrease the heat/cool temps to avoid running the hvac when
        // it's expensive.
        p.adjustedLowTempC -= this.eco.eDelta;
        p.adjustedHighTempC += this.eco.eDelta;
      }
    }

    // Make room temperature adjustments (if set)
    if (this.referenceTemperature !== null && program.rooms.length) {

      let totalWeight = 0;
      let totalWeightedTemperature = 0;

      for (let name in program.rooms) {
        const room = program.rooms[name];
        const device = this.devices[name];
        if (device.environ && device.environ.online) {
          let weight = room.occupied || 0;
          if (device.motion && device.motion.online && !device.motion.motion && 'empty' in room) {
            weight = room.empty;
          }
          totalWeight += weight;
          const tempC = this.feelsLike ? device.environ.feelslike : device.environ.temperature;
          totalWeightedTemperature += tempC * weight;
          this.log.debug('_updateProgram:', name, tempC, 'C', weight);
        }
      }

      if (totalWeight !== 0) {
        p.currentTemperatureC = totalWeightedTemperature / totalWeight;
        const currentTempDiffC = p.currentTemperatureC - this.referenceTemperature;
        p.adjustedLowTempC -= currentTempDiffC;
        p.adjustedHighTempC -= currentTempDiffC;
      }
    }

    // Fan speed
    p.fanSpeed = program.fan === 'auto' ? 'auto' : parseInt(program.fan);

    // Heating or cooling mode?
    if (p.adjustedLowTempC === p.adjustedHighTempC) {
      p.targetMode = HK_AUTO;
      p.targetTemperatureC = p.adjustedLowTempC;
    }
    else if (p.currentTemperatureC < p.adjustedLowTempC) {
      // Too cold - heat
      p.targetMode = HK_HEAT;
      p.targetTemperatureC = p.adjustedLowTempC;
    }
    else if (p.currentTemperatureC > p.adjustedHighTempC) {
      // Too hot - cool
      p.targetMode = HK_COOL;
      p.targetTemperatureC = p.adjustedHighTempC;
    }
    else {
      // No need to heat or cool. We may want to clean the air now
      if (this.airclean.enable) {
        p.targetMode = HK_OFF;
        p.fanSpeed = this.airclean.speed;
      }
      else {
        p.targetMode = this.remoteTargetHeatingCoolingState;
        switch (p.targetMode) {
          case HK_COOL:
            p.targetTemperatureC = p.adjustedHighTempC;
            break;
          case HK_HEAT:
            p.targetTemperatureC = p.adjustedLowTempC;
            break;
          case HK_OFF:
            p.targetMode = HK_HEAT;
            p.targetTemperatureC = p.adjustedLowTempC;
            break;
          default:
            p.targetTemperatureC = this.remoteTargetTemperatureC;
            break;
        }
      }
    }

    Bus.emit('smart.program.update', this.currentProgram);

    this.log.debug('_updateProgram: currentProgram:', JSON.stringify(this.currentProgram, null, 2));
  }

  _getSchedule() {
    this.log.debug('_getSchedule:');
    const now = new Date();
    const weektime = (now.getDay() * 24 + now.getHours()) * 60 + now.getMinutes();

    const schedule = this.schedules[this.selectedSchedule];
    if (!schedule.length) {
      return null;
    }

    // Find the approximate schedule for the current time.
    let start = 0;
    let end = schedule.length;
    while (start < end) {
      const i = Math.floor((start + end) / 2);
      if (schedule[i].weektime <= weektime) {
        start = i + 1;
      }
      else {
        end = i;
      }
    }

    // Walk backwards from this point to find a match (with optional triggers)
    let pos = (start + schedule.length - 1) % schedule.length;
    for (;;) {
      const sched = schedule[pos];
      if (sched.trigger) {
        // Clear trigger which is > 24 hours old
        if (sched._triggered && now - sched._triggered > 24 * 60 * 60 * 1000) {
          delete sched._triggered;
        }
        if (!sched._triggered) {
          // Check to see if new trigger has happened
          sched.trigger.forEach(trigger => {
            const device = this.devices[trigger.room];
            if (device) {
              if (device.motion && device.motion.online && device.motion.motion) {
                sched._triggered = now;
              }
              if (device.magnet && device.magnet.online && (device.magnet.open || device.magnet.close)) {
                sched._triggered = now;
              }
            }
          });
        }
      }
      // Return schedule which has been triggered or requires no trigger
      if (!sched.trigger || sched._triggered) {
        this.log.debug('_getSchedule: program:', sched);
        return sched;
      }
      if (pos === start) {
        // No schedule to run
        this.log.debug('_getSchedule: program: none');
        return null;
      }
      pos = (pos + schedule.length - 1) % schedule.length;
    }
  }

  _checkAway() {
    if (!this.awaySchedule.enable) {
      return;
    }

    let motion = null;
    for (let name in this.devices) {
      const device = this.devices[name];
      if (device.motion && device.motion.online) {
        if (device.motion.motion) {
          motion = true;
          break;
        }
        motion = false;
      }
      if (device.magnet && device.magnet.online) {
        if (device.magnet.open || device.magnet.close) {
          motion = true;
          break;
        }
        motion = false;
      }
    }

    if (motion === null) {
      // No sensors detected so dont make any changes
      return;
    }

    // For away to be triggered we must have seen motion inside the valid period, that motion to
    // have been a specific amount of time ago, and for the time now to also be in the valid period.
    const now = new Date();
    const daytime = now.getHours() * 60 + now.getMinutes();
    if (motion) {
      this.away.motion = daytime;
      // Not away
      if (this.selectedSchedule === 'away' && this.awaySchedule.restore) {
        this.setScheduleTo(this.awaySchedule.restore);
      }
    }
    else if (this.selectedSchedule !== 'away') {
      if (daytime - this.away.motion > this.awaySchedule.wait &&
          this.awaySchedule.from <= this.away.motion && this.awaySchedule.to >= this.away.motion &&
          this.awaySchedule.from <= daytime && this.awaySchedule.from >= daytime
      ) {
        // Away
        const selected = this.selectedSchedule;
        this.setScheduleTo('away');
        this.awaySchedule.restore = selected;
      }
    }
  }

  setSchedule(name, schedule) {
    this.log.debug('setSchedule:', name, schedule);
    schedule.sort((a, b) => a.weektime - b.weektime + (a.trigger ? 0.5 : 0) - (b.trigger ? 0.5 : 0));
    if (JSON.stringify(schedule) != JSON.stringify(this.schedules[name], (k, v) => k === '_triggered' ? undefined : v)) {
      this.schedules[name] = schedule;
      this.saveState();
      this._updateProgram();
      this.onUpdateCallback();
    }
  }

  getSchedule(name) {
    return this.schedules[name];
  }

  setScheduleTo(name) {
    this.log.debug('setScheduleTo:', name);
    this.awaySchedule.restore = null;
    if (this.selectedSchedule !== name && name in this.schedules) {
      this.selectedSchedule = name;
      this.saveState();
      this._updateProgram();
      this.onUpdateCallback();
      Bus.emit('smart.schedule.update', this.selectedSchedule, this.schedules[this.selectedSchedule]);
    }
  }

  copyScheduleDay(from, to) {
    this.log.debug('copyScheduleDay:', from, '->', to);
    const map = [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ];
    const fromtime = map.indexOf(from) * 24 * 60;
    const totime = map.indexOf(to) * 24 * 60;
    if (fromtime < 0 || totime < 0) {
      return;
    }
    const fromtimeend = fromtime + 24 * 60;
    const totimeend = totime + 24 * 60;
    const schedule = [].concat(this.schedules[this.selectedSchedule]);
    for (let i = schedule.length - 1; i >= 0; i--) {
      const s = schedule[i];
      if (s.weektime >= totime && s.weektime < totimeend) {
        schedule.splice(i, 1);
      }
    }
    for (let i = schedule.length - 1; i >= 0; i--) {
      const s = schedule[i];
      if (s.weektime >= fromtime && s.weektime < fromtimeend) {
        const copy = {
          weektime: s.weektime - fromtime + totime,
          high: s.high,
          low: s.low,
          trigger: s.trigger ? [].concat(s.trigger) : null,
          fan: s.fan,
          rooms: Object.keys(s.rooms).reduce((rooms, room) => {
            rooms[room] = { occupied : s.rooms[room].occupied, empty: s.rooms[room].empty };
            return rooms;
          }, {})
        }
        schedule.push(copy);
      }
    }
    this.setSchedule(this.selectedSchedule, schedule);
    Bus.emit('smart.schedule.update', this.selectedSchedule, schedule);
  }

  // Format: eg. 12:00am, 12:00pm, 1:10am, 2:05p
  _parseTime(time) {
    const t = /^(\d+):(\d+)([ap])m?$/.exec(time);
    if (t) {
      return parseInt(t[1]) * 60 + parseInt(t[2]) + (t[3] === 'p' ? 12 * 60 : 0) - (t[1] === '12' ? 12 * 60 : 0);
    }
    else {
      return undefined;
    }
  }

  getDevices() {
    return this.devices;
  }

  setRemoteState(remote) {
    if ('display_temperature' in remote) {
      this.referenceTemperature = parseInt(remote.display_temperature) / 100 - 50;
    }
    if ('adjust_temperature' in remote) {
      this.remoteTargetTemperatureC = parseInt(remote.adjust_temperature) / 10;
    }
    if ('operation_mode' in remote) {
      this.remoteTargetHeatingCoolingState = FJ2HK[remote.operation_mode];
    }
    this._updateProgram();
  }

  getProgram() {
    return this.currentProgram;
  }

  pauseProgram() {
    this.hold = this.currentProgram.program;
    Bus.emit('smart.program.update', this.currentProgram);
  }

  resumeProgram(program) {
    this.hold = program || null;
    Bus.emit('smart.program.update', this.currentProgram);
  }

  setAutoAway(config) {
    [ 'enable', 'from', 'to', 'wait' ].forEach(key => {
      if (key in config) {
        this.awaySchedule[key] = config[key];
      }
    });
    this.saveState();
    Bus.emit('smart.program.update', this.currentProgram);
  }

  setEco(config) {
    [ 'enable', 'from', 'to', 'guard', 'gDelta', 'eDelta' ].forEach(key => {
      if (key in config) {
        this.eco[key] = config[key];
      }
    });
    if ('day' in config) {
      this.eco.days[config.day] = config.enable;
    }
    this.saveState();
    Bus.emit('smart.program.update', this.currentProgram);
  }

  ecoActive() {
    const now = new Date();
    const weekday = now.getDay();
    const daytime = now.getHours() * 60 + now.getMinutes();
    return this.eco.enable &&
           this.eco.days[weekday] &&
           daytime >= (this.eco.from - this.eco.guard) && daytime <= this.eco.to;
  }

  setAirClean(speed) {
    if (this.airclean.speed != speed) {
      this.airclean.enable = speed != 0;
      this.airclean.speed = speed;
      this.saveState();
      this._updateProgram();
      this.onUpdateCallback();
    }
  }

  loadState() {
    this.selectedSchedule = 'normal';
    this.schedules = {
      'normal': [],
      'vacation': [],
      'away': []
    };
    this.awaySchedule = { enable: false, from: 8 * 60, to: 21 * 60, wait: 60 };
    this.airclean = { enable: false, speed: 50 };
    this.eco = { enable: false, days: {}, from: 17 * 60, to: 20 * 60, guard: 30, gDelta: 0.5, eDelta: 0 };
    try {
      const info = JSON.parse(FS.readFileSync(this.stateFile, { encoding: 'utf8' }));
      if (info.schedule) {
        if (info.schedule.selected) {
          this.selectedSchedule = info.schedule.selected;
        }
        if (info.schedule.schedules) {
          this.schedules = info.schedule.schedules;
        }
      }
      if (info.autoaway && 'from' in info.autoaway) {
        this.awaySchedule = info.autoaway;
      }
      if (info.airclean) {
        this.airclean = info.airclean;
      }
      if (info.eco) {
        this.eco = info.eco;
      }
    }
    catch (_) {
    }
  }

  saveState() {
    const json = JSON.stringify({
      version: 1,
      schedule: {
        selected: this.selectedSchedule,
        schedules: this.schedules
      },
      autoaway: this.awaySchedule,
      eco: this.eco,
      airclean: this.airclean,
    });
    FS.readFile(this.stateFile, { encoding: 'utf8' }, (e, info) => {
      if (!e) {
        if (info == json) {
          return;
        }
        FS.writeFile(`${this.stateFile}.bak`, info, { encoding: 'utf8' }, e => {
          if (e) {
            this.log.error('saveState: copy:', e);
          }
        });
      }
      FS.writeFile(this.stateFile, json, { encoding: 'utf8' }, e => {
        if (e) {
          this.log.error('saveState:', e);
        }
      });
    });
  }
}

module.exports = new Smart();
