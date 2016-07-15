'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {ExecutorResult, RnMessage} from './types';

import {Observable} from 'rxjs';
import WS from 'ws';
import {cacheWhileSubscribed} from '../../../commons-node/stream';

const WS_URL = 'ws://localhost:8081/debugger-proxy?role=debugger&name=Nuclide';

/**
 * This function models the RN side of the debugging equation: it emits a stream of requests for the
 * executor (as well as some other instructions), and accepts a stream of results.
 */
export function runApp(executorResults: Observable<ExecutorResult>): Observable<RnMessage> {
  const websockets = connectToRnApp();

  return websockets.switchMap(ws => (
    Observable.merge(
      // The messages from the RN app.
      Observable.fromEvent(ws, 'message').map(JSON.parse),

      // Send the executor results to the RN app.
      executorResults
        .do(response => {
          const {replyId, result} = response;
          ws.send(JSON.stringify({replyID: replyId, result}));
        })
        .ignoreElements(),
    )
  ))
    .share();
}


function connectToRnApp(): Observable<WS> {
  // $FlowIssue: Add this to Rx defs
  const websockets = Observable.using(
    () => {
      const ws = new WS(WS_URL);
      return {ws, unsubscribe: () => { ws.close(); }};
    },
    ({ws}) => Observable.of(ws)
  )
    .switchMap(ws => (
      Observable.merge(
        Observable.never(),

        // A stream of websockets...
        Observable.of(ws),

        // ...that errors if the websocket closes before we unsubscribe.
        Observable.fromEvent(ws, 'close').map(() => {
          throw new PrematureCloseError();
        }),

        // ...or when there's a websocket error.
        Observable.fromEvent(ws, 'error').switchMap(Observable.throw),
      )
    ))
    .retryWhen(errors => (
      errors.scan(
        (errorCount, error) => {
          // If the connection is being refused, or closes prematurely, just keep retrying
          // indefinitely.
          if (error.name === 'PrematureCloseError' || (error: any).code === 'ECONNREFUSED') {
            return errorCount;
          }

          // Otherwise, retry 5 times.
          if (errorCount >= 5) { throw error; }
          return errorCount + 1;
        },
        0,
      )
        .delay(500)
    ));

  return cacheWhileSubscribed(websockets);
}

class PrematureCloseError extends Error {
  constructor() {
    super('Web socket closed prematurely');
    this.name = 'PrematureCloseError';
  }
}
