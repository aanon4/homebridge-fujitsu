// FGLair API, (c) 2020 Ryan Beggs, MIT License (see below)

// Portions of this software adapted from the pyfujitsu project
// Copyright (c) 2018 Mmodarre https://github.com/Mmodarre/pyfujitsu


/*                          MIT License
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.*/

const https = require('https');

const DISABLE_SET = false; // True to disable updating hardware (for debugging)

let log = {
  debug: console.log,
  error: console.error
};
let access_token = '';
const devices_dsn = [];
let username = '';
let user_pwd = '';

const q = [];

const options_auth = {
  hostname: "user-field.aylanetworks.com",
  port: 443,
  path: "/users/sign_in.json",
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}

const options = {
  hostname: "ads-field.aylanetworks.com",
  port: 443,
  path: "/apiv1/",
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  }
}
const appID = {
  app_id: "CJIOSP-id",
  app_secret: "CJIOSP-Vb8MQL_lFiYQ7DKjN0eCFXznKZE"
}

function set_region(region) {
  if (region == 'eu') {
    options_auth['hostname'] = "user-field-eu.aylanetworks.com";
    options['hostname'] = "ads-field-eu.aylanetworks.com";
    appID['app_id'] = "FGLair-eu-id";
    appID['app_secret'] = "FGLair-eu-gpFbVBRoiJ8E3QWJ-QRULLL3j3U"
  }
  else if (region == 'cn') {
    options_auth['hostname'] = "user-field.ayla.com.cn";
    options['hostname'] = "ads-field.ayla.com.cn";
    appID['app_id'] = "FGLairField-cn-id";
    appID['app_secret'] = "FGLairField-cn-zezg7Y60YpAvy3HPwxvWLnd4Oh4"
  }
  else {
    //use the defaults
  }
}

function read_devices_options(token) {
  let temp_options = options;

  temp_options['method'] = 'GET';
  temp_options['path'] = "/apiv1/" + "devices.json"
  if (token) {
    temp_options['headers']['Authorization'] = 'auth_token ' + token;
  }
  return temp_options;
}

function read_properties_options(dsn, token) {
  let temp_options = options;

  temp_options['method'] = 'GET';
  temp_options['path'] = "/apiv1/dsns/" + dsn + "/properties.json";
  temp_options['headers']['Authorization'] = 'auth_token ' + token;
  return temp_options;
}

function set_property_options(dsn, prop_key, token) {
  let temp_options = options;

  temp_options['method'] = 'POST';
  temp_options['path'] = "/apiv1/dsns/" + dsn + "/properties/" + prop_key + "/datapoints.json";
  temp_options['headers']['Authorization'] = 'auth_token ' + token;
  return temp_options;
}

var fglair = {

  checkToken: function (token = '', callback) {
    if (!token) {
      return false;
    }
    return true;
  },

  getDevices: function (callback) {
    let data = '';
    let opt = read_devices_options(access_token)
    let req2 = https.request(opt, (res) => {
      log.debug(`statusCode: ${res.statusCode}`);
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        if (res.statusCode == 200) {
          let data_json = JSON.parse(data);

          data_json.forEach((dv) => {
            log.debug(dv);
            let dsn = dv['device']['dsn'];
            devices_dsn.push(dsn);
          });
          log.debug("Device: " + devices_dsn);
          callback(null, devices_dsn);
        }
        else {
          err = new Error("Get Devices Error");
          log.error(err.message);
          callback(err);
        }
      });
    }).on('error', (err) => {
      log.error("Error: " + err.message);
      callback(err);
    });
    req2.end();
  },

  getDeviceProp: function (dsn, callback) {
    let data = '';
    let opt = read_properties_options(dsn, access_token)
    let req2 = https.request(opt, (res) => {
      log.debug(`statusCode: ${res.statusCode}`);
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        if (res.statusCode == 200) {
          callback(null, JSON.parse(data));
        }
        else {
          //auth_token expired...
          log.debug("Getting new token...");
          fglair.getAuth(username, user_pwd, err => {
            if (err) {
              log.error("Auth Error: " + err);
              callback(new Error("Auth expired"));
            }
            else {
              fglair.getDeviceProp(dns, callback);
            }
          });
        }
      });
    }).on('error', (err) => {
      log.error("Error: " + err.message);
      callback(err);
    });
    req2.end();
  },

  setDeviceProp: function (dsn, property_name, val, callback) {
    if (DISABLE_SET) {
      callback(null);
      return;
    }
    let data = '';
    const body = '{\"datapoint\": {\"value\": ' + val + ' } }';
    const opt = set_property_options(dsn, property_name, access_token);
    const req = https.request(opt, res => {
      log.debug(`Write Property statusCode: ${res.statusCode}`);
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        log.debug('setdevprop', property_name, val, data);
        callback(null);
      });
    }).on('error', (err) => {
      log.error("Error: " + err.message);
      callback(err);
    });
    req.write(body);
    req.end();
  },

  getAuth: function (user, password, callback) {
    username = user;
    user_pwd = password;
    var body = `{\"user\": {\"email\": \"${user}\", \"application\":{\"app_id\": \"${appID.app_id}\",\"app_secret\": \"${appID.app_secret}\"},\"password\": \"${password}\"}}`;
    const req = https.request(options_auth, (res) => {
      log.debug(`statusCode: ${res.statusCode}`);
      res.on('data', (d) => {
        access_token = JSON.parse(d)['access_token'];
        log.debug("API Access Token: " + access_token);
        callback(null);
      });
    });
    req.on('error', (error) => {
      log.error("Error: " + error);
      callback(error);
    });
    req.write(body);
    req.end();
  },

  setLog: function (logfile) {
    log = logfile;
  },

  setRegion: function (region) {
    set_region(region);
  }
}

module.exports = fglair;
