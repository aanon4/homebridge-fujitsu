//
// Portions of this software adapted from the homebridge-thermostat project
// https://github.com/PJCzx/homebridge-thermostat/
// Licensed under Apache 2.0
// and
// https://github.com/smithersDBQ/homebridge-fujitsu
// (c) 2020 Ryan Beggs, MIT License
//

const Debounce = require('./debounce');

let Service;
let Characteristic;
let HbAPI;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HbAPI = homebridge;
  homebridge.registerAccessory("homebridge-fujitsu-smart", "FGLairSmartThermostat", Thermostat);
};

const HK_OFF = 0;
const HK_HEAT = 1;
const HK_COOL = 2;
const HK_AUTO = 3;

const HK_FAN_MANUAL = 0;
const HK_FAN_AUTO = 1;

const HK_FAN_QUIET = 10;
const HK_FAN_LOW = 30;
const HK_FAN_MEDIUM = 60;
const HK_FAN_HIGH = 100;

const FJ_OFF = 0;
const FJ_AUTO = 2;
const FJ_COOL = 3;
const FJ_DRY = 4;
const FJ_FAN = 5;
const FJ_HEAT = 6;

const FJ_FAN_QUIET = 0;
const FJ_FAN_LOW = 1;
const FJ_FAN_MEDIUM = 2;
const FJ_FAN_HIGH = 3;
const FJ_FAN_AUTO = 4;

const FJ2HK = { [FJ_OFF]: HK_OFF, [FJ_AUTO]: HK_AUTO, [FJ_COOL]: HK_COOL, [FJ_DRY]: HK_OFF, [FJ_FAN]: HK_OFF, [FJ_HEAT]: HK_HEAT };
const FANFJ2HK = { [FJ_FAN_QUIET]: HK_FAN_QUIET, [FJ_FAN_LOW]: HK_FAN_LOW, [FJ_FAN_MEDIUM]: HK_FAN_MEDIUM, [FJ_FAN_HIGH]: HK_FAN_HIGH };

const UNIT_C = 0;
const UNIT_F = 1;

class Thermostat {

  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.manufacturer = "Fujitsu General Ltd.";
    this.model = config.model || "DefaultModel";
    this.serial = config.serial || '';
    this.region = config.region || 'us'
    this.userName = config.username || '';
    this.password = config.password || '';
    this.temperatureDisplayUnits = config.temperatureDisplayUnits ? UNIT_F : UNIT_C;
    this.remote = {};

    this.informationService = new Service.AccessoryInformation();
    this.service = new Service.Thermostat(this.name);
    this.fan = new Service.Fanv2(`${this.name} Fan`);
    this.filter = new Service.Fanv2(`${this.name} Filter`, '3CEAB23D-0374-4C93-9B63-2889C7B4D335');

    this.api = require('./fglairAPI.js')
    this.api.setLog(this.log);
    this.api.setRegion(this.region);

    this.api.getAuth(this.userName, this.password, (err, token) => {
      this.api.setToken(token);
      this.api.getDevices((err, data) => {
        if (err) {
          this.log.debug(err, data);
        }
        else {
          this.serial = data[0];
          this.smart = require('./smart');
          this.smart.start(config.smart, this.temperatureDisplayUnits, this.log, HbAPI, () => {
            this.updateAll();
          }).catch(e => {
            this.log.error(e);
          });
        }
      });
    });
  }

  updateAll() {
    // Looks like the 'get_prop' call is necessary to update the current temperature
    this.api.setDeviceProp(this.serial, 'get_prop', 1, () => {
      this.api.getDeviceProp(this.serial, (err, properties) => {

        if (err) {
          this.log("Update Properties: " + err.message);
          return;
        }
        //this.log(JSON.stringify(properties, null, 2));

        properties.forEach(prop => {
          switch (prop.property.name) {
            case 'adjust_temperature':
              this.remote.adjust_temperature = prop.property.value;
              break;
            case 'operation_mode':
              this.remote.operation_mode = prop.property.value;
              break;
            case 'fan_speed':
              this.remote.fan_speed = prop.property.value;
              break;
            case 'display_temperature':
              this.remote.display_temperature = prop.property.value;
              break;
            default:
              break;
          }
        });
        this.smart.setRemoteState(this.remote);
        const program = this.smart.getProgram();
        const hkstate = {
          targetMode: this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value,
          targetTemperatureC: this.service.getCharacteristic(Characteristic.TargetTemperature).value,
          targetFanState: this.fan.getCharacteristic(Characteristic.TargetFanState).value,
          targetFanSpeed: this.fan.getCharacteristic(Characteristic.RotationSpeed).value
        };

        this.log.debug('remote', this.remote);
        this.log.debug('program', program);
        this.log.debug('hk', hkstate);

        if (this.smart.hold === program.program) {
          this.log('*** program on hold');
          // Program on hold. Update local characteristics only
          this.service.updateCharacteristic(Characteristic.TargetTemperature, parseInt(this.remote.adjust_temperature) / 10);
          this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, FJ2HK[this.remote.operation_mode]);
          if (this.remote.fan_speed == FJ_FAN_AUTO) {
            this.fan.updateCharacteristic(Characteristic.TargetFanState, HK_FAN_AUTO);
          }
          else {
            this.fan.updateCharacteristic(Characteristic.TargetFanState, HK_FAN_MANUAL);
            this.fan.updateCharacteristic(Characteristic.RotationSpeed, FANFJ2HK[this.remote.fan_speed]);
          }
        }
        else if (this.smart.hold === null &&
            (hkstate.targetMode != FJ2HK[this.remote.operation_mode] ||
             hkstate.targetTemperatureC != parseInt(this.remote.adjust_temperature) / 10 ||
             (hkstate.targetFanState == HK_FAN_AUTO && this.remote.fan_speed != FJ_FAN_AUTO) ||
             (hkstate.targetFanState == HK_FAN_MANUAL && this._mapFanSpeed(hk.targetFanSpeed) != this.remote.fan_speed))
        ) {
          // Change made remotely - put program on hold
          this.log('*** pausing program');
          this.smart.pauseProgram();
        }
        else {
          // Update thermostat from program (use setCharacteristic so we call the relevant 'set' listeners)
          this.service.setCharacteristic(Characteristic.TargetTemperature, program.targetTemperatureC);
          this.service.setCharacteristic(Characteristic.TargetHeatingCoolingState, program.targetMode);

          // Set the fan
          if (program.fanSpeed === 'auto') {
            this.fan.setCharacteristic(Characteristic.TargetFanState, HK_FAN_AUTO);
          }
          else {
            this.fan.setCharacteristic(Characteristic.TargetFanState, HK_FAN_MANUAL);
            this.fan.setCharacteristic(Characteristic.RotationSpeed, program.fanSpeed);
          }

          // Reset 'hold'. This indicates we have set a program and will allow us to check for remote overrides.
          // We have to post this so we let the async charateristic changes happen first.
          setTimeout(() => {
            this.smart.resumeProgram();
          }, 0);
          this.log('*** setting program');
        }

        this.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, FJ2HK[this.remote.operation_mode]);
        this.service.updateCharacteristic(Characteristic.CurrentTemperature, parseInt(this.remote.display_temperature) / 100 - 50);
      });
    });
  }

  _mapFanSpeed(val) {
    if (val <= HK_FAN_QUIET) {
      return FJ_FAN_QUIET;
    }
    else if (val <= HK_FAN_LOW) {
      return FJ_FAN_LOW;
    }
    else if (val <= HK_FAN_MEDIUM) {
      return FJ_FAN_MEDIUM;
    }
    else {
      return FJ_FAN_HIGH;
    }
  }

  updateRemote() {
    this.log.debug('updateRemote:');

    function mapTemp(val) {
      return Math.round(val * 2) * 5;
    }

    const nremote = {};

    switch (this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value) {
      case HK_OFF:
        if (this.fan.getCharacteristic(Characteristic.TargetFanState).value === HK_FAN_AUTO) {
          nremote.operation_mode = FJ_OFF;
        }
        else {
          const speed = this.fan.getCharacteristic(Characteristic.RotationSpeed).value;
          if (speed === 0) {
            nremote.operation_mode = FJ_OFF;
          }
          else {
            nremote.operation_mode = FJ_FAN;
            nremote.fan_speed = this._mapFanSpeed(speed);
          }
        }
        break;
      case HK_HEAT:
        nremote.operation_mode = FJ_HEAT;
        nremote.adjust_temperature = mapTemp(this.service.getCharacteristic(Characteristic.TargetTemperature).value);
        if (this.fan.getCharacteristic(Characteristic.TargetFanState).value === HK_FAN_AUTO) {
          nremote.fan_speed = FJ_FAN_AUTO;
        }
        else {
          nremote.fan_speed = this._mapFanSpeed(this.fan.getCharacteristic(Characteristic.RotationSpeed).value);
        }
        break;
      case HK_COOL:
        nremote.operation_mode = FJ_COOL;
        nremote.adjust_temperature = mapTemp(this.service.getCharacteristic(Characteristic.TargetTemperature).value);
        if (this.fan.getCharacteristic(Characteristic.TargetFanState).value === HK_FAN_AUTO) {
          nremote.fan_speed = FJ_FAN_AUTO;
        }
        else {
          nremote.fan_speed = this._mapFanSpeed(this.fan.getCharacteristic(Characteristic.RotationSpeed).value);
        }
        break;
      case HK_AUTO:
      default:
        nremote.operation_mode = FJ_AUTO;
        nremote.adjust_temperature = mapTemp(this.service.getCharacteristic(Characteristic.TargetTemperature).value);
        if (this.fan.getCharacteristic(Characteristic.TargetFanState).value === HK_FAN_AUTO) {
          nremote.fan_speed = FJ_FAN_AUTO;
        }
        else {
          nremote.fan_speed = mapFanSpeed(this.fan.getCharacteristic(Characteristic.RotationSpeed).value);
        }
        break;
    }

    // Remove properties we don't need to change
    let pause = false;
    for (let key in nremote) {
      if (nremote[key] != this.remote[key]) {
        this.remote[key] = nremote[key];
        this.log.debug('change:', key, nremote[key]);
        this.api.setDeviceProp(this.serial, key, nremote[key], () => {});
        pause = true;
      }
    }
    if (pause) {
      this.smart.pauseProgram();
    }
  }

  setDisplayUnits(val, cb) {
    this.log.debug('setDisplayUnits', val);
    this.temperatureDisplayUnits = val ? UNIT_F : UNIT_C;
    this.smart.unit = this.temperatureDisplayUnits ? 'f' : 'c';
    cb(null);
  }

  setFilter(val, cb) {
    this.smart.setAirClean(val);
    cb(null);
  }

  getFilter(cb) {
    cb(null, this.smart.airclean.speed);
  }

  getServices() {
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model);

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature);
    this.service
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState);

    this.service
      .setCharacteristic(Characteristic.Name, this.name);

    this.service
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on('set', this.setDisplayUnits.bind(this))
      .value = this.temperatureDisplayUnits;

    const updateRemote = Debounce(this.updateRemote, this);
    const update = (_, cb) => {
      updateRemote();
      cb(null);
    }

    this.service
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('set', update);

    this.service
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('set', update);

    this.fan
      .getCharacteristic(Characteristic.TargetFanState)
      .on('set', update);

    this.fan
      .getCharacteristic(Characteristic.RotationSpeed)
      .on('set', update);

    this.filter
      .getCharacteristic(Characteristic.RotationSpeed)
      .on('set', this.setFilter.bind(this))
      .on('get', this.getFilter.bind(this));

    this.service.isPrimaryService = true;
    this.service.linkedServices = [ this.fan, this.filter ];

    return [ this.informationService, this.service, this.fan, this.filter ];
  }
}
