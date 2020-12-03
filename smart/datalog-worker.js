const FS = require('fs');
const Pako = require('pako');
const Workers = require('worker_threads');

const data = Workers.workerData;
FS.writeFile(data.logFile, Pako.gzip(JSON.stringify(data.data)), e => {
  if (e) {
    console.log('toFile:', e);
  }
});
