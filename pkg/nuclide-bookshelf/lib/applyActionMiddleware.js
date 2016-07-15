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
  Action,
  ActionTypeValue,
  AddProjectRepositoryAction,
  BookShelfState,
  RestorePaneItemStateAction,
} from './types';
import type {HgRepositoryClientAsync} from '../../nuclide-hg-repository-client';

import {ActionType, EMPTY_SHORTHEAD} from './constants';
import {getRepoPathToEditors} from './utils';
import invariant from 'assert';
import {observableFromSubscribeFunction} from '../../commons-node/event';
import {Observable} from 'rxjs';

const HANDLED_ACTION_TYPES = [
  ActionType.ADD_PROJECT_REPOSITORY,
  ActionType.RESTORE_PANE_ITEM_STATE,
];

function getActionsOfType(actions: Observable<Action>, type: ActionTypeValue): Observable<Action> {
  return actions.filter(action => action.type === type);
}

export function applyActionMiddleware(
  actions: Observable<Action>,
  getState: () => BookShelfState,
): Observable<Action> {
  const output = Observable.merge(
    // Let the unhandled ActionTypes pass through.
    actions.filter(action => HANDLED_ACTION_TYPES.indexOf(action.type) === -1),

    getActionsOfType(actions, ActionType.ADD_PROJECT_REPOSITORY).flatMap(action => {
      invariant(action.type === ActionType.ADD_PROJECT_REPOSITORY);
      return watchProjectRepository(action, getState);
    }),

    getActionsOfType(actions, ActionType.RESTORE_PANE_ITEM_STATE).switchMap(action => {
      invariant(action.type === ActionType.RESTORE_PANE_ITEM_STATE);
      return restorePaneItemState(action, getState);
    }),
  );
  return output.share();
}

function watchProjectRepository(
  action: AddProjectRepositoryAction,
  getState: () => BookShelfState,
): Observable<Action> {

  const {repository} = action.payload;
  const repositoryAsync: HgRepositoryClientAsync = (repository.async: any);
  // Type was checked with `getType`. Downcast to safely access members with Flow.
  return Observable.merge(
    observableFromSubscribeFunction(
      // Re-fetch when the list of bookmarks changes.
      repositoryAsync.onDidChangeBookmarks.bind(repositoryAsync)
    ),
    observableFromSubscribeFunction(
      // Re-fetch when the active bookmark changes (called "short head" to match
      // Atom's Git API).
      repositoryAsync.onDidChangeShortHead.bind(repositoryAsync)
    )
  )
  .startWith(null) // Kick it off the first time
  .switchMap(() => Observable.fromPromise(repositoryAsync.getBookmarks()))
  .map(bookmarks => {
    const bookmarkNames = new Set(
      bookmarks.map(bookmark => bookmark.bookmark).concat([EMPTY_SHORTHEAD])
    );

    const activeBookmark = bookmarks.filter(bookmark => bookmark.active)[0];
    const activeShortHead = activeBookmark == null
      ? EMPTY_SHORTHEAD
      : activeBookmark.bookmark;

    return {
      payload: {
        activeShortHead,
        bookmarkNames,
        repository,
      },
      type: ActionType.UPDATE_REPOSITORY_BOOKMARKS,
    };
  })
  .takeUntil(observableFromSubscribeFunction(repository.onDidDestroy.bind(repository)))
  .concat(Observable.of({
    payload: {
      repository,
    },
    type: ActionType.REMOVE_PROJECT_REPOSITORY,
  }));
}

function restorePaneItemState(
  action: RestorePaneItemStateAction,
  getState: () => BookShelfState,
): Observable<Action> {
  const {repository, shortHead} = action.payload;

  const repositoryState = getState().repositoryPathToState.get(
    repository.getWorkingDirectory(),
  );
  if (repositoryState == null) {
    return Observable.empty();
  }

  // TODO(most): refactor to a `Set` all the way.
  const fileUris = new Set(repositoryState.shortHeadsToFileList.get(shortHead) || []);

  const oldOpenEditors = getRepoPathToEditors().get(repository.getWorkingDirectory()) || [];
  const oldOpenUris = oldOpenEditors.map(textEditor => textEditor.getPath() || '');

  const editorsToReload = oldOpenEditors
    .filter(textEditor => fileUris.has(textEditor.getPath() || ''));
  const editorsToClose = oldOpenEditors
    .filter(textEditor => !fileUris.has(textEditor.getPath() || ''));
  const urisToOpen = Array.from(fileUris)
    .filter(fileUri => oldOpenUris.indexOf(fileUri) === -1);

  return Observable.concat(
    Observable.of({
      payload: {
        repository,
      },
      type: ActionType.START_RESTORING_REPOSITORY_STATE,
    }),
    Observable.from(editorsToClose)
      // Close the open files from the old short head.
      .map(textEditor => {
        const editorPane = atom.workspace.paneForItem(textEditor);
        invariant(editorPane);
        editorPane.destroyItem(textEditor);
      })
      .ignoreElements(),
    // Note: the reloading step can be omitted if the file watchers are proven to be robust.
    // But that's not the case; hence, a reload on bookmark switch/restore doesn't hurt.
    Observable.from(editorsToReload)
      .flatMap(textEditor => {
        // Reload the open files that also exist to be in the current.
        if (textEditor.isModified()) {
          // If the filesystem version has changed while it's edited,
          // the user will be prompted to resolve the conflict: `file-watcher`.
          return Observable.empty();
        } else {
          return Observable.fromPromise(textEditor.getBuffer().load());
        }
      })
      .ignoreElements(),
    Observable.from(urisToOpen)
      .flatMap(fileUri => {
        return Observable.fromPromise(atom.workspace.open(fileUri));
      })
      .ignoreElements(),
    Observable.of({
      payload: {
        repository,
      },
      type: ActionType.COMPLETE_RESTORING_REPOSITORY_STATE,
    }),
  );
}
