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
      responsive: true
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
        domain: [ 0, 0.3 ]
      },
      yaxis2: {
        color: FG,
        linecolor: FG,
        domain: [ 0.35, 1 ]
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
      }
    };
    this.state.data = [];

    const items = DataLog.getItems();
    if (!items.length) {
      return;
    }

    const target = {
      name: 'Target',
      x: [],
      y: [],
      mode: 'line',
      line: {
        width: 3
      }
    };
    const reference = {
      name: 'Measured',
      x: [],
      y: [],
      mode: 'line',
      line: {
        width: 3
      }
    };
    const temps = {};
    items.forEach(item => {
      item.devices.forEach(device => {
        const time = this.toT(item.time);
        target.x.push(time);
        target.y.push(this.toU(item.remote.target));
        reference.x.push(time);
        reference.y.push(this.toU(item.remote.temp));
        if (device.environ) {
          const temp = temps[device.name] || (temps[device.name] = {
            name: device.name,
            x: [],
            y: [],
            mode: 'lines',
            line: {
              width: 1
            },
            yaxis: 'y2'
          });
          temp.x.push(time),
          temp.y.push(this.toU(device.environ.temperature));
        }
      });
    });
    Object.values(temps).forEach(temp => this.state.data.push(temp));
    this.state.data.push(target, reference);
  }

  toU(v) {
    return this.smart.unit === 'c' ? v : Math.round(10 * (v / 5 * 9 + 32)) / 10;
  }

  toT(t) {
    return Moment(t).format('YYYY-MM-DD HH:mm');
  }

}

module.exports = Graph;
