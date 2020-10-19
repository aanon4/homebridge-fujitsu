// FGLair API, (c) 2020 Ryan Beggs, MIT License

// Portions of this software adapted from the homebridge-thermostat project
// https://github.com/PJCzx/homebridge-thermostat/
// Licensed under Apache 2.0

var Service, Characteristic, HbAPI;

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

function Thermostat(log, config) {
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

    this.keyTargetTemperature = 0;
    this.keyCurrentHeatingCoolingState = 0;
    this.keyFanSpeed = 0;

    this.log(this.name);
    this.service = new Service.Thermostat(this.name);
    this.fan = new Service.Fanv2(`${this.name} Fan`);
    this.api = require('./fglairAPI.js')
    this.api.setLog(this.log);
    this.api.setToken(this.token);
    this.api.setRegion(this.region);

    this.api.getAuth(this.userName, this.password, (err, token) => {
        this.token = token;
        this.api.getDevices(token, (err, data) => {
            if (err) {
                //TODO:  Do something...
            }
            else {
                this.serial = data[0]; //Only one thermostat is supported
                this.updateAll(this);
                setInterval(this.updateAll, this.interval, this);
            }
        });

    });

    this.smart = require('./smart');
    // Enable MIIO sensors (if configured)
    if (config.smart && config.smart.miio) {
        const miio = require('./sensors/miio');
        miio.login(config.smart.miio, this.log).then(() => {
            config.smart.sensors = miio;
            this.smart.start(config.smart, this.log);
        });
    }
}

Thermostat.prototype.updateAll = function (ctx) {
    ctx.api.getDeviceProp(ctx.serial, (err, properties) => {
        if (err) {
            ctx.log("Update Properties: " + err.message);
        }
        else {
            const remote = {
                targetHeatingCoolingState: null,
                targetTemperatureC: null,
                targetFanSpeed: null
            };
            properties.forEach(prop => {
                switch (prop['property']['name']) {
                    case 'adjust_temperature':
                        remote.targetTemperatureC = parseInt(prop['property']['value']) / 10;
                        ctx.keyTargetTemperature = prop['property']['key'];
                        break;
                    case 'operation_mode':
                        remote.targetHeatingCoolingState = FJ2HK[prop['property']['value']];
                        ctx.keyCurrentHeatingCoolingState = prop['property']['key'];
                        break;
                    case 'fan_speed':
                        remote.targetFanSpeed = parseInt(prop['property']['value']);
                        ctx.keyFanSpeed = prop['property']['key'];
                        break;
                    default:
                        break;
                }
            });

            // If remote information doesn't match our local state a remote change was made. Pause the program.
            if (ctx.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value != remote.targetHeatingCoolingState ||
                    ctx.service.getCharacteristic(Characteristic.TargetTemperature).value != remote.TargetTemperature ||
                    ctx.service.getCharacteristic(Characteristic.TargetFanState) != 1) {
                // Change made remotely - put program on hold
                ctx._pauseProgram();
            }

            if (Date.now() < ctx.smart.currentProgram.pause) {
                // Program on hold. Update local characteristics only
                ctx.service.updateCharacteristic(Characteristic.TargetTemperature, remote.targetTemperature);
                ctx.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, remote.targetHeatingCoolingState);
                ctx.fan.updateCharacteristic(Characteristic.Active, remote.targetHeatingCoolingState === Characteristic.CurrentHeatingCoolingState.OFF ? 0 : 1);
                ctx.fan.updateCharacteristic(Characteristic.RotationSpeed,
                    remote.targetFanSpeed === FJ_FAN_QUIET ? HK_FAN_QUIET :
                    remote.targetFanSpeed === FJ_FAN_LOW ? HK_FAN_LOW :
                    remote.targetFanSpeed === FJ_FAN_MEDIUM ? HK_FAN_MEDIUM :
                    HK_FAN_HIGH
                );
                ctx.fan.updateCharacteristic(Characteristic.TargetFanState, remote.targetFanSpeed === FJ_FAN_AUTO ? HK_FAN_AUTO : HK_FAN_MANUAL);
            }
            else {
                // Update thermostat from program (use setCharacteristic so we call the relevant 'set' listeners)
                // Save and restore the pause time as this will get updated when we update the characteristics, and we don't want
                // to keep that.
                const savedPaused = ctx.smart.currentProgram.pause;
                ctx.service.setCharacteristic(Characteristic.TargetHeatingCoolingState, ctx.smart.currentProgram.targetMode);
                ctx.service.setCharacteristic(Characteristic.TargetTemperature, ctx.smart.currentProgram.targetTemperature);
                ctx.fan.setCharacteristic(Characteristic.TargetFanState, HK_FAN_AUTO);
                ctx.smart.currentProgram.pause = savedPaused;
            }

            ctx.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, remote.targetHeatingCoolingState);
            if (ctx.smart.currentProgram.currentTemperature === null) {
                // If we don't know the current temperature (no sensors), we just have to use the target temperature
                ctx.service.updateCharacteristic(Characteristic.CurrentTemperature, remote.targetTemperature);
            }
            else {
                ctx.service.updateCharacteristic(Characteristic.CurrentTemperature, ctx.smart.currentProgram.currentTemperature);
            }

            ctx.log("[" + ctx.serial + "] temp: " + ctx.targetTemperature + "C, mode: " + ctx.targetHeatingCoolingState);
        }
    });
};

Thermostat.prototype._pauseProgram = function() {
    this.smart.currentProgram.pause = Date.now() + this.smart.holdTime;
}

Thermostat.prototype.setTargetHeatingCoolingState = function (val, cb) {
    this.log("Setting Target Mode to " + val + ":" + HK2FJ[val]);
    this._pauseProgram();
    this.api.setDeviceProp(this.keyCurrentHeatingCoolingState, HK2FJ[val], cb);
};

Thermostat.prototype.setTargetTemperature = function (val, cb) {
    this.log("Setting Temperature to " + val);
    this._pauseProgram();
    this.api.setDeviceProp(this.keyTargetTemperature, Math.round(val * 10), cb);
};

Thermostat.prototype.setFanActive = function (val, cb) {
    this.log('setFanActive', val);
    this._pauseProgram();
    if (!val) {
        this.api.setDeviceProp(this.keyCurrentHeatingCoolingState, FJ_OFF, cb);
    }
    else {
        this.api.setDeviceProp(this.keyCurrentHeatingCoolingState, HK2FJ[this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value], cb);
    }
}

Thermostat.prototype.setTargetFanState = function (val, cb) {
    this.log('setTargetFanState', val ? 'automatic' : 'manual');
    this._pauseProgram();
    if (val === HK_FAN_MANUAL) {
        this.setRotationSpeed(this.fan.getCharacteristic(Characteristic.RotationSpeed).value, cb);
    }
    else {
        // Automatic
        this.api.setDeviceProp(this.keyFanSpeed, FJ_FAN_AUTO, cb);
    }
}

Thermostat.prototype.setRotationSpeed = function (val, cb) {
    this.log('setRotationSpeed', val);
    this._pauseProgram();
    let fanSpeed = FJ_FAN_AUTO;
    if (val <= HK_FAN_QUIET) {
        fanSpeed = FJ_FAN_QUIET;
    }
    else if (val <= HK_FAN_LOW) {
        fanSpeed = FJ_FAN_LOW;
    }
    else if (val <= HK_FAN_MANUAL) {
        fanSpeed = FJ_FAN_MEDIUM;
    }
    else {
        fanSpeed = FJ_FAN_HIGH;
    }
    this.api.setDeviceProp(this.keyFanSpeed, fanSpeed, cb);
}

Thermostat.prototype.getServices = function () {
    this.informationService = new Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model);

    this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
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
        .getCharacteristic(Characteristic.Active)
        .on('set', this.setFanActive.bind(this));

    this.fan
        .getCharacteristic(Characteristic.TargetFanState)
        .on('set', this.setTargetFanState.bind(this));

    this.fan
        .getCharacteristic(Characteristic.RotationSpeed)
        .on('set', this.setRotationSpeed.bind(this));

    this.service.isPrimaryService = true;
    this.service.linkedServices = [ this.fan ];

    return [ this.informationService, this.service, this.fan ];
}
