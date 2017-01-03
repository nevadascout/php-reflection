/*!
 * Copyright (C) 2016 Glayzzle (BSD3 License)
 * @authors https://github.com/glayzzle/php-reflection/graphs/contributors
 * @url http://glayzzle.com
 */
var cp = require('child_process');
var numCPUs = require('os').cpus().length;
var workers = [];

/**
 * @constructor
 */
var Worker = function worker(script) {
  this.jobs = {};
  this.length = 0;
  this.script = script;
  this.ready = true;
  this.restart();
};

/**
 * Worker is down and may be restarted
 */
Worker.prototype.restart = function(code) {
  if (this.ready) {
    this.ready = false;
    if (this.child) {
      this.child.removeAllListeners('error');
      this.child.removeAllListeners('close');
      this.child.removeAllListeners('exit');
      // kill it (in case of hanging)
      this.child.kill('SIGKILL');
    }
    this.child = cp.fork(this.script, [], {
      stdio: ['ipc']
    });
    //this.child.stdout.on('data', function(data) {
    //    console.log('child>>' + data.toString());
    //});
    this.child.on('error', this.restart.bind(this));
    this.child.on('close', this.restart.bind(this));
    this.child.on('exit', this.restart.bind(this));
    this.child.on('message', this.message.bind(this));
    this.ready = true;
    console.log('>> restart', code);
    // retry pending scripts
    if (this.length > 0) {
      for (var k in this.jobs) {
        this.child.send({
          filename: k,
          crc32: this.jobs[k].crc32,
          options: this.jobs[k].options
        });
      }
    }
  }
};

/**
 * Receives the result
 */
Worker.prototype.message = function(data) {
  if (typeof data === 'string') {
    data = JSON.parse(data);
  }
  var filename = data.filename;
  if (this.jobs.hasOwnProperty(filename)) {
    var type = data.type;
    console.log(type, filename);
    if (type === 'start') {
      var self = this;
      // 5 sec timeout max
      this.jobs[filename].timeout = setTimeout(function() {
        self.message({
          filename: filename,
          type: 'reject',
          error: new Error('Parsing timeout (5s)')
        });
      }, 5000);
    } else {
      var promise = this.jobs[filename];
      delete this.jobs[filename];
      this.length--;
      if (promise.timeout) {
        clearTimeout(promise.timeout);
      }
      if (type === 'done') {
        promise.done(data.result);
      } else {
        if (type === 'reject') {
          promise.reject(data.error);
        } else {
          promise.reject('Unexpected message type "' + type + '"');
        }
      }
    }
  }
};

/**
 * Runs a process
 */
Worker.prototype.process = function(filename, crc32, options) {
  if (!this.jobs.hasOwnProperty(filename)) {
    this.length++;
    var self = this;
    this.jobs[filename] = new Promise(function(done, reject) {
      console.log('process>>' + filename, crc32, options);
      self.jobs[filename].done = done;
      self.jobs[filename].reject = reject;
      self.jobs[filename].crc32 = crc32;
      self.jobs[filename].options = options;
      self.child.send(JSON.stringify({
        filename: filename,
        crc32: crc32,
        options: options
      }));
    });
  }
  return this.jobs[filename];
};

for (var i = 0; i < numCPUs; i++) {
  workers.push(new Worker(__dirname + '/../bin/worker'));
}

/**
 * Launch the parsing of the specified file
 * @param {String} filename
 * @param {String} crc32
 * @return {Promise}
 */
module.exports = function(filename, crc32, options) {
  var w = workers[0];
  for (var i = 1; i < workers.length; i++) {
    if (workers[i].ready && workers[i].length < w.length) {
      w = workers[i];
    }
  }
  return w.process(filename, crc32, {
    cacheByFileDate: false,
    cacheByFileSize: false,
    cacheByFileHash: options.cacheByFileHash,
    encoding: options.encoding,
    scanExpr: options.scanExpr,
    scanVars: options.scanVars
  });
};
