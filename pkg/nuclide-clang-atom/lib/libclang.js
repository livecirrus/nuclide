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
  ClangCompileResult,
  ClangCompletion,
  ClangDeclaration,
  ClangOutlineTree,
} from '../../nuclide-clang/lib/rpc-types';
import typeof * as ClangService from '../../nuclide-clang';

import featureConfig from '../../nuclide-feature-config';
import invariant from 'assert';
import {getServiceByNuclideUri} from '../../nuclide-remote-connection';

type NuclideClangConfig = {
  enableDefaultFlags: boolean;
  defaultFlags: Array<string>;
};

function getDefaultFlags(): ?Array<string> {
  const config: NuclideClangConfig = (featureConfig.get('nuclide-clang-atom'): any);
  if (!config.enableDefaultFlags) {
    return null;
  }
  return config.defaultFlags;
}

const clangServices = new WeakSet();

module.exports = {

  async getDiagnostics(
    editor: atom$TextEditor,
  ): Promise<?ClangCompileResult> {
    const src = editor.getPath();
    if (src == null) {
      return null;
    }
    const contents = editor.getText();

    const defaultFlags = getDefaultFlags();
    const service: ?ClangService = getServiceByNuclideUri('ClangService', src);
    invariant(service);

    // When we fetch diagnostics for the first time, reset the server state.
    // This is so the user can easily refresh the Clang + Buck state by reloading Atom.
    if (!clangServices.has(service)) {
      clangServices.add(service);
      await service.reset();
    }

    return service
        .compile(src, contents, defaultFlags)
        .toPromise();
  },

  async getCompletions(editor: atom$TextEditor, prefix: string): Promise<?Array<ClangCompletion>> {
    const src = editor.getPath();
    if (src == null) {
      return null;
    }
    const cursor = editor.getLastCursor();

    const line = cursor.getBufferRow();
    const column = cursor.getBufferColumn();
    const tokenStartColumn = column - prefix.length;

    const defaultFlags = getDefaultFlags();
    const service: ?ClangService = getServiceByNuclideUri('ClangService', src);
    invariant(service);

    return service
      .getCompletions(
        src,
        editor.getText(),
        line,
        column,
        tokenStartColumn,
        prefix,
        defaultFlags,
      );
  },

  /**
   * If a location can be found for the declaration, it will be available via
   * the 'location' field on the returned object.
   */
  async getDeclaration(
    editor: atom$TextEditor,
    line: number,
    column: number,
  ): Promise<?ClangDeclaration> {
    const src = editor.getPath();
    if (src == null) {
      return null;
    }
    const defaultFlags = getDefaultFlags();

    const service: ?ClangService = getServiceByNuclideUri('ClangService', src);
    invariant(service);

    return service
        .getDeclaration(src, editor.getText(), line, column, defaultFlags);
  },

  async getOutline(editor: atom$TextEditor): Promise<?Array<ClangOutlineTree>> {
    const src = editor.getPath();
    if (src == null) {
      return null;
    }
    const defaultFlags = getDefaultFlags();

    const service: ?ClangService = getServiceByNuclideUri('ClangService', src);
    invariant(service);

    return service
        .getOutline(src, editor.getText(), defaultFlags);
  },

  async formatCode(editor: atom$TextEditor, range: atom$Range): Promise<{
    newCursor?: number;
    formatted: string;
  }> {
    const fileUri = editor.getPath();
    const buffer = editor.getBuffer();
    const cursor = buffer.characterIndexForPosition(editor.getLastCursor().getBufferPosition());
    if (fileUri == null) {
      return {
        formatted: editor.getText(),
      };
    }
    const startIndex = buffer.characterIndexForPosition(range.start);
    const endIndex = buffer.characterIndexForPosition(range.end);

    const service: ?ClangService = getServiceByNuclideUri('ClangService', fileUri);
    invariant(service);

    return {...(await service
        .formatCode(fileUri, editor.getText(), cursor, startIndex, endIndex - startIndex))};
  },

  reset(editor: atom$TextEditor) {
    const src = editor.getPath();
    if (src != null) {
      const service: ?ClangService = getServiceByNuclideUri('ClangService', src);
      invariant(service);
      return service.reset(src);
    }
  },

};
