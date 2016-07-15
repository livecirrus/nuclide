'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {NuclideUri} from '../../nuclide-remote-uri';
import type {CommitModeType, DiffModeType, UIProvider} from './types';
import type DiffViewModelType, {DiffEntityOptions} from './DiffViewModel';
import type FileTreeContextMenu from '../../nuclide-file-tree/lib/FileTreeContextMenu';
import type {HomeFragments} from '../../nuclide-home/lib/types';
import type {CwdApi} from '../../nuclide-current-working-directory/lib/CwdApi';
import type {GetToolBar} from '../../commons-atom/suda-tool-bar';

import {CompositeDisposable, Directory, Disposable} from 'atom';
import {React, ReactDOM} from 'react-for-atom';
import invariant from 'assert';
import url from 'url';
import {nuclideFeatures} from '../../../lib/nuclide-features';
import uiTreePath from '../../commons-atom/ui-tree-path';
import {repositoryForPath} from '../../nuclide-hg-git-bridge';
import {getLogger} from '../../nuclide-logging';
import {DiffMode, CommitMode} from './constants';
import DiffViewElement from './DiffViewElement';
import nuclideUri from '../../nuclide-remote-uri';

type SerializedDiffViewState = {
  visible: false;
} | {
  visible: true;
  activeFilePath: NuclideUri;
  viewMode: DiffModeType;
  commitMode: CommitModeType;
};

let diffViewModel: ?DiffViewModelType = null;
let activeDiffView: ?{
  component: React.Component<any, any, any>;
  element: HTMLElement;
} = null;

// This url style is the one Atom uses for the welcome and settings pages.
const NUCLIDE_DIFF_VIEW_URI = 'atom://nuclide/diff-view';
const DIFF_VIEW_FILE_TREE_CONTEXT_MENU_PRIORITY = 1000;
const COMMIT_FILE_TREE_CONTEXT_MENU_PRIORITY = 1100;
const AMEND_FILE_TREE_CONTEXT_MENU_PRIORITY = 1200;
const PUBLISH_FILE_TREE_CONTEXT_MENU_PRIORITY = 1300;

const uiProviders: Array<UIProvider> = [];

let subscriptions: ?CompositeDisposable = null;
let cwdApi: ?CwdApi = null;

function formatDiffViewUrl(diffEntityOptions?: ?DiffEntityOptions): string {
  if (diffEntityOptions == null) {
    diffEntityOptions = {file: ''};
  }
  return url.format({
    protocol: 'atom',
    host: 'nuclide',
    pathname: 'diff-view',
    slashes: true,
    query: diffEntityOptions,
  });
}


// To add a View as an Atom workspace pane, we return `DiffViewElement` which extends `HTMLElement`.
// This pattetn is also followed with atom's TextEditor.
function createView(diffEntityOptions: DiffEntityOptions): HTMLElement {
  if (activeDiffView) {
    activateDiffPath(diffEntityOptions);
    return activeDiffView.element;
  }
  const DiffViewComponent = require('./DiffViewComponent');

  const diffModel = getDiffViewModel();
  diffModel.activate();
  const hostElement = new DiffViewElement().initialize(diffModel, NUCLIDE_DIFF_VIEW_URI);
  const component = ReactDOM.render(
    <DiffViewComponent diffModel={diffModel} />,
    hostElement,
  );
  activeDiffView = {
    component,
    element: hostElement,
  };
  activateDiffPath(diffEntityOptions);

  const destroySubscription = hostElement.onDidDestroy(() => {
    ReactDOM.unmountComponentAtNode(hostElement);
    diffModel.deactivate();
    destroySubscription.dispose();
    invariant(subscriptions);
    subscriptions.remove(destroySubscription);
    activeDiffView = null;
  });

  invariant(subscriptions);
  subscriptions.add(
    new Disposable(() => { hostElement.destroy(); }),
    destroySubscription,
  );

  const {track} = require('../../nuclide-analytics');
  track('diff-view-open');

  return hostElement;
}

function getDiffViewModel(): DiffViewModelType {
  if (diffViewModel == null) {
    const DiffViewModel = require('./DiffViewModel');
    diffViewModel = new DiffViewModel();
    diffViewModel.setUiProviders(uiProviders);
    invariant(subscriptions);
    subscriptions.add(diffViewModel);
  }
  return diffViewModel;
}

function activateDiffPath(diffEntityOptions: DiffEntityOptions): void {
  if (diffViewModel == null) {
    return;
  }
  if (!diffEntityOptions.file && !diffEntityOptions.directory && cwdApi != null) {
    const directory = cwdApi.getCwd();
    if (directory != null) {
      diffEntityOptions.directory = directory.getPath();
    }
  }
  diffViewModel.diffEntity(diffEntityOptions);
}

function projectsContainPath(checkPath: string): boolean {
  return atom.project.getDirectories().some(directory => {
    const directoryPath = directory.getPath();
    if (!checkPath.startsWith(directoryPath)) {
      return false;
    }
    // If the remote directory hasn't yet loaded.
    if (nuclideUri.isRemote(checkPath) && directory instanceof Directory) {
      return false;
    }
    return true;
  });
}

function diffActivePath(diffOptions?: Object): void {
  const editor = atom.workspace.getActiveTextEditor();
  if (editor == null) {
    atom.workspace.open(formatDiffViewUrl(diffOptions));
  } else {
    atom.workspace.open(formatDiffViewUrl({
      file: editor.getPath() || '',
      ...diffOptions,
    }));
  }
}

function isActiveEditorDiffable(): boolean {
  const editor = atom.workspace.getActiveTextEditor();
  if (editor == null) {
    return false;
  }
  return isPathDiffable(editor.getPath());
}

function shouldDisplayDiffTreeItem(contextMenu: FileTreeContextMenu): boolean {
  const node = contextMenu.getSingleSelectedNode();
  return node != null && isPathDiffable(node.uri);
}

function isPathDiffable(filePath: ?string): boolean {
  if (filePath == null || filePath.length === 0) {
    return false;
  }
  const repository = repositoryForPath(filePath);
  return repository != null && repository.getType() === 'hg';
}

// Listen for file tree context menu file item events to open the diff view.
function addFileTreeCommands(commandName: string, diffOptions?: Object): void {
  invariant(subscriptions);
  subscriptions.add(atom.commands.add(
    '.tree-view .entry.file.list-item',
    commandName,
    event => {
      const filePath = uiTreePath(event);
      atom.workspace.open(formatDiffViewUrl({
        file: filePath || '',
        ...diffOptions,
      }));
    }
  ));

  subscriptions.add(atom.commands.add(
    '.tree-view .entry.directory.list-nested-item > .list-item',
    commandName,
    event => {
      const directoryPath = uiTreePath(event);
      atom.workspace.open(formatDiffViewUrl({
        directory: directoryPath || '',
        ...diffOptions,
      }));
    }
  ));
}

function addActivePathCommands(commandName: string, diffOptions?: Object) {
  invariant(subscriptions);

  function onTargetCommand(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    diffActivePath(diffOptions);
  }

  subscriptions.add(atom.commands.add(
    'atom-workspace',
    commandName,
    onTargetCommand,
  ));
  // Listen for in-editor context menu item diff view open command.
  subscriptions.add(atom.commands.add(
    'atom-text-editor',
    commandName,
    onTargetCommand,
  ));
}

module.exports = {

  activate(state: ?SerializedDiffViewState): void {
    subscriptions = new CompositeDisposable();
    // Listen for menu item workspace diff view open command.
    addActivePathCommands('nuclide-diff-view:open');
    addActivePathCommands('nuclide-diff-view:commit', {
      viewMode: DiffMode.COMMIT_MODE,
      commitMode: CommitMode.COMMIT,
    });
    addActivePathCommands('nuclide-diff-view:amend', {
      viewMode: DiffMode.COMMIT_MODE,
      commitMode: CommitMode.AMEND,
    });
    addActivePathCommands('nuclide-diff-view:publish', {
      viewMode: DiffMode.PUBLISH_MODE,
    });

    // Context Menu Items.
    subscriptions.add(atom.contextMenu.add({
      'atom-text-editor': [
        {type: 'separator'},
        {
          label: 'Source Control',
          submenu: [
            {
              label: 'Open in Diff View',
              command: 'nuclide-diff-view:open',
            },
            {
              label: 'Commit',
              command: 'nuclide-diff-view:commit',
            },
            {
              label: 'Amend',
              command: 'nuclide-diff-view:amend',
            },
            {
              label: 'Publish to Phabricator',
              command: 'nuclide-diff-view:publish',
            },
          ],
          shouldDisplay() {
            return isActiveEditorDiffable();
          },
        },
        {type: 'separator'},
      ],
    }));

    // Listen for switching to editor mode for the active file.
    subscriptions.add(atom.commands.add(
      'nuclide-diff-view',
      'nuclide-diff-view:switch-to-editor',
      () => {
        const diffModel = getDiffViewModel();
        const {filePath} = diffModel.getActiveFileState();
        if (filePath != null && filePath.length) {
          atom.workspace.open(filePath);
        }
      }
    ));

    addFileTreeCommands('nuclide-diff-view:open-context');
    addFileTreeCommands('nuclide-diff-view:commit-context', {
      viewMode: DiffMode.COMMIT_MODE,
      commitMode: CommitMode.COMMIT,
    });
    addFileTreeCommands('nuclide-diff-view:amend-context', {
      viewMode: DiffMode.COMMIT_MODE,
      commitMode: CommitMode.AMEND,
    });
    addFileTreeCommands('nuclide-diff-view:publish-context', {
      viewMode: DiffMode.PUBLISH_MODE,
    });

    // The Diff View will open its main UI in a tab, like Atom's preferences and welcome pages.
    subscriptions.add(atom.workspace.addOpener(uri => {
      if (uri.startsWith(NUCLIDE_DIFF_VIEW_URI)) {
        if (!require('semver').gte(atom.getVersion(), '1.6.1')) {
          throw new Error(
            'Outdated Atom version<br/>\n' +
            '**Nuclide\'s Diff View require Atom 1.6.1 or later**',
          );
        }
        const {query: diffEntityOptions} = url.parse(uri, true);
        return createView((diffEntityOptions: any));
      }
    }));

    if (state == null || !state.visible) {
      return;
    }

    const {activeFilePath, viewMode, commitMode} = state;
    // Wait for all source control providers to register.
    subscriptions.add(nuclideFeatures.onDidActivateInitialFeatures(() => {
      function restoreActiveDiffView() {
        atom.workspace.open(formatDiffViewUrl({
          file: activeFilePath,
          viewMode,
          commitMode,
        }));
      }

      // If it's a local directory, it must be loaded with packages activation.
      if (!activeFilePath || projectsContainPath(activeFilePath)) {
        restoreActiveDiffView();
        return;
      }
      // If it's a remote directory, it should come on a path change event.
      // The change handler is delayed to break the race with the `DiffViewModel` subscription.
      const changePathsSubscription = atom.project.onDidChangePaths(() => setTimeout(() => {
        // try/catch here because in case of any error, Atom stops dispatching events to the
        // rest of the listeners, which can stop the remote editing from being functional.
        try {
          if (projectsContainPath(activeFilePath)) {
            restoreActiveDiffView();
            changePathsSubscription.dispose();
            invariant(subscriptions);
            subscriptions.remove(changePathsSubscription);
          }
        } catch (e) {
          getLogger().error('DiffView restore error', e);
        }
      }, 10));
      invariant(subscriptions);
      subscriptions.add(changePathsSubscription);
    }));
  },

  consumeToolBar(getToolBar: GetToolBar): IDisposable {
    const toolBar = getToolBar('nuclide-diff-view');
    const button = toolBar.addButton({
      icon: 'git-branch',
      callback: 'nuclide-diff-view:open',
      tooltip: 'Open Diff View',
      priority: 300,
    }).element;
    button.classList.add('diff-view-count');

    const diffModel = getDiffViewModel();
    let lastCount = null;
    const updateToolbarCount = () => {
      const count = diffModel.getState().dirtyFileChanges.size;
      if (count !== lastCount) {
        button.classList.toggle('positive-count', count > 0);
        button.classList.toggle('max-count', count > 99);
        button.dataset.count = count === 0 ? '' : (count > 99 ? '99+' : String(count));
        lastCount = count;
      }
    };
    updateToolbarCount();

    const toolBarSubscriptions = new CompositeDisposable(
      diffModel.onDidUpdateState(() => { updateToolbarCount(); }),
      new Disposable(() => { toolBar.removeItems(); })
    );
    invariant(subscriptions);
    subscriptions.add(toolBarSubscriptions);
    return toolBarSubscriptions;
  },

  getHomeFragments(): HomeFragments {
    return {
      feature: {
        title: 'Diff View',
        icon: 'git-branch',
        description: (
          <span>
            Launches an editable side-by-side compare view across mercurial dirty and commits
            changes, allowing committing and pushing changes to phabricator.
          </span>
        ),
        command: 'nuclide-diff-view:open',
      },
      priority: 3,
    };
  },

  serialize(): SerializedDiffViewState {
    if (!activeDiffView || !diffViewModel) {
      return {
        visible: false,
      };
    }
    const {filePath} = diffViewModel.getActiveFileState();
    const {viewMode, commitMode} = diffViewModel.getState();
    return {
      visible: true,
      activeFilePath: filePath,
      viewMode,
      commitMode,
    };
  },

  deactivate(): void {
    uiProviders.splice(0);
    if (subscriptions != null) {
      subscriptions.dispose();
      subscriptions = null;
    }
    if (diffViewModel != null) {
      diffViewModel.dispose();
      diffViewModel = null;
    }
    activeDiffView = null;
  },

  /**
   * The diff-view package can consume providers that return React components to
   * be rendered inline.
   * A uiProvider must have a method composeUiElements with the following spec:
   * @param filePath The path of the file the diff view is opened for
   * @return An array of InlineComments (defined above) to be rendered into the
   *         diff view
   */
  consumeUIProvider(provider: UIProvider) {
    uiProviders.push(provider);
    if (diffViewModel != null) {
      diffViewModel.setUiProviders(uiProviders);
    }
    return;
  },

  consumeCwdApi(api: CwdApi): void {
    cwdApi = api;
  },

  addItemsToFileTreeContextMenu(contextMenu: FileTreeContextMenu): IDisposable {
    invariant(subscriptions);
    const menuItemDescriptions = new CompositeDisposable();
    menuItemDescriptions.add(contextMenu.addItemToSourceControlMenu(
      {
        label: 'Open in Diff View',
        command: 'nuclide-diff-view:open-context',
        shouldDisplay() {
          return shouldDisplayDiffTreeItem(contextMenu);
        },
      },
      DIFF_VIEW_FILE_TREE_CONTEXT_MENU_PRIORITY,
    ));
    menuItemDescriptions.add(contextMenu.addItemToSourceControlMenu(
      {
        label: 'Commit',
        command: 'nuclide-diff-view:commit-context',
        shouldDisplay() {
          return shouldDisplayDiffTreeItem(contextMenu);
        },
      },
      COMMIT_FILE_TREE_CONTEXT_MENU_PRIORITY,
    ));
    menuItemDescriptions.add(contextMenu.addItemToSourceControlMenu(
      {
        label: 'Amend',
        command: 'nuclide-diff-view:amend-context',
        shouldDisplay() {
          return shouldDisplayDiffTreeItem(contextMenu);
        },
      },
      AMEND_FILE_TREE_CONTEXT_MENU_PRIORITY,
    ));
    menuItemDescriptions.add(contextMenu.addItemToSourceControlMenu(
      {
        label: 'Publish to Phabricator',
        command: 'nuclide-diff-view:publish-context',
        shouldDisplay() {
          return shouldDisplayDiffTreeItem(contextMenu);
        },
      },
      PUBLISH_FILE_TREE_CONTEXT_MENU_PRIORITY,
    ));

    subscriptions.add(menuItemDescriptions);

    // We don't need to dispose of the menuItemDescriptions when the provider is disabled -
    // it needs to be handled by the provider itself. We only should remove it from the list
    // of the disposables we maintain.
    return new Disposable(() => {
      if (subscriptions != null) {
        subscriptions.remove(menuItemDescriptions);
      }
    });
  },

  get __testDiffView() {
    return activeDiffView;
  },
};
