# homebridge-fujitsu-smart
## Homebridge plug in for Fujistu Mini Split with smart temperature support using Xiaomi sensors.

**Warning** this plugin this is currently experimental, use at your own risk!

## Installation

1. Install [homebridge](https://github.com/nfarina/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-fujitsu-smart`
3. Edit your `config.json` file (See below).

```json
"accessories": [
    {
        "accessory": "FGLairSmartThermostat",
        "name": "Fujitsu Mini Spit",
        "username": "FGLAIR USERNAME",
        "password": "FGLAIR PASSWORD",
        "interval": 30,
        "smart": {
            "miio": {
                "username": "MII USERNAME",
                "password": "MII PASSWORD",
                "region": "cn"
            },
            "reference": "THERMOSTAT ROOM",
            "feelslike": true,
            "hold": 60,
            "schedule": [
                { "day": "Any", "from": "12:00am", "to": "11:59pm", "occupied":  50, "empty":  0, "room": "THERMOSTAT ROOM" },
                { "day": "Any", "from": "12:00am", "to": "11:59pm", "occupied": 100, "empty":  0, "room": "Bedroom" }
            ]
        }
    },
]
```
| Key | Description |
| --- | --- |
| `accessory` | Must be `FGLairSmartThermostat` |
| `name` | Name to appear in the Home app |
| `username` | `FGLair` Username |
| `password` | `FGLair` Password |
| `model` _(optional)_ | Appears under "Model" for your accessory in the Home app |
| `interval` _(optional)_ | Polling time for thermostat (Default: 60 sec.) |
| `region` _(optional)_ | Region for thermostat, change for China & E.U. (Default: "us") |
| `smart` _(optional)_ | Sensor configuration to allow smart adaption of thermostat temperature. |
| `smart.miio.username` | `Mi Home` Username |
| `smart.miio.password` | `Mi Home` Password |
| `smart.miio.region` _(optional)_ | Will default to `cn` which supports the latest range of sensor types, but can be set to other regions |
| `smart.interval` _(optional)_ | Polling time for sensors (Default: 60 sec.) |
| `smart.reference` | The room name of a sensor which is used as the temperature reference when making thermostat adjustments. This should be the sensor nearest the thermostat (the thermostat API doesn't provide its own temperature reading) |
| `smart.feeslike` _(optional)_ | If `true` the temperatures will be adjusted based on the humidity, to better refect the temperatures rooms feel |
| `smart.hold` _(optional)_ | Number of minutes (Default: 60 mins.) to hold the temperature without adjustment if changed externally (e.g. on the wall thermostat)
| `smart.schedule` | Zero or more schedule entries describing how and when a room sensor is important |
| `smart.schedule.day` | A day `(Sun,Mon,Tue,Wed,Thu,Fri,Sat)` or a series of days `(Mon-Thu)` or `Any` specifying which day this schedule applies |
| `smart.schedule.from` | A time `(e.g 1:00pm,12:13am,11:59pm)` when this schedule starts |
| `smart.schedule.to` | A time when this schedule ends |
| `smart.schedule.occupied` | A weight from `0-100` specifying how important this schedule is, higher being more important. This weight is for when the room is occupied (or always if the room has no motion sensor) |
| `smart.schedule.empty` | A weight for when the room has been empty for 30 minutes or more |
| `smart.schedule.room` | The room name which should match the beginning name of the sensor `(e.g. Dining Room` has sensors `Dining Room Temperature` and `Dining Room Movement)` |

## Smart operation
Smart operation uses Xiomi temperature, humidity and movement sensors to adjust the thermostat target temperature depending on where you are in your house (in a similar way to the Ecobee thermostat). Sensors must be registered using the `Mi Home` application.

This plugin will read the sensors periodically, then caculate a weighted temperature based on the defined schedule, and adjust the thermostat target temperature based on this temperature and the original target temperature. HomeKit will always see the original target temperature, but the wall thermostat can only display the adjusted target. If the wall temperature is changed by hand, this will override any adjustments made by this program for a set period of time before the schedule resumes.

## Current limitations
- Only one air conditioner is displayed, the API chooses the first device.  I only have one system, so feel free to contribute changes if you have more than one A/C unit.
- Timeout on token is not enabled, when token is invalid the API will re-authenticate.
- Auth. Token is not cached
- Previous thermostat state is not cached
- For US users, Aqara devices seem like the obvious sensor choice. If anyone knows how to easily read these (no ferreting around for tokens in encypted backups) please let me know as I've had no luck :-(

## Wouldn't it be nice ...
- If HomeKit devices could be allowed read other HomeKit devices state (e.g. sensors). I realize there are security concerns here, but still ...

## TODO
- **Lots and lots of testing. Seriously this could burn your house down at the moment.**
- Web UI to setup the schedule in a way which doesn't involve ending JSON.

## Contributions
Portions of this software adapted from the projects listed below.  A huge thank you, for all their work.

- The original homebridge-fujitsu plugin https://github.com/smithersDBQ/homebridge-fujitsu

- The pyfujitsu project under Apache License
Copyright (c) 2018 Mmodarre https://github.com/Mmodarre/pyfujitsu

- The homebridge-dummy-thermostat under the Unlicense
https://github.com/X1ZOR/homebridge-dummy-thermostat

- The node-mihome library https://github.com/maxinminax/node-mihome
