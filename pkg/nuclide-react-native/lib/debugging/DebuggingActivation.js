'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type DebuggerProcessInfo from '../../../nuclide-debugger-atom/lib/DebuggerProcessInfo';
import type {nuclide_debugger$Service} from '../../../nuclide-debugger-interfaces/service';

import consumeFirstProvider from '../../../commons-atom/consumeFirstProvider';
import {ReactNativeProcessInfo} from './ReactNativeProcessInfo';
import {CompositeDisposable, Disposable} from 'atom';
import Rx from 'rxjs';

/**
 * Connects the executor to the debugger.
 */
export class DebuggingActivation {
  _disposables: IDisposable;
  _startDebuggingSubscription: ?rx$ISubscription;

  constructor() {
    this._disposables = new CompositeDisposable(
      atom.commands.add('atom-workspace', {
        'nuclide-react-native:start-debugging': () => this._startDebugging(),
      }),
      new Disposable(() => {
        if (this._startDebuggingSubscription != null) {
          this._startDebuggingSubscription.unsubscribe();
        }
      }),
    );
  }

  dispose(): void {
    this._disposables.dispose();
  }

  _startDebugging(): void {
    if (this._startDebuggingSubscription != null) {
      this._startDebuggingSubscription.unsubscribe();
    }

    // Stop any current debugger and show the debugger view.
    const workspace = atom.views.getView(atom.workspace);
    atom.commands.dispatch(workspace, 'nuclide-debugger:stop-debugging');
    atom.commands.dispatch(workspace, 'nuclide-debugger:show');

    const debuggerServiceStream = Rx.Observable.fromPromise(
      consumeFirstProvider('nuclide-debugger.remote')
    );
    const processInfoLists = Rx.Observable.fromPromise(getProcessInfoList());
    this._startDebuggingSubscription = debuggerServiceStream.combineLatest(processInfoLists)
      .subscribe(([debuggerService, processInfoList]) => {
        const processInfo = processInfoList[0];
        if (processInfo != null) {
          debuggerService.startDebugging(processInfo);
        }
      });
  }

  provideNuclideDebugger(): nuclide_debugger$Service {
    return {
      name: 'React Native',
      getProcessInfoList,
    };
  }

}

function getProcessInfoList(): Promise<Array<DebuggerProcessInfo>> {
  // TODO(matthewwithanm): Use project root instead of first directory.
  const currentProjectDir = atom.project.getDirectories()[0];

  // TODO: Check if it's an RN app?
  // TODO: Query packager for running RN app?

  if (currentProjectDir == null) {
    return Promise.resolve([]);
  }

  const targetUri = currentProjectDir.getPath();
  return Promise.resolve([new ReactNativeProcessInfo(targetUri)]);
}
