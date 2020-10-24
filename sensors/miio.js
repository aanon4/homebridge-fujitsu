const Mihome = require('node-mihome');

function Miio() {
  this.username = null;
  this.password = null;
  this.region = null;
}

Miio.prototype.login = async function(config, log) {
  this.log = log;
  this.log('_login:');
  this.username = config.username;
  this.password = config.password;
  this.region = config.region || 'cn';
  return await Mihome.miCloudProtocol.login(this.username, this.password);
}

Miio.prototype.updateDevices = async function(devices) {
  this.log('updateDevices:');
  function extractName(name) {
    const post = [ ' Temp', ' Move', ' Motion' ];
    for (let i = 0; i < post.length; i++) {
      let idx = name.indexOf(post[i]);
      if (idx !== -1) {
        return name.substring(0, idx);
      }
    }
    return name;
  }
  const miidevices = await Mihome.miCloudProtocol.getDevices(null, { country: this.region });
  miidevices.forEach(dev => {
    this.log('updateDevices: device', dev);
    const name = extractName(dev.name);
    switch (dev.model) {
      case 'lumi.weather.v1':
        (devices[name] || (devices[name] = {})).environ = {
          online: dev.isOnline,
          temperature: dev.prop.temperature / 100,
          humidity: dev.prop.humidity / 100,
          pressure: dev.prop.pressure / 100
        };
        break;
      case 'lumi.sensor_motion.aq2':
        (devices[name] || (devices[name] = {})).motion = {
          online: dev.isOnline,
          motion60: dev.event['prop.no_motion_60'] != '1',
          motion120: dev.event['prop.no_motion_120'] != '1',
          motion300: dev.event['prop.no_motion_300'] != '1',
          motion600: dev.event['prop.no_motion_600'] != '1',
          motion1200: dev.event['prop.no_motion_1200'] != '1',
          motion1800: dev.event['prop.no_motion_1800'] != '1'
        };
        break;
    }
  });

  this.log('updateDevices:', devices);
}

module.exports = new Miio();
