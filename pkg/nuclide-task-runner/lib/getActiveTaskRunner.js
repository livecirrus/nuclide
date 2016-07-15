'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {AppState, TaskRunner} from './types';

export function getActiveTaskRunner(state: AppState): ?TaskRunner {
  const activeTaskRunnerId = state.activeTaskId && state.activeTaskId.taskRunnerId;
  return activeTaskRunnerId == null
    ? null
    : state.taskRunners.get(activeTaskRunnerId);
}
