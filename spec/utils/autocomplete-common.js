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

export type AutocompleteSuggestion = {
  word: string;
  leftLabel: string;
  rightLabel: string;
};

export function getAutocompleteView(): ?HTMLElement {
  const view = atom.views.getView(atom.workspace);
  return view.querySelector('.autocomplete-plus');
}

export function waitsForAutocompleteSuggestions(): void {
  waitsFor('autocomplete suggestions to load', 10000, () => {
    const view = getAutocompleteView();
    return view != null && view.querySelector('li') != null;
  });
}

export function getAutocompleteSuggestions(): Array<AutocompleteSuggestion> {
  const view = getAutocompleteView();
  if (view == null) {
    return [];
  }

  const items = Array.from(view.querySelectorAll('li'));

  return items.map(node => {
    const word = node.querySelector('.word').innerText;
    const leftLabel = node.querySelector('.left-label').innerText;
    const rightLabel = node.querySelector('.right-label').innerText;
    invariant(word != null);
    invariant(leftLabel != null);
    invariant(rightLabel != null);
    return {
      word,
      leftLabel,
      rightLabel,
    };
  });

}

export function getAutocompleteDescription(): ?string {
  const autocompleteView = getAutocompleteView();
  if (autocompleteView == null) {
    return null;
  }
  const typeHintView = autocompleteView.querySelector('.suggestion-description-content');
  if (typeHintView == null) {
    return null;
  }
  return typeHintView.innerText;
}
