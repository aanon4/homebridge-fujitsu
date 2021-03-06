const Mihome = require('node-mihome');

function Miio() {
  this.username = null;
  this.password = null;
  this.region = null;
}

Miio.prototype.login = async function(config, log) {
  this.log = log;
  this.log.debug('_login:');
  this.username = config.username;
  this.password = config.password;
  this.region = config.region || 'cn';
  return await Mihome.miCloudProtocol.login(this.username, this.password);
}

Miio.prototype.updateDevices = async function(devices) {
  this.log.debug('updateDevices:');
  function extractName(name) {
    const post = [ ' Temp', ' Move', ' Motion', ' Door', ' Window', ' Contact' ];
    for (let i = 0; i < post.length; i++) {
      let idx = name.indexOf(post[i]);
      if (idx !== -1) {
        return name.substring(0, idx);
      }
    }
    return name;
  }
  const miidevices = await Mihome.miCloudProtocol.getDevices(null, { country: this.region });
  const now = Math.floor(Date.now() / 1000);
  miidevices.forEach(dev => {
    this.log.debug('updateDevices: device', dev);
    try {
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
          const lastmotion = now - JSON.parse(dev.event['event.motion'] || '{}').timestamp;
          (devices[name] || (devices[name] = {})).motion = {
            online: dev.isOnline,
            motion: lastmotion < 1800,
          };
          break;
        case 'lumi.sensor_magnet.v2':
        case 'lumi.sensor_magnet.aq2':
          const lastopen = now - JSON.parse(dev.event['event.open'] || '{}').timestamp;
          const lastclose = now - JSON.parse(dev.event['event.close'] || '{}').timestamp;
          (devices[name] || (devices[name] = {})).magnet = {
            online: dev.isOnline,
            open: lastopen < 1800,
            close: lastclose < 1800
          };
          break;
      }
    }
    catch (e) {
      this.log.debug('updateDevices: exception:', e);
    }
  });

  this.log.debug('updateDevices:', devices);
}

module.exports = new Miio();
