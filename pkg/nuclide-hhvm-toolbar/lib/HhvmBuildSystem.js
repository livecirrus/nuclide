'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Task, TaskInfo} from '../../nuclide-task-runner/lib/types';
import type {ArcToolbarModel as ArcToolbarModelType} from './ArcToolbarModel';
import type {CwdApi} from '../../nuclide-current-working-directory/lib/CwdApi';

import {DisposableSubscription} from '../../commons-node/stream';
import {observableFromSubscribeFunction} from '../../commons-node/event';
import HhvmIcon from './ui/HhvmIcon';
import {createExtraUiComponent} from './ui/createExtraUiComponent';
import {Observable} from 'rxjs';

export default class ArcBuildSystem {
  _model: ArcToolbarModelType;
  _extraUi: ?ReactClass<any>;
  id: string;
  name: string;
  _tasks: ?Observable<Array<Task>>;
  _cwdApi: ?CwdApi;

  constructor() {
    this.id = 'hhvm';
    this._model = this._getModel();
    this.name = this._model.getName();
  }

  setCwdApi(cwdApi: ?CwdApi): void {
    this._cwdApi = cwdApi;
    this._model.setCwdApi(cwdApi);
  }

  _getModel(): ArcToolbarModelType {
    let ArcToolbarModel;
    try {
      ArcToolbarModel = require('./fb/FbArcToolbarModel').FbArcToolbarModel;
    } catch (_) {
      ArcToolbarModel = require('./ArcToolbarModel').ArcToolbarModel;
    }
    return new ArcToolbarModel();
  }

  observeTasks(cb: (tasks: Array<Task>) => mixed): IDisposable {
    if (this._tasks == null) {
      this._tasks = Observable.concat(
        Observable.of(this._model.getTasks()),
        observableFromSubscribeFunction(this._model.onChange.bind(this._model))
          .map(() => this._model.getTasks()),
      );
    }
    return new DisposableSubscription(
      this._tasks.subscribe({next: cb})
    );
  }

  getExtraUi(): ReactClass<any> {
    if (this._extraUi == null) {
      this._extraUi = createExtraUiComponent(this._model);
    }
    return this._extraUi;
  }

  getIcon(): ReactClass<any> {
    return HhvmIcon;
  }

  runTask(taskType: string): TaskInfo {
    if (!this._model.getTasks().some(task => task.type === taskType)) {
      throw new Error(`There's no hhvm task named "${taskType}"`);
    }

    const run = getTaskRunFunction(this._model, taskType);
    const resultStream = Observable.fromPromise(run());

    // Currently, the `arc build` has no meaningul progress reporting,
    // So, we omit `observeProgress` and just use the indeterminate progress bar.
    return {
      cancel() {
        // FIXME: How can we cancel tasks?
      },
      onDidError(cb) {
        return new DisposableSubscription(
          resultStream.subscribe({error: cb}),
        );
      },
      onDidComplete(cb) {
        return new DisposableSubscription(
          // Add an empty error handler to avoid the "Unhandled Error" message. (We're handling it
          // above via the onDidError interface.)
          resultStream.subscribe({next: cb, error: () => {}}),
        );
      },
    };
  }
}

function getTaskRunFunction(model: ArcToolbarModelType, taskType: string): () => Promise<any> {
  switch (taskType) {
    case 'build':
      return () => model.arcBuild();
    default:
      throw new Error(`Invalid task type: ${taskType}`);
  }
}
