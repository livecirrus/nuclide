'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Executor} from '../lib/types';

import getCurrentExecutorId from '../lib/getCurrentExecutorId';
import Rx from 'rxjs';

const baseAppState = {
  currentExecutorId: 'a',
  maxMessageCount: Number.POSITIVE_INFINITY,
  executors: new Map([[
    'a', createDummyExecutor('a'),
  ]]),
  providers: new Map(),
  providerStatuses: new Map(),
  providerSubscriptions: new Map(),
  records: [],
};

describe('getCurrentExecutorId', () => {

  it('gets the current executor', () => {
    expect(getCurrentExecutorId(baseAppState)).toBe('a');
  });

  it('returns an executor even if the current id is null', () => {
    const appState = {
      ...baseAppState,
      currentExecutorId: null,
    };
    expect(getCurrentExecutorId(appState)).toBe('a');
  });

});


function createDummyExecutor(id: string): Executor {
  return {
    id,
    name: id,
    send: (code: string) => {},
    output: Rx.Observable.create(observer => {}),
  };
}
