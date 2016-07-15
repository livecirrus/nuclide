/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

'use strict';

/* eslint-disable no-var, no-console, prefer-arrow-callback */

var http = require('http');
var invariant = require('assert');
var url = require('url');
var vm = require('vm');
var currentContext = null;

var fs = require('fs');
var cp = require('child_process')
const fifoPath = '/tmp/.nuclide-react-native-node-executor-fifo';
try {
  cp.execSync('mkfifo ' + fifoPath+".parent")
} catch (e) {}
try {
  cp.execSync('mkfifo ' + fifoPath+".child")
} catch (e) {}

function send(message) {
  message = JSON.stringify(message)
//  console.log("sending "+message)
  cp.execSync("echo '"+message+"'>"+fifoPath+".parent")
}
function read() {
  return fs.readFileSync(fifoPath+".child", {encoding: "utf8"})
}



var command = process.execPath+" "+require.resolve('./worker.js')+" "+fifoPath
console.log(command)
var worker = cp.exec(command)

console.log(read())

var nodeXMLHttpRequest = function() {
    var settings;
    this.open = function(method, url, async, user, password) {
        settings = {
            "method": method,
            "url": url.toString(),
            "async": (typeof async !== "boolean" ? true : async),
            "user": user || null,
            "password": password || null
        };
    }
    this.send = function(body) {
      var parsed = url.parse(settings.url)
      var options = {
        protocol: parsed.protocol || 'http:',
        hostname: parsed.hostname || 'localhost',
        port: parsed.port || 80,
        method: settings.method,
        headers: {
          'Content-Type': 'text/json'
        },
        path: parsed.path
      }
      var command = {
        options: options,
        body: body
      }
      send(command);
      var result = read();
//      console.log("received response "+result)
      result = JSON.parse(result);
      this.error = result.error;
      this.status = result.statusCode;
      this.responseText = result.body;
    }
}


process.on('message', function(request) {
  switch (request.method) {
    case 'prepareJSRuntime':
      currentContext = vm.createContext({console, nodeXMLHttpRequest});
      sendResult(request.id);
      return;

    case 'executeApplicationScript':
      // Modify the URL to make sure we get the inline source map.
      var parsedUrl = url.parse(request.url, /* parseQueryString */ true);
      invariant(parsedUrl.query);
      parsedUrl.query.inlineSourceMap = true;
      delete parsedUrl.search;
      // $FlowIssue url.format() does not accept what url.parse() returns.
      var scriptUrl = url.format(parsedUrl);

      getScriptContents(scriptUrl, function(err, script) {
        if (err != null) {
          sendError('Failed to get script from packager: ' + err.message);
          return;
        }

        if (currentContext == null) {
          sendError('JS runtime not prepared');
          return;
        }

        if (request.inject) {
          for (var name in request.inject) {
            currentContext[name] = JSON.parse(request.inject[name]);
          }
        }

        try {
          // The file name is dummy here. Without a file name, the source map is not used.
          vm.runInContext(script, currentContext, '/tmp/react-native.js');
        } catch (e) {
          sendError('Failed to exec script: ' + e.message);
        }
        sendResult(request.id);
      });

      return;

    default:
      var returnValue = [[], [], [], [], []];
      try {
        if (currentContext != null && typeof currentContext.__fbBatchedBridge === 'object') {
          returnValue =
            currentContext.__fbBatchedBridge[request.method].apply(null, request.arguments);
        }
      } catch (e) {
        sendError('Failed while making a call ' + request.method + ':::' + e.message);
      } finally {
        sendResult(request.id, JSON.stringify(returnValue));
      }

      return;
  }
});

function sendResult(replyId, result) {
  process.send({
    kind: 'result',
    replyId,
    result,
  });
}

function sendError(message) {
  process.send({
    kind: 'error',
    message,
  });
}

function getScriptContents(src, callback) {
  http
    .get(src, function(res) {
      res.setEncoding('utf8');
      var buff = '';
      res.on('data', function(chunk) { buff += chunk; });
      res.on('end', () => {
        callback(null, buff);
      });
    })
    .on('error', function(err) { callback(err); });
}
