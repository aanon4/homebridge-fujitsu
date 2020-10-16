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

const OPERATION_MODE = { "off":0, "auto":2, "cool":3, "dry":4, "fan_only":5, "heat":6, 0:"off", 2:"auto", 3:"cool", 4:"dry", 5:"fan_only", 6:"heat"}

const HK_MODE = { 0:"off", 1:"heat", 2:"cool", 3:"auto"}

function Thermostat(log, config) {
    this.log = log;

    this.name = config.name;
    this.manufacturer = "Fujitsu General Ltd.";
    this.model = config.model || "DefaultModel";
    this.serial = config.serial || '';
    this.token = config.token || "";
    this.region = config.region || 'us'
    this.temperatureDisplayUnits = config.temperatureDisplayUnits || 0;

    this.currentHumidity = config.currentHumidity || false;
    this.targetHumidity = config.targetHumidity || false;
    this.interval = config.interval*1000 || 10000;
    this.userName = config.username || '';
    this.password = config.password || '';
    this.temperatureDisplayUnits = config.temperatureDisplayUnits || 0;
    this.targetTemperature = 20;
    this.adjustedTargetTemperature = this.targetTemperature;
    this.keyTargetTemperature = 0;
    this.currentTemperature = 20;

    this.targetHeatingCoolingState = 6;
    this.keyCurrentHeatingCoolingState = 0;
    this.currentHeatingCoolingState = 6;

    this.fanSpeed = 0;
    this.keyFanSpeed = 0;

    this.deviceProperties = [];

    this.log(this.name);
    this.service = new Service.Thermostat(this.name);
    this.fan = new Service.Fanv2(`${this.name} Fan`);
    this.api = require('./fglairAPI.js')
    this.api.setLog(this.log);
    this.api.setToken(this.token);
    this.api.setRegion(this.region);

    this.api.getAuth(this.userName ,this.password, (err, token) =>
    {
        this.token = token;

        this.api.getDevices(token, (err,data) =>
        {
            if( err)
            {
               //TODO:  Do something...
            }
            else
            {
                this.serial = data[0]; //Only one thermostat is supported
                this.updateAll(this);
                setInterval( this.updateAll, this.interval, this );
            }
        });

    });

    // Enable MIIO sensors (if configured)
    this.pauseProgramUntil = 0;
    if (config.smart) {
        this.miio = require('./miio');
        this.miio.start(config.smart);
    }
}

Thermostat.prototype.updateAll = function(ctx)
{
    ctx.api.getDeviceProp(ctx.serial, (err,properties) =>
    {   if(err)
        {
            ctx.log("Update Properties: " + err.message);
        }
        else
        {
            properties.forEach( (prop) =>
            {
                //this.log(prop['property']['name']);
                if( prop['property']['name'] == 'adjust_temperature' )
                {
                    const originalTarget = parseInt(prop['property']['value']) / 10;
                    let adjustedTarget = originalTarget;
                    let target;

                    // HVAC off, so adjust nothing.
                    if (ctx.currentHeatingCoolingState === Characteristic.CurrentHeatingCoolingState.OFF) {
                        target = adjustedTarget;
                    }
                    // Temp changed externally. Either this was by a manual user change
                    // or by a program change. We don't know which but we want to respect the user
                    // change so we make the target the adjusted too (ie. no diff).
                    // This will persist until the program changes.
                    else if (ctx.adjustedTargetTemperature != adjustedTarget) {
                        target = adjustedTarget;
                        if (ctx.miio) {
                            ctx.pauseProgramUntil = Date.now() + ctx.miio.holdTime;
                        }
                    }
                    else {
                        // No external change, so target is whatever it currenty is.
                        target = ctx.targetTemperature;
                    }

                    if (ctx.miio) {
                        ctx.currentTemperature = ctx.miio.currentTempC;
                        if (Date.now() > ctx.pauseProgramUntil) {
                            // Program is different from the program when we last stopped applying
                            // differences, so we can do that again now.
                            adjustedTarget = target - ctx.miio.currentTempDiffC;
                        }
                    }
                    else {
                        ctx.currentTemperature = target;
                    }

                    // If adjustedTarget is now different, update thermostat
                    if (originalTarget !== adjustedTarget) {
                        ctx.api.setDeviceProp(this.keyTargetTemperature, Math.round(adjustedTarget * 10), () => {});
                    }
                    ctx.targetTemperature = target;
                    ctx.adjustedTargetTemperature = adjustedTarget;

                    //ctx.log("[" + ctx.serial + "] Got Temperature: "+ ctx.targetTemperature + ":" + ctx.currentTemperature);
                    ctx.service.updateCharacteristic(Characteristic.TargetTemperature, ctx.targetTemperature);
                    ctx.service.updateCharacteristic(Characteristic.CurrentTemperature, ctx.currentTemperature);
                    this.keyTargetTemperature = prop['property']['key'];
                }
                else if( prop['property']['name'] == 'operation_mode' )
                {
                    let mode = OPERATION_MODE[prop['property']['value']];
                    switch(mode)
                    {
                        case "auto":
                            ctx.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.AUTO;
                            break;
                        case "heat":
                            ctx.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.HEAT;
                            break;
                        case "cool":
                        case "fan_only":
                        case "dry":
                            ctx.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.COOL;
                            break;
                        case "off":
                        default:
                            ctx.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
                            break;
                    }

                    switch(mode)
                    {
                        case "heat":
                            ctx.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;
                            break;
                        case "cool":
                        case "fan_only":
                            ctx.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.COOL;
                            break;
                        case "off":
                        default:
                            ctx.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
                            break;
                    }

                    this.keyCurrentHeatingCoolingState = prop['property']['key'];

                    //ctx.log("[" + ctx.serial + "] Got HeatingCooling State: "+ ctx.targetHeatingCoolingState);
                    ctx.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, ctx.currentHeatingCoolingState);
                    ctx.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, ctx.targetHeatingCoolingState);
                    ctx.fan.updateCharacteristic(Characteristic.Active, ctx.currentHeatingCoolingState === Characteristic.CurrentHeatingCoolingState.OFF ? 0 : 1);
                }
                else if( prop['property']['name'] == 'fan_speed' )
                {
                    ctx.fanSpeed = parseInt(prop['property']['value']);
                    ctx.fan.updateCharacteristic(Characteristic.RotationSpeed,
                        ctx.fanSpeed === 0 ? 10 :
                        ctx.fanSpeed === 1 ? 30 :
                        ctx.fanSpeed === 2 ? 60 :
                        100
                    );
                    ctx.fan.updateCharacteristic(Characteristic.TargetFanState, ctx.fanSpeed === 4 ? 1 : 0);

                    this.keyFanSpeed = prop['property']['key'];
                }
            }); //end of foreach
            ctx.log("[" + ctx.serial + "] temp: " + ctx.targetTemperature + "C, mode: " + HK_MODE[ctx.targetHeatingCoolingState]);
        }

    });
};

Thermostat.prototype.getCurrentHeatingCoolingState = function(cb) {
    cb(null, this.currentHeatingCoolingState);
};

Thermostat.prototype.getTargetHeatingCoolingState = function(cb) {
    cb(null, this.targetHeatingCoolingState);
};

Thermostat.prototype.setTargetHeatingCoolingState = function(val, cb) {
	let fgl_val = OPERATION_MODE[HK_MODE[val]];
	this.log("Setting Target Mode to " + fgl_val + ":" +HK_MODE[val]);
    this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, val);
    this.api.setDeviceProp(this.keyCurrentHeatingCoolingState, fgl_val, (err) =>
    {
        cb(err);
    })

};

Thermostat.prototype.getCurrentTemperature = function(cb) {
	//this.log("Current "+this.currentTemperature);
	cb(null, this.currentTemperature);
};

Thermostat.prototype.getTargetTemperature = function(cb) {
	//this.log("Target "+this.targetTemperature);
	cb(null, this.targetTemperature);
};

Thermostat.prototype.setTargetTemperature = function(val, cb) {
    this.log("Setting Temperature to " + val);
    this.targetTemperature = val;
    this.adjustedTargetTemperature = val;
    this.pauseProgramUntil = 0;
    if (this.miio)
    {
        this.adjustedTargetTemperature -= this.miio.currentTempDiffC;
    }
    this.api.setDeviceProp(this.keyTargetTemperature, Math.round(this.adjustedTargetTemperature * 10), (err) =>
    {
        this.service.updateCharacteristic(Characteristic.TargetTemperature, this.targetTemperature);
        cb(err);
    });
};

Thermostat.prototype.getTemperatureDisplayUnits = function(cb) {
    cb(null, this.temperatureDisplayUnits);
};

Thermostat.prototype.setTemperatureDisplayUnits = function(val, cb) {
	this.log(val);
    this.temperatureDisplayUnits = val;
    cb();
};

Thermostat.prototype.getName = function(cb) {
    cb(null, this.name);
};

Thermostat.prototype.setFanActive = function(val, cb) {
    this.log('setFanActive', val);
    // ... update ...
    cb();
}

Thermostat.prototype.setTargetFanState = function(val, cb) {
    this.log('setTargetFanState', val ? 'automatic' : 'manual');
    if( val === 0)
    {
        // Manual
        this.fan.getCharacteristic(Characteristic.RotationSpeed).getValue((err, value) =>
        {
            if( err)
            {
                cb(err);
            }
            else
            {
                this.setRotationSpeed(value, cb);
            }
        });
    }
    else
    {
        // Automatic
        this.fanSpeed = 4;
        this.api.setDeviceProp(this.keyFanSpeed, this.fanSpeed, cb);
    }
}

Thermostat.prototype.setRotationSpeed = function(val, cb) {
    this.log('setRotationSpeed', val);
    if (val <= 10) {
        this.fanSpeed = 0;
    }
    else if (val <= 30) {
        this.fanSpeed = 1;
    }
    else if (val <= 60) {
        this.fanSpeed = 2;
    }
    else {
        this.fanSpeed = 3;
    }
    this.api.setDeviceProp(this.keyFanSpeed, this.fanSpeed, cb);
}

Thermostat.prototype.getServices = function () {
    this.informationService = new Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model);

    this.service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getCurrentHeatingCoolingState.bind(this));

    this.service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getTargetHeatingCoolingState.bind(this))
        .on('set', this.setTargetHeatingCoolingState.bind(this));

    this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this));

    this.service
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', this.getTargetTemperature.bind(this))
        .on('set', this.setTargetTemperature.bind(this));

    this.service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', this.getTemperatureDisplayUnits.bind(this))
        .on('set', this.setTemperatureDisplayUnits.bind(this));

    this.service
        .getCharacteristic(Characteristic.Name)
        .on('get', this.getName.bind(this));

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

	return [this.informationService, this.service, this.fan];
};

// TargetFanState = Manual 0, Automatic 1
// CurrentFanState = Inactive 0, Idle 1, Active 2
// RotationSpeed = 0-100
