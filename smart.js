const Feels = require('feels');
const Log = require('debug')('smart');

function Smart() {
  this.devices = {};
  this.sensors = null;
  this.poller = null;
  this.referenceDevice = null;
  this.currentTempC = null;
  this.currentTempDiffC = 0;
  this.feelsLike = false;
  this.holdTime = 0;
}

Smart.prototype.start = function(config) {
  this.schedule = this._buildSchedule(config.schedule);
  this.referenceDevice = config.reference;
  this.feelsLike = config.feelslike || false;
  this.holdTime = (config.hold || 60) * 60 * 1000;
  this.sensors = config.sensors;
  this.poller = setInterval(() => {
    this._run()
  }, (config.interval || 60) * 1000);
  this._run();
}

Smart.prototype.stop = function() {
  if (this.poller) {
    clearInterval(this.poller);
    this.poller = null;
  }
}

Smart.prototype._run = async function() {
  Log('_run:');
  try {
    await this.sensors.updateDevices(this.devices);
  }
  catch (e) {
    Log('_run: _updateDevice error:', e);
    return;
  }

  // Current reference temperature
  let referenceTempC = null;
  const refdevice = this.devices[this.referenceDevice];
  if (refdevice) {
    referenceTempC = refdevice.weather.temperature;
    // Dont adjust the reference temperature for feelsLike as this is what we're assuming the
    // thermostat is also reading, and we need to know the difference between that and our
    // calculated temperature.
  }

  // Generate a current temperature based on the temperature of the sensors.
  // These values are weighted, based on a schedule and/or motion associated
  // with the sensors.
  const program = this._getProgram();
  let totalWeight = 0;
  let totalWeightedTemperature = 0;
  for (let name in this.devices) {
    const device = this.devices[name];
    const prog = program[name];
    let weight = prog ? prog.occupied : 0;
    if (prog && device.motion && !device.motion.motion1800) {
      weight = prog.empty;
    }
    totalWeight += weight;
    let tempC = device.weather.temperature;
    if (this.feelsLike) {
      tempC = Feels.humidex(tempC, device.weather.humidity);
    }
    totalWeightedTemperature += tempC * weight;
    Log('_run:', name, tempC, 'C', weight);
  }

  if (totalWeight !== 0 && referenceTempC !== null) {
    this.currentTempC = totalWeightedTemperature / totalWeight;
    this.currentTempDiffC = this.currentTempC - referenceTempC;
  }
  else {
    this.currentTempC = null;
    this.currentTempDiffC = 0;
  }
  Log('_run: referenceTemp:', referenceTempC.toFixed(1), 'C', (32 + referenceTempC / 5 * 9).toFixed(1), 'F');
  Log('_run: currentTemp:', this.currentTempC.toFixed(1), 'C', (32 + this.currentTempC / 5 * 9).toFixed(1), 'F');
  Log('_run: currentTempDiff:', this.currentTempDiffC.toFixed(1), 'C', (this.currentTempDiffC / 5 * 9).toFixed(1), 'F');
}

Smart.prototype._getProgram = function() {
  Log('_getProgram:');
  const now = new Date();
  const dayOfWeek = now.getDay();
  const dayMinutes = now.getHours() * 60 + now.getMinutes();
  const program = {};
  for (let i = 0; i < this.schedule.length; i++) {
    const sched = this.schedule[i];
    if (dayOfWeek === sched.dayOfWeek && dayMinutes >= sched.fromTime && dayMinutes <= sched.toTime) {
      program[sched.device] = sched;
    }
  }
  Log('_getProgram: program:', program);
  return program;
}

Smart.prototype._buildSchedule = function(schedule) {
  Log('_buildSchedule:', schedule);

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
  const computed = [];
  schedule.forEach(sched => {
    const from = parseTime(sched.from);
    const to = parseTime(sched.to);
    const days = parseDayOfWeek(sched.day);
    if (from !== undefined && to !== undefined && days !== undefined) {
      days.forEach(day => {
        computed.push({
          dayOfWeek: day,
          fromTime: from,
          toTime: to,
          device: sched.room,
          occupied: sched.occupied,
          empty: sched.empty !== undefined ? sched.empty : sched.occupied
        });
      });
    }
    else {
      Log('_buildSchedule: bad schedule:', sched);
    }
  });
  Log('_buildSchedule: result:', computed);
  return computed;
}

module.exports = new Smart();
