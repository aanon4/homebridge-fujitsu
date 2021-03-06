const Base = require('./base');
const Debounce = require('../../debounce');
const Template = require('./template');
const Bus = require('../bus');

class Main extends Base {

  constructor(smart) {
    super(smart, 'main');
    this.smart = smart;

    this._programUpdate = Debounce(this._programUpdate, this);
    this._scheduleUpdate = Debounce(this._scheduleUpdate, this);
    this._deviceUpdate = Debounce(this._deviceUpdate, this);
    this._weatherUpdate = Debounce(this._weatherUpdate, this);
  }

  main(ctx) {
    this.updateState();
    super.main(ctx);
  }

  watch() {
    Bus.on('smart.devices.update', this._deviceUpdate);
    Bus.on('smart.program.update', this._programUpdate);
    Bus.on('smart.schedule.update', this._scheduleUpdate);
    Bus.on('weather.update', this._weatherUpdate);
    this.updateState();
    this.html('thermostat', Template.thermostat(this.state));
    this.html('weather', Template.weather(this.state));
  }

  unwatch() {
    Bus.off('smart.devices.update', this._deviceUpdate);
    Bus.off('smart.program.update', this._programUpdate);
    Bus.off('smart.schedule.update', this._scheduleUpdate);
    Bus.off('weather.update', this._weatherUpdate);
  }

  _programUpdate() {
    const oldSchedule = this.state.selected;
    this.updateState();
    this.html('thermostat', Template.thermostat(this.state));
    this.html('menu', Template.menu(this.state));
    if (this.state.selected !== oldSchedule) {
      this.html('schedule', Template.schedule(this.state));
    }
  }

  _deviceUpdate() {
    const before = JSON.stringify(this.state.rooms);
    this.updateState();
    if (JSON.stringify(this.state.rooms) != before) {
      this.html('schedule', Template.schedule(this.state));
    }
  }

  _scheduleUpdate() {
    this.state.schedule = this._smart2visual(this.smart.getSchedule(this.state.selected));
    this.html('schedule', Template.schedule(this.state));
  }

  _weatherUpdate() {
    this.updateState();
    this.html('weather', Template.weather(this.state));
  }

  toU(v) {
    return this.smart.unit === 'f' ? Math.round(v / 5 * 9 + 32) : Math.round(v * 2) / 2;
  }

  toNU(v) {
    if (typeof v !== 'number') {
      return '-';
    }
    else if (this.smart.unit === 'f') {
      return Math.round(v / 5 * 9 + 32);
    }
    else {
      return Math.round(v * 2) / 2;
    }
  }

  toC(v) {
    return this.smart.unit === 'f' ? Math.round(2 * (v - 32) / 9 * 5) / 2 : v;
  }

  toT(wt) {
    const t = wt % (24 * 60);
    const h = `0${Math.floor(t / 60)}`.substr(-2);
    const m = `0${t % 60}`.substr(-2);
    return `${h}:${m}`;
  }

  updateState() {
    this.state.unit = this.smart.unit.toUpperCase();
    if (this.state.selected !== this.smart.selectedSchedule) {
      this.state.selected = this.smart.selectedSchedule;
      this.state.schedule = this._smart2visual(this.smart.getSchedule(this.state.selected));
    }
    this.state.rooms = [];
    this.state.feelsLike = this.smart.feelsLike;
    const devices = this.smart.getDevices();
    for (let name in devices) {
      const device = devices[name];
      this.state.rooms.push({
        title: name,
        environ: !!device.environ,
        motion: !!device.motion,
        magnet: !!device.magnet,
        temperature: device.environ && this.toU('feelslike' in device.environ ? device.environ.feelslike : device.environ.temperature)
      });
    }
    const p = this.smart.currentProgram;
    this.state.thermostat = {
      high: this.toNU(p.programHighTempC),
      low: this.toNU(p.programLowTempC),
      adjustedhigh: this.toNU(p.adjustedHighTempC),
      adjustedlow: this.toNU(p.adjustedLowTempC),
      current: this.toNU(this.smart.referenceTemperature),
      target: this.toNU(p.targetTemperatureC),
      remote: this.toNU(this.smart.remoteTargetTemperatureC),
      mode: this.smart.hold === p.program ? 'Override' :
            this.smart.restoreAwaySchedule ? 'Away' :
            p.targetMode === 1 ? 'Heat' :
            p.targetMode === 2 ? 'Cool' :
            p.targetMode === 0 && p.fanSpeed ? 'Fan' : 'Off'
    };
    const away = this.smart.awaySchedule;
    this.state.autoaway = {
      enable: away.enable,
      from: this.toT(away.from),
      to: this.toT(away.to),
      wait: away.wait
    };
    const eco = this.smart.eco;
    this.state.eco = {
      enable: eco.enable,
      active: this.smart.ecoActive() && this.state.thermostat.mode !== 'Override',
      days: eco.days,
      from: this.toT(eco.from),
      to: this.toT(eco.to),
      guard: eco.guard,
      gDelta: eco.gDelta,
      eDelta: eco.eDelta
    };
    const w = this.smart.weather && this.smart.weather.weather;
    if (w) {
      this.state.weather = {
        name: w.name,
        temperature: `${this.toU(w.temperature)} &deg;${this.smart.unit === 'f' ? 'F' : 'C'}`,
        humidity: w.humidity,
        description: w.description,
        icon: w.icon
      };
    }
  }

  async 'slider.update' (msg) {
    const id = msg.id.split('-');
    const title = id[1];
    const idx = parseInt(id[2]);
    const sched = this.state.schedule.find(obj => obj.title == title);
    if (sched) {
      const slider = sched.sliders[idx];
      if (slider) {
        if (msg.low > msg.high) {
          const high = msg.low;
          msg.low = msg.high;
          msg.high = high;
        }
        slider.high = msg.high;
        slider.low = msg.low;
        slider.time = msg.time;
        slider.trigger = msg.trigger;
        slider.fan = msg.fan;
        slider.rooms = msg.rooms;
        this.smart.setSchedule(this.state.selected, this._visual2smart(this.state.schedule));
      }
    }
  }

  async 'schedule.select' (msg) {
    switch (msg.schedule) {
      case 'normal':
      case 'vacation':
      case 'away':
        if (msg.schedule !== this.state.selected) {
          this.smart.setScheduleTo(msg.schedule);
        }
        break;
      default:
        break;
    }
  }

  async 'sliders.copy' (msg) {
    this.state.selected = null;
    this.smart.copyScheduleDay(msg.from, msg.to);
  }

  async 'schedule.resume' () {
    this.smart.resumeProgram(-1);
    this.smart.onUpdateCallback();
  }

  async 'autoaway.update' (msg) {
    this.smart.setAutoAway(msg);
    this.updateState();
    this.html('menu', Template.menu(this.state));
  }

  async 'eco.update' (msg) {
    this.smart.setEco(msg);
    this.updateState();
    this.html('menu', Template.menu(this.state));
  }

  _smart2visual(schedule) {
    const days = [
      { title: 'Sunday', sliders:[] },
      { title: 'Monday', sliders:[] },
      { title: 'Tuesday', sliders:[] },
      { title: 'Wednesday', sliders:[] },
      { title: 'Thursday', sliders:[] },
      { title: 'Friday', sliders:[] },
      { title: 'Saturday', sliders:[] }
    ];
    schedule.forEach(sched => {
      const day = days[Math.floor(sched.weektime / (24 * 60))];
      day.sliders.push({
        time: this.toT(sched.weektime),
        low: this.toU(sched.low),
        high: this.toU(sched.high),
        trigger: sched.trigger && sched.trigger[0] && sched.trigger[0].room,
        fan: sched.fan,
        rooms: Object.keys(sched.rooms).reduce((rooms, room) => {
          rooms[room] = {
            always: !!(sched.rooms[room].empty && sched.rooms[room].occupied),
            occupied: !sched.rooms[room].empty
          }
          return rooms;
        }, {})
      });
    });
    days.forEach(day => {
      while (day.sliders.length < 8) {
        day.sliders.push({ low: this.toU(10), high: this.toU(25), time: '', trigger: null, fan: 'auto', rooms: {} });
      }
    });
    return days;
  }

  _visual2smart(schedule) {
    const sched = [];
    for (let day = 0; day < schedule.length; day++) {
      const sliders = schedule[day].sliders;
      for (let i = 0; i < sliders.length; i++) {
        const slider = sliders[i];
        if (slider.time) {
          const time = slider.time.split(':');
          const hour = parseInt(time[0], 10);
          const min = parseInt(time[1], 10);
          const weektime = (day * 24 + hour) * 60 + min;
          sched.push({
            weektime: weektime,
            high: slider.high == 0 ? null : this.toC(slider.high),
            low: slider.low == 0 ? null : this.toC(slider.low),
            trigger: slider.trigger ? [{ room: slider.trigger }] : null,
            fan: slider.fan,
            rooms: Object.keys(slider.rooms).reduce((rooms, room) => {
              rooms[room] = {
                occupied: slider.rooms[room].always || slider.rooms[room].occupied ? 100 : 0,
                empty: slider.rooms[room].always ? 100 : 0
              };
              return rooms;
            }, {})
          });
        }
      }
    }
    return sched;
  }

}

module.exports = Main;
