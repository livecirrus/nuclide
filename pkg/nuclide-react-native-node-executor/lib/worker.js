'use strict';

var fs = require("fs");
var http = require('http');
var cp = require('child_process');
const fifoPath = process.argv[process.argv.length-1];

function send(message) {
  message = JSON.stringify(message)
//  console.log("sending "+message)
  cp.execSync("echo '"+message+"'>"+fifoPath+".child")
}

function read() {
  return fs.readFileSync(fifoPath+".parent", {encoding: "utf8"})
}

send("worker initialized");

function nextCommand() {
//  console.log("waiting for next command");
  var command = read();
  processCommand(command)
}

function processCommand(command) {
  if (command != "close") {
//    console.log("executing command "+command);
    command = JSON.parse(command);
    var req = http.request(command.options, function(res) {
      res.setEncoding('utf8');
      var buff = '';
      res.on('data', function(chunk) { buff += chunk; });
      res.on('end', () => {
        send({statusCode: res.statusCode, headers: res.headers, body:buff});
        nextCommand();
      });
    })
    req.end(command.body);
    req.on("error", (e) => {
      send({error: e.message});
    })
  }
}

nextCommand();
