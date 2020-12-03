const Moment = require('moment');
const Base = require('./base');
const DataLog = require('../datalog');

class Graph extends Base {

  constructor(smart) {
    super(smart, 'graph');
    this.smart = smart;
  }

  main(ctx) {
    this.updateGraph();
    super.main(ctx);
  }

  updateGraph() {
    const BG = '#303030';
    const FG = '#e0e0e0';

    this.state.config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: [
        'toImage',
        'toggleSpikelines',
        'hoverClosestCartesian',
        'hoverCompareCartesian',
        'zoomIn2d',
        'zoomOut2d',
        'autoScale2d'
      ]
    };
    this.state.layout = {
      paper_bgcolor: BG,
      plot_bgcolor: BG,
      xaxis: {
        color: FG,
        linecolor: FG,
      },
      yaxis: {
        color: FG,
        linecolor: FG,
        domain: [ 0, 0.3 ],
        ticksuffix: `&deg;${this.smart.unit.toUpperCase()}`
      },
      yaxis2: {
        color: FG,
        linecolor: FG,
        domain: [ 0.35, 1 ],
        ticksuffix: `&deg;${this.smart.unit.toUpperCase()}`
      },
      title: {
        text: 'Heating',
        font: {
          color: FG
        }
      },
      legend: {
        font: {
          color: FG
        }
      },
      margin: {
        t: 30,
        r: 0,
        b: 40,
        l: 50
      }
    };
    this.state.data = [];

    const items = DataLog.getItems();
    if (!items.length) {
      return;
    }

    const target = {
      name: 'Desired',
      x: [],
      y: [],
      mode: 'line'
    };
    const indoor = {
      name: 'Indoor',
      x: [],
      y: [],
      mode: 'line'
    };
    const outdoor = {
      name: 'Outdoor',
      x: [],
      y: [],
      mode: 'line'
    };
    const temps = {};
    items.forEach(item => {
      item.devices.forEach(device => {
        const time = this.toT(item.time);
        target.x.push(time);
        target.y.push(this.toU(item.remote.target));
        indoor.x.push(time);
        indoor.y.push(this.toU(item.remote.temp));
        if (device.environ) {
          const temp = temps[device.name] || (temps[device.name] = {
            name: device.name,
            x: [],
            y: [],
            mode: 'lines',
            yaxis: 'y2'
          });
          temp.x.push(time),
          temp.y.push(this.toU(device.environ.temperature));
        }
        if (item.weather) {
          outdoor.x.push(time);
          outdoor.y.push(this.toU(item.weather.temperature));
        }
      });
    });
    const names = Object.keys(temps);
    names.sort();
    names.forEach(name => this.state.data.push(temps[name]));
    this.state.data.push(target, indoor, outdoor);
  }

  toU(v) {
    return this.smart.unit === 'c' ? v : Math.round(10 * (v / 5 * 9 + 32)) / 10;
  }

  toT(t) {
    return Moment(t).format('YYYY-MM-DD HH:mm');
  }

}

module.exports = Graph;
