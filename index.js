//
// Portions of this software adapted from the homebridge-thermostat project
// https://github.com/PJCzx/homebridge-thermostat/
// Licensed under Apache 2.0
// and
// https://github.com/smithersDBQ/homebridge-fujitsu
// (c) 2020 Ryan Beggs, MIT License
//

const { calcTTL } = require('node-persist');

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
const HK2FJ = { [HK_OFF]: FJ_OFF, [HK_HEAT]: FJ_HEAT, [HK_COOL]: FJ_COOL, [HK_AUTO]: FJ_AUTO };

class Thermostat {

  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.manufacturer = "Fujitsu General Ltd.";
    this.model = config.model || "DefaultModel";
    this.serial = config.serial || '';
    this.region = config.region || 'us'
    this.interval = config.interval * 1000 || 10000;
    this.userName = config.username || '';
    this.password = config.password || '';
    this.temperatureDisplayUnits = config.temperatureDisplayUnits || 0;

    this.log.debug(this.name);
    this.service = new Service.Thermostat(this.name);
    this.fan = new Service.Fanv2(`${this.name} Fan`);
    this.api = require('./fglairAPI.js')
    this.api.setLog(this.log);
    this.api.setRegion(this.region);

    this.smart = require('./smart');
    this.smart.start(config.smart, this.log, HbAPI).catch(e => {
      this.log.error(e);
    }).then(() => {
      this.api.getAuth(this.userName, this.password, (err, token) => {
        this.api.setToken(token);
        this.api.getDevices((err, data) => {
          if (err) {
            this.log.debug(err, data);
          }
          else {
            this.serial = data[0]; //Only one thermostat is supported
            this.updateAll(this);
            setInterval(this.updateAll, this.interval, this);
          }
        });
      });
    });
  }

  updateAll(ctx) {
    ctx.api.getDeviceProp(ctx.serial, (err, properties) => {

      if (err) {
        ctx.log("Update Properties: " + err.message);
        return;
      }
      //ctx.log(JSON.stringify(properties, null, 2));

      const remote = {
        targetHeatingCoolingState: null,
        targetTemperatureC: null,
        targetFanSpeed: null,
        targetFanState: null,
        currentTemperatureC: null
      };
      properties.forEach(prop => {
        switch (prop.property.name) {
          case 'adjust_temperature':
            remote.targetTemperatureC = parseInt(prop.property.value) / 10;
            break;
          case 'operation_mode':
            remote.targetHeatingCoolingState = FJ2HK[prop.property.value];
            break;
          case 'fan_speed':
            switch (parseInt(prop.property.value)) {
              case FJ_FAN_QUIET:
                remote.targetFanSpeed = HK_FAN_QUIET;
                remote.targetFanState = HK_FAN_MANUAL;
                break;
              case FJ_FAN_LOW:
                remote.targetFanSpeed = HK_FAN_LOW;
                remote.targetFanState = HK_FAN_MANUAL;
                break;
              case FJ_FAN_MEDIUM:
                remote.targetFanSpeed = HK_FAN_MEDIUM;
                remote.targetFanState = HK_FAN_MANUAL;
                break;
              case FJ_FAN_HIGH:
                remote.targetFanSpeed = HK_FAN_HIGH;
                remote.targetFanState = HK_FAN_MANUAL;
                break;
              case FJ_FAN_AUTO:
                remote.targetFanSpeed = HK_FAN_QUIET;
                remote.targetFanState = HK_FAN_AUTO;
                break;
              default:
                break;
            }
            break;
          case 'display_temperature':
            remote.currentTemperatureC = parseInt(prop.property.value) / 100 - 50; // 7125 when 70F on app, 7075 when 69
            break;
          default:
            break;
        }
      });

      ctx.smart.setReferenceTemperature(remote.currentTemperatureC);
      const program = ctx.smart.getProgram();

      const hkstate = {
        targetMode: ctx.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value,
        targetTemperatureC: ctx.service.getCharacteristic(Characteristic.TargetTemperature).value,
        targetFanState: ctx.fan.getCharacteristic(Characteristic.TargetFanState).value,
        targetFanSpeed: ctx.fan.getCharacteristic(Characteristic.RotationSpeed).value
      };

      // Without a target tempoerature, we don't make any changes
      if (program.targetTemperatureC !== null) {

        if (Date.now() < program.pauseUntil) {
          ctx.log('*** program on hold');
          // Program on hold. Update local characteristics only
          ctx.service.updateCharacteristic(Characteristic.TargetTemperature, remote.targetTemperatureC);
          ctx.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, remote.targetHeatingCoolingState);
          ctx.fan.updateCharacteristic(Characteristic.RotationSpeed, remote.targetFanSpeed);
          ctx.fan.updateCharacteristic(Characteristic.TargetFanState, remote.targetFanState);
        }
        // If 'pauseUntil' is zero, we have have set a program. If that's not what we read back then a remote override
        // was made and we should honor it for a given hold time.
        else if (program.pauseUntil === 0 &&
          (hkstate.targetMode != remote.targetHeatingCoolingState ||
           hkstate.targetTemperatureC != remote.targetTemperatureC ||
           hkstate.targetFanState != remote.targetFanState ||
           (hkstate.targetFanState === HK_FAN_MANUAL && ctx.service.getCharacteristic(Characteristic.RotationSpeed).value != remote.targetFanSpeed))) {
            // Change made remotely - put program on hold
            ctx.log('*** pausing program');
            ctx.smart.pauseProgram();
        }
        else {
          // Update thermostat from program (use setCharacteristic so we call the relevant 'set' listeners)
          if (program.targetTemperatureC != hkstate.targetTemperatureC) {
            ctx.service.setCharacteristic(Characteristic.TargetTemperature, program.targetTemperatureC);
          }
          if (program.targetMode != hkstate.targetMode) {
            ctx.service.setCharacteristic(Characteristic.TargetHeatingCoolingState, program.targetMode);
          }

          if (program.fanSpeed === 'auto') {
            if (hkstate.targetFanState !== HK_FAN_AUTO) {
              ctx.fan.setCharacteristic(Characteristic.TargetFanState, HK_FAN_AUTO);
            }
          }
          else {
            if (hkstate.targetFanState !== HK_FAN_MANUAL) {
              ctx.fan.setCharacteristic(Characteristic.TargetFanState, HK_FAN_MANUAL);
            }
            if (hkstate.targetFanSpeed !== program.fanSpeed) {
              ctx.fan.setCharacteristic(Characteristic.RotationSpeed, program.fanSpeed);
            }
          }

          // Reset 'pauseUntil'. This indicates we have set a program and will allow us to check for remote overrides.
          ctx.smart.resumeProgram(0);
          ctx.log('*** setting program');
        }
      }
      else {
        ctx.log('*** no change');
      }

      ctx.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, remote.targetHeatingCoolingState);
      if (program.currentTemperatureC === null) {
        // If we don't know the current temperature (no sensors), we just have to use the thermostat current temperature.
        ctx.service.updateCharacteristic(Characteristic.CurrentTemperature, remote.currentTemperatureC);
      }
      else {
        ctx.service.updateCharacteristic(Characteristic.CurrentTemperature, program.currentTemperatureC);
      }

      ctx.log("[" + ctx.serial + "] temp: " + remote.targetTemperatureC + "C, mode: " + remote.targetHeatingCoolingState);
    });
  }

  setTargetHeatingCoolingState(val, cb) {
    this.log.debug("Setting Target Mode to HK=" + val + " FJ=" + HK2FJ[val]);
    this.smart.pauseProgram();
    this.api.setDeviceProp(this.serial, 'operation_mode', HK2FJ[val], cb);
  }

  setTargetTemperature(val, cb) {
    this.log.debug("Setting Temperature to " + val);
    this.smart.pauseProgram();
    this.api.setDeviceProp(this.serial, 'adjust_temperature', Math.round(val * 2) * 5, cb);
  }

  setTargetFanState(val, cb) {
    this.log.debug('setTargetFanState', val ? 'automatic' : 'manual');
    this.smart.pauseProgram();
    if (val === HK_FAN_MANUAL) {
      this.setRotationSpeed(this.fan.getCharacteristic(Characteristic.RotationSpeed).value, cb);
    }
    else {
      // Automatic
      this.api.setDeviceProp(this.serial, 'fan_speed', FJ_FAN_AUTO, cb);
    }
  }

  setRotationSpeed(val, cb) {
    this.log.debug('setRotationSpeed', val);
    this.smart.pauseProgram();
    let fanSpeed = FJ_FAN_AUTO;
    if (val <= HK_FAN_QUIET) {
      fanSpeed = FJ_FAN_QUIET;
    }
    else if (val <= HK_FAN_LOW) {
      fanSpeed = FJ_FAN_LOW;
    }
    else if (val <= HK_FAN_MEDIUM) {
      fanSpeed = FJ_FAN_MEDIUM;
    }
    else {
      fanSpeed = FJ_FAN_HIGH;
    }
    this.api.setDeviceProp(this.serial, 'fan_speed', fanSpeed, cb);
  }

  getServices() {
    this.informationService = new Service.AccessoryInformation();
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
      .setCharacteristic(Characteristic.TemperatureDisplayUnits, this.temperatureDisplayUnits);

    this.service
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('set', this.setTargetHeatingCoolingState.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('set', this.setTargetTemperature.bind(this));

    this.fan
      .getCharacteristic(Characteristic.TargetFanState)
      .on('set', this.setTargetFanState.bind(this));

    this.fan
      .getCharacteristic(Characteristic.RotationSpeed)
      .on('set', this.setRotationSpeed.bind(this));

    this.service.isPrimaryService = true;
    this.service.linkedServices = [this.fan];

    return [this.informationService, this.service, this.fan];
  }
}
