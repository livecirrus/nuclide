'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {OutputService} from '../../nuclide-console/lib/types';

import formatEnoentNotification from '../../commons-atom/format-enoent-notification';
// eslint-disable-next-line nuclide-internal/no-cross-atom-imports
import {LogTailer} from '../../nuclide-console/lib/LogTailer';
import {createMessageStream} from './createMessageStream';
import {createProcessStream} from './createProcessStream';
import {CompositeDisposable, Disposable} from 'atom';
import Rx from 'rxjs';

class Activation {
  _disposables: CompositeDisposable;
  _logTailer: LogTailer;

  constructor(state: ?Object) {
    const message$ = Rx.Observable.defer(() => createMessageStream(createProcessStream()))
      .catch(err => {
        if (err.code === 'ENOENT') {
          const {message, meta} = formatEnoentNotification({
            feature: 'iOS Syslog tailing',
            toolName: 'syslog',
            pathSetting: 'nuclide-ios-simulator-logs.pathToSyslog',
          });
          atom.notifications.addError(message, meta);
          return Rx.Observable.empty();
        }
        throw err;
      });

    this._logTailer = new LogTailer({
      name: 'iOS Simultoar Logs',
      messages: message$,
      trackingEvents: {
        start: 'ios-simulator-logs:start',
        stop: 'ios-simulator-logs:stop',
        restart: 'ios-simulator-logs:restart',
      },
    });

    this._disposables = new CompositeDisposable(
      new Disposable(() => { this._logTailer.stop(); }),
      atom.commands.add('atom-workspace', {
        'nuclide-ios-simulator-logs:start': () => this._logTailer.start(),
        'nuclide-ios-simulator-logs:stop': () => this._logTailer.stop(),
        'nuclide-ios-simulator-logs:restart': () => this._logTailer.restart(),
      }),
    );
  }

  consumeOutputService(api: OutputService): void {
    this._disposables.add(
      api.registerOutputProvider({
        id: 'iOS Simulator Logs',
        messages: this._logTailer.getMessages(),
        observeStatus: cb => this._logTailer.observeStatus(cb),
        start: () => { this._logTailer.start(); },
        stop: () => { this._logTailer.stop(); },
      })
    );
  }

  dispose() {
    this._disposables.dispose();
  }
}

module.exports = Activation;
