'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {
  DiagnosticUpdater,
  CallbackDiagnosticProvider,
  LinterProvider,
  ObservableDiagnosticProvider,
  ObservableDiagnosticUpdater,
} from '../../nuclide-diagnostics-base';

import {Disposable, CompositeDisposable} from 'atom';
import featureConfig from '../../nuclide-feature-config';
import {DisposableSubscription} from '../../commons-node/stream';
import {observableFromSubscribeFunction} from '../../commons-node/event';
import {getLogger} from '../../nuclide-logging';
import {DiagnosticStore} from '../../nuclide-diagnostics-base';

import {createAdapters} from './LinterAdapterFactory';

const legacyLinterSetting = 'nuclide-diagnostics-store.consumeLegacyLinters';

const legacyLintOnTheFlySetting = 'nuclide-diagnostics-store.legacyLintOnTheFly';

let disposables = null;
let diagnosticStore = null;
let diagnosticUpdater = null;
let observableDiagnosticUpdater: ?ObservableDiagnosticUpdater;

function addDisposable(disposable: IDisposable) {
  if (disposables) {
    disposables.add(disposable);
  } else {
    getLogger().error('disposables is null');
  }
}

function getDiagnosticStore(): DiagnosticStore {
  if (!diagnosticStore) {
    diagnosticStore = new DiagnosticStore();
  }
  return diagnosticStore;
}

/**
 * @return A wrapper around the methods on DiagnosticStore that allow reading data.
 */
export function provideDiagnosticUpdates(): DiagnosticUpdater {
  if (!diagnosticUpdater) {
    const store = getDiagnosticStore();
    diagnosticUpdater = {
      onFileMessagesDidUpdate: store.onFileMessagesDidUpdate.bind(store),
      onProjectMessagesDidUpdate: store.onProjectMessagesDidUpdate.bind(store),
      onAllMessagesDidUpdate: store.onAllMessagesDidUpdate.bind(store),
      applyFix: store.applyFix.bind(store),
      applyFixesForFile: store.applyFixesForFile.bind(store),
    };
  }
  return diagnosticUpdater;
}

export function provideObservableDiagnosticUpdates(): ObservableDiagnosticUpdater {
  if (observableDiagnosticUpdater == null) {
    const store = getDiagnosticStore();
    observableDiagnosticUpdater = {
      getFileMessageUpdates: path => store.getFileMessageUpdates(path),
      projectMessageUpdates: store.getProjectMessageUpdates(),
      allMessageUpdates: store.getAllMessageUpdates(),
      applyFix: message => store.applyFix(message),
      applyFixesForFile: file => store.applyFixesForFile(file),
    };
  }
  return observableDiagnosticUpdater;
}

let consumeLegacyLinters = false;
let lintOnTheFly = false;
const allLinterAdapters = new Set();

export function activate(state: ?Object): void {
  if (!disposables) {
    disposables = new CompositeDisposable();
  }

  // Returns mixed so a cast is necessary.
  consumeLegacyLinters = ((featureConfig.get(legacyLinterSetting): any): boolean);
  featureConfig.observe(legacyLinterSetting, newValue => {
    // To make this really solid, we should also probably trigger the linter
    // for the active text editor. Possibly more trouble than it's worth,
    // though, since this may be a temporary option.
    consumeLegacyLinters = newValue;
    allLinterAdapters.forEach(adapter => adapter.setEnabled(newValue));
  });

  lintOnTheFly = ((featureConfig.get(legacyLintOnTheFlySetting): any): boolean);
  featureConfig.observe(legacyLintOnTheFlySetting, newValue => {
    lintOnTheFly = newValue;
    allLinterAdapters.forEach(adapter => adapter.setLintOnFly(newValue));
  });
}

export function consumeLinterProvider(
  provider: LinterProvider | Array<LinterProvider>,
): IDisposable {
  const newAdapters = createAdapters(provider);
  const adapterDisposables = new CompositeDisposable();
  for (const adapter of newAdapters) {
    adapter.setEnabled(consumeLegacyLinters);
    adapter.setLintOnFly(lintOnTheFly);
    allLinterAdapters.add(adapter);
    const diagnosticDisposable = consumeDiagnosticsProviderV1(adapter);
    const adapterDisposable = new Disposable(() => {
      diagnosticDisposable.dispose();
      adapter.dispose();
      allLinterAdapters.delete(adapter);
    });
    adapterDisposables.add(adapterDisposable);
    addDisposable(adapter);
  }
  return adapterDisposables;
}

export function consumeDiagnosticsProviderV1(provider: CallbackDiagnosticProvider): IDisposable {
  // Register the diagnostic store for updates from the new provider.
  const observableProvider = {
    updates: observableFromSubscribeFunction(provider.onMessageUpdate.bind(provider)),
    invalidations: observableFromSubscribeFunction(provider.onMessageInvalidation.bind(provider)),
  };
  const disposable = consumeDiagnosticsProviderV2(observableProvider);
  addDisposable(disposable);
  return disposable;
}

export function consumeDiagnosticsProviderV2(provider: ObservableDiagnosticProvider): IDisposable {
  const compositeDisposable = new CompositeDisposable();
  const store = getDiagnosticStore();

  compositeDisposable.add(
    new DisposableSubscription(
      provider.updates.subscribe(update => store.updateMessages(provider, update))
    )
  );
  compositeDisposable.add(
    new DisposableSubscription(
      provider.invalidations.subscribe(
        invalidation => store.invalidateMessages(provider, invalidation)
      )
    )
  );
  compositeDisposable.add(new Disposable(() => {
    store.invalidateMessages(provider, {scope: 'all'});
  }));

  return compositeDisposable;
}

export function deactivate() {
  if (disposables) {
    disposables.dispose();
    disposables = null;
  }
  if (diagnosticStore) {
    diagnosticStore.dispose();
    diagnosticStore = null;
  }
  diagnosticUpdater = null;
  observableDiagnosticUpdater = null;
}
