'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import invariant from 'assert';

import {
  activateAllPackages,
  busySignal,
  copyFixture,
  deactivateAllPackages,
  dispatchKeyboardEvent,
  jasmineIntegrationTestSetup,
  waitsForFile, waitsForFilePosition,
} from '../pkg/nuclide-integration-test-helpers';
import {
  getAutocompleteView,
  getAutocompleteSuggestions,
  waitsForAutocompleteSuggestions,
} from './utils/autocomplete-common';

import nuclideUri from '../pkg/nuclide-remote-uri';

/**
 * This is a full integration test for (local) Objective-C support in Nuclide.
 * After loading a test Buck project, this tests:
 *
 * 1. autocompletion support
 * 2. diagnostics for errors
 * 3. outline view
 * 4. go-to-definition with Hyperclick
 */
describe('Clang Integration Test (objc)', () => {
  it('handles basic IDE commands', () => {
    let objcPath;
    let textEditor: atom$TextEditor;
    waitsForPromise({timeout: 60000}, async () => {
      jasmineIntegrationTestSetup();
      // Activate atom packages.
      await activateAllPackages();

      objcPath = await copyFixture('objc_project_1');
      textEditor = await atom.workspace.open(nuclideUri.join(objcPath, 'Hello.m'));
    });

    waitsForFile('Hello.m');

    waitsFor('compilation to begin', 10000, () => {
      return busySignal.isBusy();
    });

    waitsFor('compilation to finish', 30000, () => {
      return !busySignal.isBusy();
    });

    runs(() => {
      // Trigger autocompletion.
      textEditor.setCursorBufferPosition([17, 1]);
      textEditor.insertText('N');
      textEditor.insertText('S');
      textEditor.insertText('O');
    });

    waitsForAutocompleteSuggestions();

    runs(() => {
      const items = getAutocompleteSuggestions();
      expect(items[0]).toEqual({
        word: 'NSObject',
        leftLabel: '',
        rightLabel: 'ObjCInterface',
      });

      // Confirm autocomplete.
      dispatchKeyboardEvent('enter', document.activeElement);
      expect(getAutocompleteView()).not.toExist();
      const lineText = textEditor.lineTextForBufferRow(textEditor.getCursorBufferPosition().row);
      expect(lineText).toBe('{NSObject');

      // This is a clear syntax error, so we should get an error on save.
      textEditor.save();
    });

    waitsFor('error to show up in diagnostics', 10000, () => {
      const errors = atom.views.getView(atom.workspace)
        .querySelector('.nuclide-diagnostics-highlight-group > :first-child');
      if (errors instanceof HTMLElement) {
        const innerText = errors.innerText;
        invariant(innerText != null);
        return innerText.trim() === '1';
      }
    });

    runs(() => {
      // Keyboard shortcut for outline view.
      dispatchKeyboardEvent('o', document.activeElement, {alt: true});
    });

    let names;
    waitsFor('outline view to load', 10000, () => {
      names = atom.views.getView(atom.workspace)
        .querySelectorAll('.nuclide-outline-view-item .name');
      return names.length > 0;
    });

    runs(() => {
      function getData(node) {
        return {
          name: node.innerText,
          classes: node.className.split(' ').sort(),
        };
      }
      expect(getData(names[0])).toEqual({
        name: 'Hello',
        classes: ['class', 'entity', 'name'],
      });
      expect(getData(names[1])).toEqual({
        name: 'say:',
        classes: ['entity', 'function', 'name'],
      });
      expect(getData(names[names.length - 1])).toEqual({
        name: 'main',
        classes: ['entity', 'function', 'name'],
      });

      // Trigger Hyperclick on NSLog(...)
      textEditor.setCursorBufferPosition([11, 5]);
      dispatchKeyboardEvent('enter', document.activeElement, {cmd: true, alt: true});
    });

    waitsForFilePosition('FoundationStub.h', 45, 12);

    runs(() => {
      // Deactivate nuclide packages.
      deactivateAllPackages();
    });
  });
});
