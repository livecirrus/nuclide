'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import RelatedFileFinder from './RelatedFileFinder';
import {trackOperationTiming} from '../../nuclide-analytics';
import featureConfig from '../../nuclide-feature-config';

/**
 * Sets up listeners so the user can jump to related files.
 *
 * Clients must call `dispose()` once they're done with an instance.
 */
export default class JumpToRelatedFile {
  _commandSubscriptionsMap: Map<any, any>;

  constructor() {
    this._commandSubscriptionsMap = new Map();
  }

  dispose(): void {
    this._commandSubscriptionsMap.forEach(subscription => subscription.dispose());
    this._commandSubscriptionsMap.clear();
  }

  enableInTextEditor(textEditor: TextEditor) {
    if (this._commandSubscriptionsMap.has(textEditor)) {
      return; // Already enabled.
    }

    const textEditorEl = atom.views.getView(textEditor);
    const commandSubscription = atom.commands.add(
      textEditorEl,
      {
        'nuclide-related-files:jump-to-next-related-file': () => {
          const path = textEditor.getPath();
          if (path) {
            trackOperationTiming(
              'nuclide-related-files:jump-to-next-related-file',
              async () => this._open(await this.getNextRelatedFile(path)),
            );
          }
        },
        'nuclide-related-files:jump-to-previous-related-file': () => {
          const path = textEditor.getPath();
          if (path) {
            trackOperationTiming(
              'nuclide-related-files:jump-to-previous-related-file',
              async () => this._open(await this.getPreviousRelatedFile(path)),
            );
          }
        },
      });
    this._commandSubscriptionsMap.set(textEditor, commandSubscription);

    textEditor.onDidDestroy(this._disableInTextEditor.bind(this, textEditor));
  }

  _disableInTextEditor(textEditor: TextEditor): void {
    const subscription = this._commandSubscriptionsMap.get(textEditor);
    if (subscription) {
      subscription.dispose();
      this._commandSubscriptionsMap.delete(textEditor);
    }
  }

  /**
   * Gets the next related file, which Xcode defines as the one that comes
   * before the current one alphabetically.
   */
  async getNextRelatedFile(path: string): Promise<string> {
    const {relatedFiles, index} = await RelatedFileFinder.find(path);
    return relatedFiles[(relatedFiles.length + index - 1) % relatedFiles.length];
  }

  /**
   * Gets the previous related file, which Xcode defines as the one that comes
   * after the current one alphabetically.
   */
  async getPreviousRelatedFile(path: string): Promise<string> {
    const {relatedFiles, index} = await RelatedFileFinder.find(path);
    return relatedFiles[(index + 1) % relatedFiles.length];
  }

  _open(path: string) {
    if (featureConfig.get('nuclide-related-files.openInNextPane')) {
      atom.workspace.activateNextPane();
    }
    atom.workspace.open(path, {searchAllPanes: true});
  }

}
