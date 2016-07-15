'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Level} from '../../nuclide-console/lib/types';
import type {BuckWebSocketMessage} from '../../nuclide-buck-base/lib/BuckProject';
import type {ProcessMessage} from '../../commons-node/process-types';
import type {BuckSubcommand} from './types';

import {Observable} from 'rxjs';
import stripAnsi from 'strip-ansi';
import {getLogger} from '../../nuclide-logging';

const PROGRESS_OUTPUT_INTERVAL = 5 * 1000;
const BUILD_FAILED_MESSAGE = 'BUILD FAILED:';

export type BuckEvent = {
  type: 'progress';
  progress: ?number;
} | {
  type: 'log';
  message: string;
  level: Level;
};

function convertJavaLevel(level: string): Level {
  switch (level) {
    case 'INFO':
      return 'info';
    case 'WARNING':
      return 'warning';
    case 'SEVERE':
      return 'error';
  }
  return 'log';
}

export function getEventsFromSocket(
  socketStream: Observable<BuckWebSocketMessage>,
): Observable<BuckEvent> {
  const log = (message, level = 'log') => Observable.of({
    type: 'log',
    message,
    level,
  });

  const eventStream = socketStream
    .flatMap((message: BuckWebSocketMessage) => {
      switch (message.type) {
        case 'ParseStarted':
          return log('Parsing BUCK files...');
        case 'ParseFinished':
          return log('Parsing finished. Starting build...');
        case 'ConsoleEvent':
          return log(message.message, convertJavaLevel(message.level.name));
        case 'InstallFinished':
          return log('Install finished.', 'info');
        case 'BuildFinished':
          return log(
            `Build finished with exit code ${message.exitCode}.`,
            message.exitCode === 0 ? 'info' : 'error',
          );
        case 'BuildProgressUpdated':
          return Observable.of({
            type: 'progress',
            progress: message.progressValue,
          });
      }
      return Observable.empty();
    })
    .catch(err => {
      getLogger().error('Got Buck websocket error', err);
      // Return to indeterminate progress.
      return Observable.of({
        type: 'progress',
        progress: null,
      });
    })
    .share();

  // Periodically emit log events for progress updates.
  return eventStream.merge(
    eventStream
      .flatMap(event => {
        if (event.type === 'progress' && event.progress != null &&
            event.progress > 0 && event.progress < 1) {
          return log(`Building... [${Math.round(event.progress * 100)}%]`);
        }
        return Observable.empty();
      })
      .throttleTime(PROGRESS_OUTPUT_INTERVAL)
  );
}

export function getEventsFromProcess(
  processStream: Observable<ProcessMessage>,
): Observable<BuckEvent> {
  return processStream
    .map(message => {
      switch (message.kind) {
        case 'error':
          return {
            type: 'log',
            message: `Buck failed: ${message.error.message}`,
            level: 'error',
          };
        case 'exit':
          return {
            type: 'log',
            message: `Buck exited with code ${message.exitCode}.`,
            level: message.exitCode === 0 ? 'success' : 'error',
          };
        case 'stderr':
        case 'stdout':
          return {
            type: 'log',
            // Some Buck steps output ansi escape codes regardless of terminal setting.
            message: stripAnsi(message.data),
            // Build failure messages typically do not show up in the web socket.
            // TODO(hansonw): fix this on the Buck side
            level: message.data.indexOf(BUILD_FAILED_MESSAGE) === -1 ? 'log' : 'error',
          };
        default:
          throw new Error('impossible');
      }
    });
}

export function combineEventStreams(
  subcommand: BuckSubcommand,
  socketEvents: Observable<BuckEvent>,
  processEvents: Observable<BuckEvent>,
): Observable<BuckEvent> {
  // Every build finishes with a 100% progress event.
  function isBuildFinishEvent(event: BuckEvent) {
    return event.type === 'progress' && event.progress === 1;
  }
  function isRegularLogMessage(event: BuckEvent) {
    return event.type === 'log' && event.level === 'log';
  }
  // Socket stream never stops, so use the process lifetime.
  const finiteSocketEvents = socketEvents
    .takeUntil(
      processEvents
        .ignoreElements()
        // Despite the docs, takeUntil doesn't respond to completion.
        .concat(Observable.of(null))
    )
    .share();
  let mergedEvents = Observable.merge(
    finiteSocketEvents,

    // Accumulate regular log messages. We normally want to ignore these, but if we haven't
    // received any messages from the socket by the time the process exits, flush them.
    // This typically happens if you provide a totally invalid build target / arguments.
    processEvents
      .takeUntil(finiteSocketEvents) // Optimization: stop on the first socket message.
      .takeWhile(isRegularLogMessage)
      .reduce((acc, value) => acc.concat([value]), [])
      .combineLatest(
        // This observable emits a value only if the socket emits nothing
        // by the time we get the first error/info log.
        finiteSocketEvents
          .takeUntil(processEvents.filter(e => !isRegularLogMessage(e)))
          .first()
          .ignoreElements()
          .catch(() => Observable.of(null))
      )
      .switchMap(([events]) => Observable.from(events)),

    // Error/info logs from the process represent exit/error conditions, so always take them.
    // We ensure that error/info logs will not duplicate messages from the websocket.
    // $FlowFixMe: add skipWhile to flow-typed rx definitions
    processEvents
      .skipWhile(isRegularLogMessage),
  );
  if (subcommand === 'test') {
    // The websocket does not reliably provide test output.
    // After the build finishes, fall back to the Buck output stream.
    mergedEvents = Observable.concat(
      mergedEvents
        .takeUntil(finiteSocketEvents.filter(isBuildFinishEvent)),
      // Return to indeterminate progress.
      Observable.of({type: 'progress', progress: null}),
      processEvents,
    );
  } else if (subcommand === 'install') {
    // Add a message indicating that install has started after build completes.
    // The websocket does not naturally provide any indication.
    mergedEvents = Observable.merge(
      mergedEvents,
      finiteSocketEvents
        .filter(isBuildFinishEvent)
        // $FlowFixMe: add switchMapTo to flow-typed
        .switchMapTo(
          Observable.of(
            {
              type: 'progress',
              progress: null,
            },
            {
              type: 'log',
              message: 'Installing...',
              level: 'info',
            },
          )
        ),
    );
  }
  return mergedEvents;
}
