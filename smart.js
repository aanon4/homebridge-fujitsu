const Feels = require('feels');

const MODE_OFF = 0;
const MODE_COOL = 2;
const MODE_HEAT = 1;

class Smart {

  constructor() {
    this.devices = {};
    this.sensors = null;
    this.poller = null;
    this.referenceDevice = null;
    this.feelsLike = false;
    this.holdTime = 0;
    this.unit = 'c';
    this.currentProgram = {
      targetMode: MODE_OFF,
      targetTemperature: null,
      currentReferenceTemperature: null,
      currentTemperature: null,
      pause: Number.MAX_SAFE_INTEGER
    };
  }

  start(config, log) {
    this.log = log;
    this.referenceDevice = config.reference;
    this.feelsLike = config.feelslike || false;
    this.holdTime = (config.hold || 60) * 60 * 1000;
    this.unit = (config.unit || 'c').toLowerCase();
    this.sensors = config.sensors;
    this.currentProgram.pause = 0;

    this.setSchedule(this.buildSchedule(config.schedule));

    this.poller = setInterval(() => {
      this._run()
    }, (config.interval || 60) * 1000);
    this._run();
  }

  stop() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  async _run() {
    this.log('_run:');
    try {
      await this.sensors.updateDevices(this.devices);
    }
    catch (e) {
      this.log('_run: _updateDevice error:', e);
      return;
    }

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
          this.log('_run:', name, tempC, 'C', weight);
        }
      }

      if (totalWeight !== 0) {
        this.currentProgram.currentTemperature = totalWeightedTemperature / totalWeight;
        const currentTempDiffC = this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature;
        targetLowTempC -= currentTempDiffC;
        targetHighTempC -= currentTempDiffC;
      }
    }

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

    this.log('_run: referenceTemp:', this.currentProgram.currentReferenceTemperature.toFixed(1), 'C', (32 + this.currentProgram.currentReferenceTemperature / 5 * 9).toFixed(1), 'F');
    this.log('_run: currentTemp:', this.currentProgram.currentTemperature.toFixed(1), 'C', (32 + this.currentProgram.currentTemperature / 5 * 9).toFixed(1), 'F');
    this.log('_run: currentTempDiff:', (this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature).toFixed(1), 'C', ((this.currentProgram.currentTemperature - this.currentProgram.currentReferenceTemperature) / 5 * 9).toFixed(1), 'F');
  }

  _getSchedule() {
    this.log('_getSchedule:');
    const now = new Date();
    const weektime = (now.getDay() * 24 + now.getHours()) * 60 + now.getMinutes();

    if (!this.schedule.length) {
      return null;
    }

    // Find the approximate schedule for the current time.
    let start = 0;
    let end = this.schedule.length;
    while (start < end) {
      const i = Math.floor((start + end) / 2);
      if (this.schedule[i].weektime < weektime) {
        start = i + 1;
      }
      else {
        end = i;
      }
    }

    // Walk backwards from this point to find the exact match based on looping around the schedule list and handle triggers
    let pos = start - 1;
    for (;;) {
      const sched = this.schedule[pos];
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
          this.log('_getSchedule: program:', sched);
          return sched;
        }
      }
      pos = (this.schedule.length + pos - 1) % this.schedule.length;
      if (pos === start) {
        // No schedule to run
        this.log('_getSchedule: program: none');
        return null;
      }
    }
  }

  setSchedule(schedule) {
    const copy = [].concat(schedule);
    copy.sort((a, b) => a.weektime - b.weektime + (a.trigger ? 0.5 : 0) - (b.trigger ? 0.5 : 0));
    this.schedule = copy;
  }

  buildSchedule(schedule) {
    this.log('buildSchedule:', schedule);

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
            rooms: sched.rooms
          });
        });
      }
      else {
        this.log('buildSchedule: bad schedule:', sched);
      }
    });
    this.log('buildSchedule: result:', computed);

    return computed;
  }

  getDevices() {
    return this.devices;
  }
}

module.exports = new Smart();
