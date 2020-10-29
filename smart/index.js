const FS = require('fs');
const Path = require('path');
const Bus = require('./bus');
const Feels = require('feels');

const MODE_OFF = 0;
const MODE_COOL = 2;
const MODE_HEAT = 1;

const AWAY_WAIT = 60; // 1 hour
const AWAY_VALID = [
  [ 6 * 60, 21 * 60 ] // 6am - 9pm
];

class Smart {

  constructor() {
    this.devices = {};
    this.sensors = null;
    this.poller = null;
    this.referenceDevice = null;
    this.feelsLike = false;
    this.holdTime = 0;
    this.unit = 'c';
    this.autoAway = false;
    this.away = null
    this.restoreAwaySchedule = null;
    this.currentProgram = {
      targetMode: MODE_OFF,
      targetTemperature: null,
      currentReferenceTemperature: null,
      currentTemperature: null,
      targetHighTempC: null,
      targetLowTempC: null,
      pause: Number.MAX_SAFE_INTEGER
    };
  }

  async start(config, log, hbapi) {
    this.log = log;
    this.hbapi = hbapi;
    this.stateFile = Path.join(hbapi.user.persistPath(), 'smart-state.json');
    this.referenceDevice = config.reference;
    this.feelsLike = config.feelslike || false;
    this.holdTime = (config.hold || 60) * 60 * 1000;
    this.unit = (config.unit || 'c').toLowerCase();
    this.currentProgram.pause = 0;
    this.autoAway = config.autoaway || false;

    if (config.miio) {
      const miio = require('./sensors/miio');
      await miio.login(config.miio, this.log);
      this.sensors = miio;
    }

    if (config.schedule) {
      this.setSchedule('normal', this.buildSchedule(config.schedule));
      this.setScheduleTo('normal');
    }
    else {
      this.loadState();
      this.web = require('./web/server');
      this.web.start(this, config, this.hbapi, this.log);
    }

    const poll = () => {
      if (this.autoAway) {
        this._checkAway();
        if (this.away && Date.now() - away > (AWAY_WAIT * 60 * 1000) && this.selectedSchedule !== 'away') {
          const selected = this.selectedSchedule;
          this.setScheduleTo('away');
          this.restoreAwaySchedule = selected;
        }
        if (!this.away && this.selectedSchedule === 'away' && this.restoreAwaySchedule) {
          this.setScheduleTo(this.restoreAwaySchedule);
        }
      }
      this._updateSensors().then(() => {
        this._updateProgram();
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
    try {
      await this.sensors.updateDevices(this.devices);
      Bus.emit('smart.devices.update', this.devices);
    }
    catch (e) {
      this.log.error('_updateSensors: error:', e);
    }
  }

  _updateProgram() {
    // Current reference temperature
    this.currentProgram.currentReferenceTemperature = null;
    const refdevice = this.devices[this.referenceDevice];
    if (refdevice && refdevice.environ && refdevice.environ.online) {
      this.currentProgram.currentReferenceTemperature = refdevice.environ.temperature;
    }

    let targetLowTempC = null;
    let targetHighTempC = null;
    this.currentProgram.currentTemperature = this.currentProgram.currentReferenceTemperature;

    // Generate a current temperature based on the temperature of the sensors.
    // These values are weighted, based on a schedule and/or motion associated
    // with the sensors.
    const program = this._getSchedule();
    if (program && refdevice) {

      targetLowTempC = program.low;
      targetHighTempC = program.high;

      let totalWeight = 0;
      let totalWeightedTemperature = 0;

      for (let name in program.rooms) {
        const room = program.rooms[name];
        const device = this.devices[name];
        if (device.environ && device.environ.online) {
          let weight = room.occupied || 0;
          if (device.motion && device.motion.online && !device.motion.motion1800 && 'empty' in room) {
            weight = room.empty;
          }
          totalWeight += weight;
          let tempC = device.environ.temperature;
          if (this.feelsLike) {
            tempC = Feels.humidex(tempC, device.environ.humidity);
          }
          totalWeightedTemperature += tempC * weight;
          this.log.debug('_updateProgram:', name, tempC, 'C', weight);
        }
      }

      if (totalWeight !== 0) {
        this.currentProgram.currentTemperature = totalWeightedTemperature / totalWeight;
        const currentTempDiffC = this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature;
        targetLowTempC -= currentTempDiffC;
        targetHighTempC -= currentTempDiffC;
      }
    }

    this.currentProgram.targetLowTempC = targetLowTempC;
    this.currentProgram.targetHighTempC = targetHighTempC;

    if (targetLowTempC === null || targetHighTempC === null) {
      // No active program, so turn it off
      this.currentProgram.targetMode = MODE_OFF;
      this.currentProgram.targetTemperature = null;
    }
    else if (this.currentProgram.currentTemperature < targetLowTempC) {
      // Too cold - heat
      this.currentProgram.targetMode = MODE_HEAT;
      this.currentProgram.targetTemperature = targetLowTempC;
    }
    else if (this.currentProgram.currentTemperature > targetHighTempC) {
      // Too hot - cool
      this.currentProgram.targetMode = MODE_COOL;
      this.currentProgram.targetTemperature = targetHighTempC;
    }
    else {
      // Just right - leave the current mode and target 'as is'.
    }

    Bus.emit('smart.program.update', this.currentProgram);

    this.log.debug('_updateProgram: currentProgram:', JSON.stringify(this.currentProgram, null, 2));
    //this.log.debug('_updateProgram: referenceTemp:', this.currentProgram.currentReferenceTemperature.toFixed(1), 'C', (32 + this.currentProgram.currentReferenceTemperature / 5 * 9).toFixed(1), 'F');
    //this.log.debug('_updateProgram: currentTemp:', this.currentProgram.currentTemperature.toFixed(1), 'C', (32 + this.currentProgram.currentTemperature / 5 * 9).toFixed(1), 'F');
    //this.log.debug('_updateProgram: currentTempDiff:', (this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature).toFixed(1), 'C', ((this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature) / 5 * 9).toFixed(1), 'F');
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

    // Walk backwards from this point to find the exact match based on looping around the schedule list and handle triggers
    let pos = (schedule.length + start - 1) % schedule.length;
    for (;;) {
      const sched = schedule[pos];
      if (weektime >= sched.weektime) {
        if (sched.trigger) {
          // Clear trigger which is > 24 hours old
          if (sched._triggered && now - sched._triggered > 24 * 60 * 60 * 1000) {
            delete sched._triggered;
          }
          if (!sched._triggered) {
            // Check to see if new trigger has happened
            sched.trigger.forEach(trigger => {
              const device = this.devices[trigger.room];
              if (device && device.motion && device.motion.online && device.motion.motion1800) {
                sched._triggered = now;
              }
            });
          }
        }
        // Return schedule which has been triggered or requires no trigger
        if (!sched.trigger || sched._triggered) {
          this.log.debug('_getSchedule: program:', sched);
          return sched;
        }
      }
      pos = (schedule.length + pos - 1) % schedule.length;
      if (pos === start) {
        // No schedule to run
        this.log.debug('_getSchedule: program: none');
        return null;
      }
    }
  }

  _checkAway() {
    let motion = false;
    for (let name in this.devices) {
      const device = this.devices[name];
      if (device.motion && device.motion.online && device.motion.motion1800) {
        motion = true;
        break;
      }
    }

    if (motion) {
      this.away = null;
    }
    else if (!this.away) {
      const now = new Date();
      const daytime = now.getHours() * 60 + now.getMinutes();
      if (AWAY_VALID.find(period => period[0] <= daytime && period[1] >= daytime)) {
        this.away = Date.now();
      }
    }
  }

  setSchedule(name, schedule) {
    this.log.debug('setSchedule:', name, schedule);
    const copy = [].concat(schedule);
    copy.sort((a, b) => a.weektime - b.weektime + (a.trigger ? 0.5 : 0) - (b.trigger ? 0.5 : 0));
    this.schedules[name] = copy;
    this.saveState();
    Bus.emit('smart.schedule.update', name, copy);
    this._updateProgram();
  }

  getSchedule(name) {
    return this.schedules[name];
  }

  setScheduleTo(name) {
    this.log.debug('setScheduleTo:', name);
    this.restoreAwaySchedule = null;
    if (this.selectedSchedule !== name && name in this.schedules) {
      this.selectedSchedule = name;
      this.saveState();
      Bus.emit('smart.schedule.update', this.selectedSchedule, this.schedules[this.selectedSchedule]);
      this._updateProgram();
    }
  }

  buildSchedule(schedule) {
    this.log.debug('buildSchedule:', schedule);

    // Format: eg. 12:00am, 12:00pm, 1:10am, 2:05p
    function parseTime(time) {
      const t = /^(\d+):(\d+)([ap])m?$/.exec(time);
      if (t) {
        return parseInt(t[1]) * 60 + parseInt(t[2]) + (t[3] === 'p' ? 12 * 60 : 0) - (t[1] === '12' ? 12 * 60 : 0);
      }
      else {
        return undefined;
      }
    }

    // Format: eg. 'Mon', 'Mon-Wed', 'Fri-Mon', 'Any'
    const map = [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ];
    function parseDayOfWeek(dows) {
      let days = dows.split('-');
      if (days.length === 1) {
        days = [ days[0], days[0] ];
      }
      let from = map.indexOf(days[0]);
      let to = map.indexOf(days[1]);
      if (to === -1 || from === -1) {
        if (dows !== 'Any') {
          return undefined;
        }
        from = 0;
        to = 6;
      }
      if (to < from) {
        to += 7;
      }
      const d = [];
      for (let i = from; i <= to; i++) {
        d.push(i % 7);
      }
      return d;
    }

    const toC = (v) => {
      return Feels.tempConvert(parseFloat(v), this.unit, 'c');
    }

    const computed = [];
    (schedule || []).forEach(sched => {
      const time = parseTime(sched.time);
      const days = parseDayOfWeek(sched.day);
      const low = toC(sched.low);
      const high = toC(sched.high);
      if (time !== undefined && days !== undefined) {
        days.forEach(day => {
          computed.push({
            weektime: day * 24 * 60 + time,
            low: low,
            high: high,
            trigger: sched.tigger,
            rooms: sched.rooms
          });
        });
      }
      else {
        this.log.debug('buildSchedule: bad schedule:', sched);
      }
    });
    this.log.debug('buildSchedule: result:', computed);

    return computed;
  }

  getDevices() {
    return this.devices;
  }

  loadState() {
    try {
      const info = JSON.parse(FS.readFileSync(this.stateFile, { encoding: 'utf8' }));
      this.selectedSchedule = info.schedule.selected;
      this.schedules = info.schedule.schedules;
    }
    catch (_) {
      this.selectedSchedule = 'normal';
      this.schedules = {
        'normal': [],
        'vacation': [],
        'away': []
      };
    }
  }

  saveState() {
    const json = JSON.stringify({
      version: 1,
      schedule: {
        selected: this.selectedSchedule,
        schedules: this.schedules
      }
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
