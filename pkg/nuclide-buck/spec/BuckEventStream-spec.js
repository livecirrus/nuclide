'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import Rx from 'rxjs';
import {combineEventStreams} from '../lib/BuckEventStream';

describe('combineEventStreams', () => {

  let socketSubject;
  let processSubject;

  beforeEach(() => {
    socketSubject = new Rx.Subject();
    processSubject = new Rx.Subject();
  });

  it('takes non-log-level messages from the process', () => {
    waitsForPromise(async () => {
      const combinedStream = combineEventStreams('build', socketSubject, processSubject);
      const promise = combinedStream.toArray().toPromise();

      socketSubject.next({type: 'progress', progress: 0});

      processSubject.next({type: 'log', message: 'skip', level: 'log'});
      processSubject.next({type: 'log', message: 'take1', level: 'error'});
      processSubject.next({type: 'log', message: 'take2', level: 'log'});
      processSubject.complete();

      const result = await promise;
      expect(result).toEqual([
        {type: 'progress', progress: 0},
        {type: 'log', message: 'take1', level: 'error'},
        {type: 'log', message: 'take2', level: 'log'},
      ]);
    });
  });

  it('falls back to process output when socket is empty', () => {
    waitsForPromise(async () => {
      const combinedStream = combineEventStreams('build', socketSubject, processSubject);
      const promise = combinedStream.toArray().toPromise();

      processSubject.next({type: 'log', message: 'take1', level: 'log'});
      processSubject.next({type: 'log', message: 'take2', level: 'log'});
      processSubject.next({type: 'log', message: 'take3', level: 'error'});
      processSubject.complete();

      const result = await promise;
      expect(result).toEqual([
        {type: 'log', message: 'take1', level: 'log'},
        {type: 'log', message: 'take2', level: 'log'},
        {type: 'log', message: 'take3', level: 'error'},
      ]);
    });
  });

  it('test: takes process messages after build finishes', () => {
    waitsForPromise(async () => {
      const combinedStream = combineEventStreams('test', socketSubject, processSubject);
      const promise = combinedStream.toArray().toPromise();

      processSubject.next({type: 'log', message: 'skip', level: 'log'});
      socketSubject.next({type: 'progress', progress: 1});
      processSubject.next({type: 'log', message: 'take', level: 'log'});
      processSubject.complete();

      const result = await promise;
      expect(result).toEqual([
        {type: 'progress', progress: null},
        {type: 'log', message: 'take', level: 'log'},
      ]);
    });
  });

  it('install: adds installing message after build finish', () => {
    waitsForPromise(async () => {
      const combinedStream = combineEventStreams('install', socketSubject, processSubject);
      const promise = combinedStream.toArray().toPromise();

      socketSubject.next({type: 'progress', progress: 1});
      processSubject.next({type: 'log', message: 'skip', level: 'log'});
      processSubject.complete();

      const result = await promise;
      expect(result).toEqual([
        {type: 'progress', progress: 1},
        {type: 'progress', progress: null},
        {type: 'log', message: 'Installing...', level: 'info'},
      ]);
    });
  });

});
