'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

export type TaskType = 'build' | 'test' | 'run' | 'debug';

export type BuckSubcommand = 'build' | 'install' | 'test';

export type TaskSettings = {
  arguments?: Array<string>;
};

export type SerializedState = {
  buildTarget: ?string;
  isReactNativeServerMode: boolean;
  taskSettings?: {[key: TaskType]: TaskSettings};
};
