const FS = require('fs');
const Path = require('path');
const Base = require('./base');
const Template = require('./template');
const Bus = require('../bus');

class Main extends Base {

  constructor(smart, hap) {
    super('main');
    this._programUpdate = this._programUpdate.bind(this);

    this.smart = smart;
    this.scheduleFile = Path.join(hap.user.persistPath(), 'smart-schedule.json');

    try {
      const info = JSON.parse(FS.readFileSync(this.scheduleFile, { encoding: 'utf8' }));
      this.state.schedule = info.schedule.map(sched => {
        return {
          title: sched.title,
          sliders: sched.sliders.map(slider => {
            return {
              high: this.toU(slider.high),
              low: this.toU(slider.low),
              time: slider.time,
              trigger: slider.trigger,
              rooms: slider.rooms
            };
          })
        };
      });
    }
    catch (_) {
      this.createDefaultSliders();
    }
    this.smart.setSchedule(this.generateSchedule());
    this.state.rooms = [];
    this.state.feelsLike = this.smart.feelsLike;
  }

  toU(v) {
    return this.smart.unit === 'f' ? Math.round(v / 5 * 9 + 32) : Math.round(v * 2) / 2;
  }

  toC(v) {
    return this.smart.unit === 'f' ? (v - 32) / 9 * 5 : v;
  }

  main(ctx) {
    this.updateState();
    super.main(ctx);
  }

  createDefaultSliders() {
    this.state.schedule = [];
    [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ].forEach(title => {
      const day = { title: title, sliders: [] };
      for (let i = 0; i < 8; i++) {
        day.sliders.push({ low: this.toU(10), high: this.toU(25), time: '', trigger: null, rooms: {} });
      }
      this.state.schedule.push(day);
    });
  }

  watch() {
    Bus.on('smart.devices.update', this._programUpdate);
    Bus.on('smart.program.update', this._programUpdate);
    Bus.on('weather.update', this._programUpdate);
  }

  unwatch() {
    Bus.off('smart.devices.update', this._programUpdate);
    Bus.off('smart.program.update', this._programUpdate);
    Bus.off('weather.update', this._programUpdate);
  }

  _programUpdate() {
    this.updateState();
    this.html('thermostat', Template.thermostat(this.state));
    if (this.smart.weather) {
      this.html('weather', Template.weather(this.state));
    }
  }

  updateState() {
    this.state.rooms = [];
    const devices = this.smart.getDevices();
    for (let name in devices) {
      const device = devices[name];
      this.state.rooms.push({ title: name, environ: !!device.environ, motion: !!device.motion });
    }
    const p = this.smart.currentProgram;
    this.state.thermostat = {
      high: this.toU(p.targetHighTempC),
      low: this.toU(p.targetLowTempC),
      current: this.toU(p.currentTemperature),
      mode: p.targetMode === 1 ? 'Heat' : p.targetMode === 2 ? 'Cool' : 'Off'
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
        this.saveState();
        this.smart.setSchedule(this.generateSchedule());
      }
    }
  }

  saveState() {
    const json = JSON.stringify({
      schedule: this.state.schedule.map(sched => {
        return {
          title: sched.title,
          sliders: sched.sliders.map(slider => {
            return {
              high: this.toC(slider.high),
              low: this.toC(slider.low),
              time: slider.time,
              trigger: slider.trigger,
              rooms: slider.rooms
            };
          })
        };
      })
    });
    FS.readFile(this.scheduleFile, { encoding: 'utf8' }, (e, info) => {
      if (!e) {
        if (info == json) {
          return;
        }
        FS.writeFile(`${this.scheduleFile}.bak`, info, { encoding: 'utf8' }, e => {
          if (e) {
            console.error('saveState: copy:', e);
          }
        });
      }
      FS.writeFile(this.scheduleFile, json, { encoding: 'utf8' }, e => {
        if (e) {
          console.error('saveState:', e);
        }
      });
    });
  }

  generateSchedule() {
    const sched = [];
    for (let day = 0; day < this.state.schedule.length; day++) {
      const sliders = this.state.schedule[day].sliders;
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
