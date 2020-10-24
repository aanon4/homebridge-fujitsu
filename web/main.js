const FS = require('fs');
const Path = require('path');
const Base = require('./base');

class Main extends Base {

  constructor(smart, hap) {
    super('main');
    this.smart = smart;
    this.scheduleFile = Path.join(hap.user.persistPath(), 'smart-schedule.json');

    try {
      const info = FS.readFileSync(this.scheduleFile, { encoding: 'utf8' });
      Object.assign(this.state, JSON.parse(info));
    }
    catch (_) {
      this.createDefaultSliders();
      console.log(_);
    }
    this.state.rooms = [];
  }

  main(ctx) {
    this.state.rooms = [];
    const devices = this.smart.getDevices();
    for (let name in devices) {
      const device = devices[name];
      this.state.rooms.push({ title: name, environ: !!device.environ, motion: !!device.motion });
    }
    super.main(ctx);
  }

  createDefaultSliders() {
    this.state.sliders = [];
    [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ].forEach(title => {
      const day = { title: title, sliders: [] };
      for (let i = 0; i < 8; i++) {
        day.sliders.push({ low: 50, high: 80, time: '', trigger: null, rooms: {} });
      }
      this.state.sliders.push(day);
    });
  }

  async 'slider.update' (msg) {
    // id, time, high, low
    const id = msg.id.split('-');
    const title = id[1];
    const idx = parseInt(id[2]);
    const sliders = this.state.sliders.find(obj => obj.title == title);
    if (sliders) {
      const slider = sliders.sliders[idx];
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
    const json = {
      sliders: this.state.sliders
    };
    FS.writeFile(this.scheduleFile, JSON.stringify(json), { encoding: 'utf8' }, e => {
      if (e) {
        console.error('saveState:', e);
      }
    });
  }

  generateSchedule() {
    const sched = [];
    for (let day = 0; day < this.state.sliders.length; day++) {
      const sliders = this.state.sliders[day].sliders;
      for (let i = 0; i < sliders.length; i++) {
        const slider = sliders[i];
        if (slider.time) {
          const time = slider.time.split(':');
          const hour = parseInt(time[0], 10);
          const min = parseInt(time[1], 10);
          const weektime = (day * 24 + hour) * 60 + min;
          sched.push({
            weektime: weektime,
            high: slider.high,
            low: slider.low,
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
