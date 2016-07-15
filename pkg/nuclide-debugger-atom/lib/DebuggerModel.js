'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {DebuggerProviderStore} from './DebuggerProviderStore';
import BreakpointManager from './BreakpointManager';
import BreakpointStore from './BreakpointStore';
import DebuggerActions from './DebuggerActions';
import {DebuggerStore} from './DebuggerStore';
import {WatchExpressionStore} from './WatchExpressionStore';
import CallstackStore from './CallstackStore';
import LocalsStore from './LocalsStore';
import {WatchExpressionListStore} from './WatchExpressionListStore';
import DebuggerActionsStore from './DebuggerActionsStore';
import Bridge from './Bridge';
import {CompositeDisposable} from 'atom';
import {Dispatcher} from 'flux';

import type {SerializedState} from '..';

/**
 * Atom ViewProvider compatible model object.
 */
class DebuggerModel {
  _disposables: CompositeDisposable;
  _actions: DebuggerActions;
  _breakpointManager: BreakpointManager;
  _breakpointStore: BreakpointStore;
  _dispatcher: Dispatcher;
  _store: DebuggerStore;
  _watchExpressionStore: WatchExpressionStore;
  _watchExpressionListStore: WatchExpressionListStore;
  _debuggerProviderStore: DebuggerProviderStore;
  _debuggerActionStore: DebuggerActionsStore;
  _callstackStore: CallstackStore;
  _localsStore: LocalsStore;
  _bridge: Bridge;

  constructor(state: ?SerializedState) {
    this._dispatcher = new Dispatcher();
    this._store = new DebuggerStore(this._dispatcher);
    this._actions = new DebuggerActions(this._dispatcher, this._store);
    this._breakpointStore = new BreakpointStore(
      this._dispatcher,
      state ? state.breakpoints : null, //serialized breakpoints
    );
    this._breakpointManager = new BreakpointManager(
      this._breakpointStore,
      this._actions,
    );
    this._bridge = new Bridge(this);
    this._debuggerProviderStore = new DebuggerProviderStore(this._dispatcher, this._actions);
    this._watchExpressionStore = new WatchExpressionStore(this._dispatcher, this._bridge);
    this._watchExpressionListStore = new WatchExpressionListStore(
      this._watchExpressionStore,
      this._dispatcher
    );
    this._debuggerActionStore = new DebuggerActionsStore(this._dispatcher, this._bridge);
    this._callstackStore = new CallstackStore(this._dispatcher);
    this._localsStore = new LocalsStore(this._dispatcher);

    this._disposables = new CompositeDisposable(
      this._store,
      this._actions,
      this._breakpointStore,
      this._breakpointManager,
      this._bridge,
      this._debuggerProviderStore,
      this._watchExpressionStore,
      this._debuggerActionStore,
      this._callstackStore,
      this._localsStore,
    );
  }

  dispose() {
    this._disposables.dispose();
  }

  getActions(): DebuggerActions {
    return this._actions;
  }

  getStore(): DebuggerStore {
    return this._store;
  }

  getWatchExpressionStore(): WatchExpressionStore {
    return this._watchExpressionStore;
  }

  getWatchExpressionListStore(): WatchExpressionListStore {
    return this._watchExpressionListStore;
  }

  getDebuggerProviderStore(): DebuggerProviderStore {
    return this._debuggerProviderStore;
  }

  getBreakpointStore(): BreakpointStore {
    return this._breakpointStore;
  }

  getCallstackStore(): CallstackStore {
    return this._callstackStore;
  }

  getLocalsStore(): LocalsStore {
    return this._localsStore;
  }

  getBridge(): Bridge {
    return this._bridge;
  }
}

module.exports = DebuggerModel;
