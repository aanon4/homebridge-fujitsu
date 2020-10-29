const Base = require('./base');
const Template = require('./template');
const Bus = require('../bus');

class Main extends Base {

  constructor(smart, hap, log) {
    super('main', log);
    this._programUpdate = this._programUpdate.bind(this);
    this._deviceUpdate = this._deviceUpdate.bind(this);
    this._weatherUpdate = this._weatherUpdate.bind(this);

    this.smart = smart;
  }

  main(ctx) {
    this.updateState();
    super.main(ctx);
  }

  watch() {
    Bus.on('smart.devices.update', this._deviceUpdate);
    Bus.on('smart.program.update', this._programUpdate);
    Bus.on('weather.update', this._weatherUpdate);
    this.updateState();
    this.html('thermostat', Template.thermostat(this.state));
    this.html('weather', Template.weather(this.state));
  }

  unwatch() {
    Bus.off('smart.devices.update', this._deviceUpdate);
    Bus.off('smart.program.update', this._programUpdate);
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

  _weatherUpdate() {
    this.updateState();
    this.html('weather', Template.weather(this.state));
  }

  toU(v) {
    return this.smart.unit === 'f' ? Math.round(v / 5 * 9 + 32) : Math.round(v * 2) / 2;
  }

  toC(v) {
    return this.smart.unit === 'f' ? (v - 32) / 9 * 5 : v;
  }

  updateState() {
    if (this.state.selected !== this.smart.selectedSchedule) {
      this.state.selected = this.smart.selectedSchedule;
      this.state.schedule = this._smart2visual(this.smart.getSchedule(this.state.selected));
    }
    this.state.rooms = [];
    this.state.feelsLike = this.smart.feelsLike;
    const devices = this.smart.getDevices();
    for (let name in devices) {
      const device = devices[name];
      this.state.rooms.push({ title: name, environ: !!device.environ, motion: !!device.motion });
    }
    const p = this.smart.currentProgram;
    this.state.thermostat = {
      high: this.toU(p.programHighTempC),
      low: this.toU(p.programLowTempC),
      adjustedhigh: this.toU(p.adjustedHighTempC),
      adjustedlow: this.toU(p.adjustedLowTempC),
      current: this.toU(p.currentTemperatureC),
      mode: p.pauseUntil > Date.now() ? 'Hold' :
            this.smart.restoreAwaySchedule ? 'Auto Away' :
            p.targetMode === 1 ? 'Heat' :
            p.targetMode === 2 ? 'Cool' : 'Off'
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
    // id, time, high, low
    const id = msg.id.split('-');
    const title = id[1];
    const idx = parseInt(id[2]);
    const sched = this.state.schedule.find(obj => obj.title == title);
    if (sched) {
      const slider = sched.sliders[idx];
      if (slider) {
        slider.high = msg.high;
        slider.low = msg.low;
        slider.time = msg.time;
        slider.trigger = msg.trigger;
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

  _smart2visual(schedule) {
    function toT(wt) {
      const t = wt % (24 * 60);
      const h = Math.floor(t / 60);
      const m = `0${t % 60}`.substr(-2);
      return `${h}:${m}`;
    }
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
        time: toT(sched.weektime),
        low: this.toU(sched.low),
        high: this.toU(sched.high),
        tigger: sched.trigger && sched.trigger[0] && sched.trigger[0].room,
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
        day.sliders.push({ low: this.toU(10), high: this.toU(25), time: '', trigger: null, rooms: {} });
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
            high: this.toC(slider.high),
            low: this.toC(slider.low),
            trigger: slider.trigger ? [{ room: slider.trigger }] : null,
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
