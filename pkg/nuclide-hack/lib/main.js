'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {TypeHint} from '../../nuclide-type-hint/lib/types';
import type {
  BusySignalProviderBase as BusySignalProviderBaseType,
} from '../../nuclide-busy-signal';
import type {OutlineProvider} from '../../nuclide-outline-view';
import type {NuclideEvaluationExpressionProvider} from '../../nuclide-debugger-interfaces/service';
import type {DefinitionProvider} from '../../nuclide-definition-service';
import type {CoverageProvider} from '../../nuclide-type-coverage/lib/types';
import type {FindReferencesProvider} from '../../nuclide-find-references';

import CodeHighlightProvider from './CodeHighlightProvider';
import {CompositeDisposable, Disposable} from 'atom';
import {HACK_GRAMMARS} from '../../nuclide-hack-common';
import {TypeCoverageProvider} from './TypeCoverageProvider';
import {OutlineViewProvider} from './OutlineViewProvider';
import {HackDefinitionProvider} from './HackDefinitionProvider';
import {onDidRemoveProjectPath} from '../../commons-atom/projects';
import AutocompleteProvider from './AutocompleteProvider';
import {ServerConnection} from '../../nuclide-remote-connection';
import {clearHackLanguageCache} from './HackLanguage';

const HACK_GRAMMARS_STRING = HACK_GRAMMARS.join(', ');
const PACKAGE_NAME = 'nuclide-hack';

let subscriptions: ?CompositeDisposable = null;
let hackDiagnosticsProvider;
let busySignalProvider;
let coverageProvider = null;
let definitionProvider: ?DefinitionProvider = null;

export function activate() {
  const {getCachedHackLanguageForUri} = require('./HackLanguage');
  subscriptions = new CompositeDisposable();
  subscriptions.add(onDidRemoveProjectPath(projectPath => {
    const hackLanguage = getCachedHackLanguageForUri(projectPath);
    if (hackLanguage) {
      hackLanguage.dispose();
    }
    if (hackDiagnosticsProvider) {
      hackDiagnosticsProvider.invalidateProjectPath(projectPath);
    }
  }));
  subscriptions.add(ServerConnection.onDidCloseServerConnection(clearHackLanguageCache));
  subscriptions.add(new Disposable(clearHackLanguageCache));
}

/** Provider for autocomplete service. */
export function createAutocompleteProvider(): atom$AutocompleteProvider {
  const autocompleteProvider = new AutocompleteProvider();

  return {
    selector: HACK_GRAMMARS.map(grammar => '.' + grammar).join(', '),
    inclusionPriority: 1,
    // The context-sensitive hack autocompletions are more relevant than snippets.
    suggestionPriority: 3,
    excludeLowerPriority: false,

    getSuggestions(
      request: atom$AutocompleteRequest,
    ): Promise<?Array<atom$AutocompleteSuggestion>> {
      return autocompleteProvider.getAutocompleteSuggestions(request);
    },
  };
}

/** Provider for code format service. */
export function createCodeFormatProvider(): any {
  const CodeFormatProvider = require('./CodeFormatProvider');
  const codeFormatProvider = new CodeFormatProvider();

  return {
    selector: HACK_GRAMMARS_STRING,
    inclusionPriority: 1,

    formatCode(editor: atom$TextEditor, range: atom$Range): Promise<string> {
      return codeFormatProvider.formatCode(editor, range);
    },
  };
}

export function createFindReferencesProvider(): FindReferencesProvider {
  return require('./FindReferencesProvider');
}

export function createTypeHintProvider(): any {
  const TypeHintProvider = require('./TypeHintProvider');
  const typeHintProvider = new TypeHintProvider();

  return {
    selector: HACK_GRAMMARS_STRING,
    inclusionPriority: 1,
    providerName: PACKAGE_NAME,

    typeHint(editor: atom$TextEditor, position: atom$Point): Promise<?TypeHint> {
      return typeHintProvider.typeHint(editor, position);
    },
  };
}

export function createCodeHighlightProvider(): any {
  const codeHighlightProvider = new CodeHighlightProvider();

  return {
    selector: HACK_GRAMMARS_STRING,
    inclusionPriority: 1,
    highlight(editor: atom$TextEditor, position: atom$Point): Promise<Array<atom$Range>> {
      return codeHighlightProvider.highlight(editor, position);
    },
  };
}

export function createEvaluationExpressionProvider(): NuclideEvaluationExpressionProvider {
  const {HackEvaluationExpressionProvider} = require('./HackEvaluationExpressionProvider');
  const evaluationExpressionProvider = new HackEvaluationExpressionProvider();
  const getEvaluationExpression =
    evaluationExpressionProvider.getEvaluationExpression.bind(evaluationExpressionProvider);
  return {
    selector: HACK_GRAMMARS_STRING,
    name: PACKAGE_NAME,
    getEvaluationExpression,
  };
}

export function provideDiagnostics() {
  if (!hackDiagnosticsProvider) {
    const HackDiagnosticsProvider = require('./HackDiagnosticsProvider');
    const busyProvider = provideBusySignal();
    hackDiagnosticsProvider = new HackDiagnosticsProvider(false, busyProvider);
  }
  return hackDiagnosticsProvider;
}

export function deactivate(): void {
  if (subscriptions) {
    subscriptions.dispose();
    subscriptions = null;
  }
  if (hackDiagnosticsProvider) {
    hackDiagnosticsProvider.dispose();
    hackDiagnosticsProvider = null;
  }
}

export function provideOutlines(): OutlineProvider {
  const provider = new OutlineViewProvider();
  return {
    grammarScopes: HACK_GRAMMARS,
    priority: 1,
    name: 'Hack',
    getOutline: provider.getOutline.bind(provider),
  };
}

function provideBusySignal(): BusySignalProviderBaseType {
  if (busySignalProvider == null) {
    // eslint-disable-next-line nuclide-internal/no-cross-atom-imports
    const {BusySignalProviderBase} = require('../../nuclide-busy-signal');
    busySignalProvider = new BusySignalProviderBase();
  }
  return busySignalProvider;
}

export function provideCoverage(): CoverageProvider {
  return {
    displayName: 'Hack',
    priority: 10,
    grammarScopes: HACK_GRAMMARS,
    getCoverage(path) {
      return getTypeCoverageProvider().getTypeCoverage(path);
    },
  };
}

function getTypeCoverageProvider(): TypeCoverageProvider {
  if (coverageProvider == null) {
    coverageProvider = new TypeCoverageProvider(provideBusySignal());
  }
  return coverageProvider;
}

export function provideDefinitions(): DefinitionProvider {
  if (definitionProvider == null) {
    definitionProvider = new HackDefinitionProvider();
  }
  return definitionProvider;
}
