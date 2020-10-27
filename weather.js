const Bus = require('./bus');
const Weather = require('openweather-apis');

const POLL_INTERVAL = 5 * 60 * 1000;

class MyWeather {

  start(config) {
    Weather.setAPPID(config.key);
    Weather.setLang(config.lang || 'en');
    if (config.city) {
      Weather.setCity(config.city);
    }
    else if (config.latLong) {
      Weather.setCoordinate(config.latlong[0], config.latlong[1]);
    }
    else if (config.cityId) {
      Weather.setCityId(config.cityId);
    }
    else if (config.zipcode) {
      Weather.setZipCode(config.zipcode);
    }
    Weather.setUnits('metric');

    const fetchWeather = () => {
      Weather.getAllWeather((e, json) => {
        this.weather = {
          name: json.name,
          temperature: json.main.temp,
          humidity: json.main.humidity,
          description: json.weather[0].description,
          icon: `https://openweathermap.org/img/wn/${json.weather[0].icon}@4x.png`
        }
        Bus.emit('weather.update', this.weather);
      });
    }
    this.poller = setInterval(fetchWeather, POLL_INTERVAL);
    fetchWeather();
  }

  stop() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

}

module.exports = new MyWeather();
