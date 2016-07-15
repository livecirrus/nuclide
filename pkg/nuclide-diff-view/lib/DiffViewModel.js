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
  HgRepositoryClient,
} from '../../nuclide-hg-repository-client';
import type {
  FileChangeState,
  RevisionsState,
  FileChangeStatusValue,
  CommitModeType,
  CommitModeStateType,
  PublishModeType,
  PublishModeStateType,
  DiffModeType,
  DiffOptionType,
  UIProvider,
  UIElement,
} from './types';
import type {RevisionInfo} from '../../nuclide-hg-repository-base/lib/HgService';
import type {NuclideUri} from '../../nuclide-remote-uri';
import type {PhabricatorRevisionInfo} from '../../nuclide-arcanist-base/lib/utils';

type FileDiffState = {
  revisionInfo: RevisionInfo;
  committedContents: string;
  filesystemContents: string;
};

export type DiffEntityOptions = {
  file?: NuclideUri;
  directory?: NuclideUri;
  viewMode?: DiffModeType;
  commitMode?: CommitModeType;
};

import {getPhabricatorRevisionFromCommitMessage} from '../../nuclide-arcanist-base/lib/utils';
import arcanist from '../../nuclide-arcanist-client';
import {CompositeDisposable, Emitter} from 'atom';
import shell from 'shell';
import {
  DiffMode,
  DiffOption,
  CommitMode,
  CommitModeState,
  PublishMode,
  PublishModeState,
  FileChangeStatus,
  FileChangeStatusToPrefix,
} from './constants';
import invariant from 'assert';
import {repositoryForPath} from '../../nuclide-hg-git-bridge';
import {track, trackTiming} from '../../nuclide-analytics';
import {serializeAsyncCall} from '../../commons-node/promise';
import {mapUnion, mapFilter} from '../../commons-node/collection';
import {bufferUntil} from '../../commons-node/stream';
import remoteUri from '../../nuclide-remote-uri';
import RepositoryStack from './RepositoryStack';
import Rx from 'rxjs';
import {notifyInternalError} from './notifications';
import {bufferForUri, loadBufferForUri} from '../../commons-atom/text-editor';
import {getLogger} from '../../nuclide-logging';

const ACTIVE_FILE_UPDATE_EVENT = 'active-file-update';
const CHANGE_REVISIONS_EVENT = 'did-change-revisions';
const ACTIVE_BUFFER_CHANGE_MODIFIED_EVENT = 'active-buffer-change-modified';
const DID_UPDATE_STATE_EVENT = 'did-update-state';

function getRevisionUpdateMessage(phabricatorRevision: PhabricatorRevisionInfo): string {
  return `

# Updating ${phabricatorRevision.name}
#
# Enter a brief description of the changes included in this update.
# The first line is used as subject, next lines as comment.`;
}

const MAX_DIALOG_FILE_STATUS_COUNT = 20;

// Returns a string with all newline strings, '\\n', converted to literal newlines, '\n'.
function convertNewlines(message: string): string {
  return message.replace(/\\n/g, '\n');
}

function getInitialFileChangeState(): FileChangeState {
  return {
    fromRevisionTitle: 'No file selected',
    toRevisionTitle: 'No file selected',
    filePath: '',
    oldContents: '',
    newContents: '',
    compareRevisionInfo: null,
  };
}

function viewModeToDiffOption(viewMode: DiffModeType): DiffOptionType {
  switch (viewMode) {
    case DiffMode.COMMIT_MODE:
      return DiffOption.DIRTY;
    case DiffMode.PUBLISH_MODE:
      return DiffOption.LAST_COMMIT;
    case DiffMode.BROWSE_MODE:
      return DiffOption.COMPARE_COMMIT;
    default:
      throw new Error('Unrecognized view mode!');
  }
}

function getFileStatusListMessage(fileChanges: Map<NuclideUri, FileChangeStatusValue>): string {
  let message = '';
  if (fileChanges.size < MAX_DIALOG_FILE_STATUS_COUNT) {
    for (const [filePath, statusCode] of fileChanges) {
      message += '\n'
        + FileChangeStatusToPrefix[statusCode]
        + atom.project.relativize(filePath);
    }
  } else {
    message = `\n more than ${MAX_DIALOG_FILE_STATUS_COUNT} files (check using \`hg status\`)`;
  }
  return message;
}

function hgRepositoryForPath(filePath: NuclideUri): HgRepositoryClient {
  // Calling atom.project.repositoryForDirectory gets the real path of the directory,
  // which is another round-trip and calls the repository providers to get an existing repository.
  // Instead, the first match of the filtering here is the only possible match.
  const repository = repositoryForPath(filePath);
  if (repository == null || repository.getType() !== 'hg') {
    const type = repository ? repository.getType() : 'no repository';
    throw new Error(
      'Diff view only supports `Mercurial` repositories, ' +
      `but found \`${type}\` at path: \`${filePath}\``
    );
  }
  return (repository: any);
}

function notifyRevisionStatus(
  phabRevision: ?PhabricatorRevisionInfo,
  statusMessage: string,
): void {
  let message = `Revision ${statusMessage}`;
  if (phabRevision == null) {
    atom.notifications.addSuccess(message, {nativeFriendly: true});
    return;
  }
  const {name, url} = phabRevision;
  message = `Revision '${name}' ${statusMessage}`;
  atom.notifications.addSuccess(message, {
    dismissable: true,
    buttons: [{
      className: 'icon icon-globe',
      onDidClick() { shell.openExternal(url); },
      text: 'Open in Phabricator',
    }],
    nativeFriendly: true,
  });
}

type State = {
  viewMode: DiffModeType;
  commitMessage: ?string;
  commitMode: CommitModeType;
  commitModeState: CommitModeStateType;
  publishMessage: ?string;
  publishMode: PublishModeType;
  publishModeState: PublishModeStateType;
  headRevision: ?RevisionInfo;
  dirtyFileChanges: Map<NuclideUri, FileChangeStatusValue>;
  selectedFileChanges: Map<NuclideUri, FileChangeStatusValue>;
  showNonHgRepos: boolean;
};

class DiffViewModel {

  _emitter: Emitter;
  _subscriptions: CompositeDisposable;
  _activeSubscriptions: CompositeDisposable;
  _activeFileState: FileChangeState;
  _activeRepositoryStack: ?RepositoryStack;
  _newEditor: ?TextEditor;
  _uiProviders: Array<UIProvider>;
  _repositoryStacks: Map<HgRepositoryClient, RepositoryStack>;
  _repositorySubscriptions: Map<HgRepositoryClient, CompositeDisposable>;
  _isActive: boolean;
  _state: State;
  _publishUpdates: Rx.Subject<any>;
  _serializedUpdateActiveFileDiff: () => Promise<void>;

  constructor() {
    this._emitter = new Emitter();
    this._subscriptions = new CompositeDisposable();
    this._activeSubscriptions = new CompositeDisposable();
    this._uiProviders = [];
    this._repositoryStacks = new Map();
    this._repositorySubscriptions = new Map();
    this._isActive = false;
    this._publishUpdates = new Rx.Subject();
    this._state = {
      viewMode: DiffMode.BROWSE_MODE,
      commitMessage: null,
      commitMode: CommitMode.COMMIT,
      commitModeState: CommitModeState.READY,
      publishMessage: null,
      publishMode: PublishMode.CREATE,
      publishModeState: PublishModeState.READY,
      headRevision: null,
      dirtyFileChanges: new Map(),
      selectedFileChanges: new Map(),
      showNonHgRepos: true,
    };
    this._serializedUpdateActiveFileDiff = serializeAsyncCall(
      () => this._updateActiveFileDiff(),
    );
    this._setActiveFileState(getInitialFileChangeState());
    this._updateRepositories();
    this._subscriptions.add(atom.project.onDidChangePaths(this._updateRepositories.bind(this)));
  }

  _updateRepositories(): void {
    const repositories = new Set(
      atom.project.getRepositories().filter(
        repository => repository != null && repository.getType() === 'hg'
      )
    );
    // Dispose removed projects repositories, if any.
    for (const [repository, repositoryStack] of this._repositoryStacks) {
      if (repositories.has(repository)) {
        continue;
      }
      if (this._activeRepositoryStack === repositoryStack) {
        this._activeRepositoryStack = null;
      }
      repositoryStack.dispose();
      this._repositoryStacks.delete(repository);
      const subscriptions = this._repositorySubscriptions.get(repository);
      invariant(subscriptions);
      subscriptions.dispose();
      this._repositorySubscriptions.delete(repository);
    }

    // Add the new project repositories, if any.
    for (const repository of repositories) {
      if (this._repositoryStacks.has(repository)) {
        continue;
      }
      const hgRepository = ((repository: any): HgRepositoryClient);
      this._createRepositoryStack(hgRepository);
    }

    // Update active repository stack, if needed.
    // This will make sure we have a repository stack active whenever we have
    // a mercurial repository added to the project.
    if (this._activeRepositoryStack == null && this._repositoryStacks.size > 0) {
      this._setActiveRepositoryStack(
        Array.from(this._repositoryStacks.values())[0],
      );
    }
    this._updateDirtyChangedStatus();
    this._updateSelectedFileChanges();
    // Clear the active diff state if it was from a repo that's now removed.
    const {filePath} = this._activeFileState;
    if (filePath && !repositories.has((repositoryForPath(filePath): any))) {
      getLogger().info(
        'Diff View\'s active buffer was belonging to a removed project.\n' +
        'Clearing the UI state.'
      );
      this._activeSubscriptions.dispose();
      this._setActiveFileState(getInitialFileChangeState());
    }
  }

  _createRepositoryStack(repository: HgRepositoryClient): RepositoryStack {
    const repositoryStack = new RepositoryStack(
      repository,
      viewModeToDiffOption(this._state.viewMode),
    );
    const subscriptions = new CompositeDisposable();
    subscriptions.add(
      repositoryStack.onDidUpdateDirtyFileChanges(
        this._updateDirtyChangedStatus.bind(this)
      ),
      repositoryStack.onDidUpdateSelectedFileChanges(
        this._updateSelectedFileChanges.bind(this)
      ),
      repositoryStack.onDidChangeRevisions(revisionsState => {
        this._updateChangedRevisions(repositoryStack, revisionsState, true)
          .catch(notifyInternalError);
      }),
    );
    this._repositoryStacks.set(repository, repositoryStack);
    this._repositorySubscriptions.set(repository, subscriptions);
    if (this._isActive) {
      repositoryStack.activate();
    }
    return repositoryStack;
  }

  _updateDirtyChangedStatus(): void {
    const dirtyFileChanges = mapUnion(
      ...Array.from(this._repositoryStacks.values())
      .map(repositoryStack => repositoryStack.getDirtyFileChanges())
    );
    this._updateViewChangedFilesStatus(dirtyFileChanges);
  }

  getActiveStackDirtyFileChanges(): Map<NuclideUri, FileChangeStatusValue> {
    if (this._activeRepositoryStack == null) {
      return new Map();
    } else {
      return this._activeRepositoryStack.getDirtyFileChanges();
    }
  }

  _updateSelectedFileChanges(): void {
    const selectedFileChanges = mapUnion(
      ...Array.from(this._repositoryStacks.values())
      .map(repositoryStack => repositoryStack.getSelectedFileChanges())
    );
    this._updateViewChangedFilesStatus(
      null,
      selectedFileChanges,
    );
  }

  _updateViewChangedFilesStatus(
    dirtyFileChanges?: ?Map<NuclideUri, FileChangeStatusValue>,
    selectedFileChanges?: ?Map<NuclideUri, FileChangeStatusValue>,
  ): void {
    if (dirtyFileChanges == null) {
      dirtyFileChanges = this._state.dirtyFileChanges;
    }
    if (selectedFileChanges == null) {
      selectedFileChanges = this._state.selectedFileChanges;
    }
    let filteredFileChanges;
    let showNonHgRepos;
    let activeRepositorySelector = () => true;
    if (this._activeRepositoryStack != null) {
      const projectDirectory = this._activeRepositoryStack.getRepository().getProjectDirectory();
      activeRepositorySelector = (filePath: NuclideUri) =>
        remoteUri.contains(projectDirectory, filePath);
    }
    switch (this._state.viewMode) {
      case DiffMode.COMMIT_MODE:
      case DiffMode.PUBLISH_MODE:
        // Commit mode only shows the changes of the active repository.
        filteredFileChanges = mapFilter(selectedFileChanges, activeRepositorySelector);
        // Publish mode only shows the changes of the active repository.
        filteredFileChanges = mapFilter(selectedFileChanges, activeRepositorySelector);
        showNonHgRepos = false;
        break;
      case DiffMode.BROWSE_MODE:
        // Broswe mode shows all changes from all repositories.
        filteredFileChanges = selectedFileChanges;
        showNonHgRepos = true;
        break;
      default:
        throw new Error('Unrecognized view mode!');
    }
    this._setState({
      ...this._state,
      dirtyFileChanges,
      selectedFileChanges: filteredFileChanges,
      showNonHgRepos,
    });
  }

  async _updateChangedRevisions(
    repositoryStack: RepositoryStack,
    revisionsState: RevisionsState,
    reloadFileDiffState: boolean,
  ): Promise<void> {
    if (repositoryStack !== this._activeRepositoryStack) {
      return;
    }
    track('diff-view-update-timeline-revisions', {
      revisionsCount: `${revisionsState.revisions.length}`,
    });
    this._onUpdateRevisionsState(revisionsState);

    // Update the active file, if changed.
    const {filePath} = this._activeFileState;
    if (!filePath || !reloadFileDiffState) {
      return;
    }
    this._serializedUpdateActiveFileDiff();
  }

  async _updateActiveFileDiff(): Promise<void> {
    const {filePath} = this._activeFileState;
    if (!filePath) {
      return;
    }
    // Capture the view state before the update starts.
    const {viewMode, commitMode} = this._state;
    const {
      committedContents,
      filesystemContents,
      revisionInfo,
    } = await this._fetchFileDiff(filePath);
    if (
      this._activeFileState.filePath !== filePath ||
      this._state.viewMode !== viewMode ||
      this._state.commitMode !== commitMode
    ) {
      // The state have changed since the update started, and there must be another
      // scheduled update. Hence, we return early to allow it to go through.
      return;
    }
    await this._updateDiffStateIfChanged(
      filePath,
      committedContents,
      filesystemContents,
      revisionInfo,
    );
  }

  _onUpdateRevisionsState(revisionsState: RevisionsState): void {
    this._emitter.emit(CHANGE_REVISIONS_EVENT, revisionsState);
    this._loadModeState(true);
  }

  setPublishMessage(publishMessage: ?string): void {
    this._setState({
      ...this._state,
      publishMessage,
    });
  }

  setCommitMessage(commitMessage: string): void {
    this._setState({
      ...this._state,
      commitMessage,
    });
  }

  setViewMode(viewMode: DiffModeType, loadModeState?: boolean = true): void {
    if (viewMode === this._state.viewMode) {
      return;
    }
    track('diff-view-switch-mode', {
      viewMode,
    });
    this._setState({
      ...this._state,
      viewMode,
    });
    if (this._activeRepositoryStack != null) {
      this._activeRepositoryStack.setDiffOption(viewModeToDiffOption(this._state.viewMode));
    }
    this._updateViewChangedFilesStatus();
    if (loadModeState) {
      this._loadModeState(false);
    }
    this._serializedUpdateActiveFileDiff();
  }

  _loadModeState(resetState: boolean): void {
    if (resetState) {
      this._setState({
        ...this._state,
        commitMessage: null,
        publishMessage: null,
      });
    }
    switch (this._state.viewMode) {
      case DiffMode.COMMIT_MODE:
        this._loadCommitModeState();
        break;
      case DiffMode.PUBLISH_MODE:
        this._loadPublishModeState().catch(notifyInternalError);
        break;
    }
  }

  _findFilePathToDiffInDirectory(directoryPath: NuclideUri): ?string {
    const repositoryStack = this._getRepositoryStackForPath(directoryPath);
    const hgRepository = repositoryStack.getRepository();
    const projectDirectory = hgRepository.getProjectDirectory();

    function getMatchingFileChange(
      filePaths: Array<NuclideUri>,
      parentPath: NuclideUri,
    ): ?NuclideUri {
      return filePaths.filter(filePath => remoteUri.contains(parentPath, filePath))[0];
    }
    const dirtyFilePaths = Array.from(repositoryStack.getDirtyFileChanges().keys());
    // Try to match dirty file changes in the selected directory,
    // Then lookup for changes in the project directory.
    const matchedFilePaths = [
      getMatchingFileChange(dirtyFilePaths, directoryPath),
      getMatchingFileChange(dirtyFilePaths, projectDirectory),
    ];
    return matchedFilePaths[0] || matchedFilePaths[1];
  }

  diffEntity(entityOption: DiffEntityOptions): void {
    let diffPath = null;
    if (entityOption.file != null) {
      diffPath = entityOption.file;
    } else if (entityOption.directory != null) {
      diffPath = this._findFilePathToDiffInDirectory(entityOption.directory);
    }

    if (diffPath == null) {
      const repository = repositoryForPath(entityOption.file || entityOption.directory || '');
      if (
        repository != null &&
        repository.getType() === 'hg' &&
        this._repositoryStacks.has((repository: any))
      ) {
        const repositoryStack = this._repositoryStacks.get((repository: any));
        invariant(repositoryStack);
        this._setActiveRepositoryStack(repositoryStack);
      } else if (this._activeRepositoryStack == null) {
        // This can only happen none of the project folders are Mercurial repositories.
        // However, this is caught earlier with a better error message.
        throw new Error(
          'No active repository stack and non-diffable entity:' +
          JSON.stringify(entityOption)
        );
      } else {
        getLogger().error('Non diffable entity:', entityOption);
      }
    }
    const {viewMode, commitMode} = entityOption;
    if (viewMode !== this._state.viewMode || commitMode !== this._state.commitMode) {
      if (viewMode === DiffMode.COMMIT_MODE) {
        invariant(commitMode, 'DIFF: Commit Mode not set!');
        this.setViewMode(DiffMode.COMMIT_MODE, false);
        this.setCommitMode(commitMode, false);
        this._loadModeState(true);
      } else if (viewMode) {
        this.setViewMode(viewMode);
      }
    }
    if (diffPath != null) {
      // Diff the file after setting the view mode to compare against the right thing.
      this._diffFilePath(diffPath);
    }
  }

  _diffFilePath(filePath: NuclideUri): void {
    if (filePath === this._activeFileState.filePath) {
      return;
    }
    this._setActiveFileState({
      ...getInitialFileChangeState(),
      filePath,
    });
    this._activeSubscriptions.dispose();
    this._activeSubscriptions = new CompositeDisposable();
    // TODO(most): Show progress indicator: t8991676
    const buffer = bufferForUri(filePath);
    this._activeSubscriptions.add(buffer.onDidReload(
      () => this._onActiveBufferReload(filePath, buffer).catch(notifyInternalError),
    ));
    this._activeSubscriptions.add(buffer.onDidDestroy(() => {
      getLogger().info(
        'Diff View\'s active buffer has been destroyed.\n' +
        'The underlying file could have been removed.'
      );
      this._activeSubscriptions.dispose();
      this._setActiveFileState(getInitialFileChangeState());
    }));
    this._activeSubscriptions.add(buffer.onDidChangeModified(
      this.emitActiveBufferChangeModified.bind(this),
    ));
    // Modified events could be late that it doesn't capture the latest edits / state changes.
    // Hence, it's safe to re-emit changes when stable from changes.
    this._activeSubscriptions.add(buffer.onDidStopChanging(
      this.emitActiveBufferChangeModified.bind(this),
    ));
    track('diff-view-open-file', {filePath});
    this._updateActiveDiffState(filePath).catch(notifyInternalError);
  }

  async _onActiveBufferReload(filePath: NuclideUri, buffer: atom$TextBuffer): Promise<void> {
    const {
      oldContents: committedContents,
      compareRevisionInfo: revisionInfo,
    } = this._activeFileState;
    if (revisionInfo == null) {
      // The file could be just loaded.
      return;
    }
    await this._updateDiffStateIfChanged(
      filePath,
      committedContents,
      buffer.getText(),
      revisionInfo,
    );
  }

  emitActiveBufferChangeModified(): void {
    this._emitter.emit(ACTIVE_BUFFER_CHANGE_MODIFIED_EVENT);
  }

  onDidActiveBufferChangeModified(
    callback: () => mixed,
  ): IDisposable {
    return this._emitter.on(ACTIVE_BUFFER_CHANGE_MODIFIED_EVENT, callback);
  }

  isActiveBufferModified(): boolean {
    const {filePath} = this._activeFileState;
    const buffer = bufferForUri(filePath);
    return buffer.isModified();
  }

  async _updateDiffStateIfChanged(
    filePath: NuclideUri,
    committedContents: string,
    filesystemContents: string,
    revisionInfo: RevisionInfo,
  ): Promise<void> {
    if (this._activeFileState.filePath !== filePath) {
      return;
    }
    const updatedDiffState = {
      committedContents,
      filesystemContents,
      revisionInfo,
    };
    return this._updateDiffState(
      filePath,
      updatedDiffState,
    );
  }

  setNewContents(newContents: string): void {
    this._setActiveFileState({...this._activeFileState, newContents});
  }

  setRevision(revision: RevisionInfo): void {
    track('diff-view-set-revision');
    const repositoryStack = this._activeRepositoryStack;
    invariant(repositoryStack, 'There must be an active repository stack!');
    this._activeFileState = {...this._activeFileState, compareRevisionInfo: revision};
    repositoryStack.setRevision(revision).catch(notifyInternalError);
  }

  getActiveFileState(): FileChangeState {
    return this._activeFileState;
  }

  getPublishUpdates(): Rx.Subject<any> {
    return this._publishUpdates;
  }

  async _updateActiveDiffState(filePath: NuclideUri): Promise<void> {
    if (!filePath) {
      return;
    }
    const fileDiffState = await this._fetchFileDiff(filePath);
    await this._updateDiffState(
      filePath,
      fileDiffState,
    );
  }

  async _updateDiffState(
    filePath: NuclideUri,
    fileDiffState: FileDiffState,
  ): Promise<void> {
    const {
      committedContents: oldContents,
      filesystemContents: newContents,
      revisionInfo,
    } = fileDiffState;
    const {hash, bookmarks} = revisionInfo;
    const newFileState = {
      filePath,
      oldContents,
      newContents,
      compareRevisionInfo: revisionInfo,
      fromRevisionTitle: `${hash}` + (bookmarks.length === 0 ? '' : ` - (${bookmarks.join(', ')})`),
      toRevisionTitle: 'Filesystem / Editor',
    };
    this._setActiveFileState(newFileState);
    // TODO(most): Fix: this assumes that the editor contents aren't changed while
    // fetching the comments, that's okay now because we don't fetch them.
    await this._updateInlineComponents();
  }

  _setActiveFileState(state: FileChangeState): void {
    this._activeFileState = state;
    this._emitter.emit(ACTIVE_FILE_UPDATE_EVENT, this._activeFileState);
  }

  @trackTiming('diff-view.hg-state-update')
  async _fetchFileDiff(filePath: NuclideUri): Promise<FileDiffState> {
    const repositoryStack = this._getRepositoryStackForPath(filePath);
    const [hgDiff] = await Promise.all([
      repositoryStack.fetchHgDiff(filePath),
      this._setActiveRepositoryStack(repositoryStack),
    ]);
    // Intentionally fetch the filesystem contents after getting the committed contents
    // to make sure we have the latest filesystem version.
    const buffer = await loadBufferForUri(filePath);
    return {
      ...hgDiff,
      filesystemContents: buffer.getText(),
    };
  }

  _getRepositoryStackForPath(filePath: NuclideUri): RepositoryStack {
    const hgRepository = hgRepositoryForPath(filePath);
    const repositoryStack = this._repositoryStacks.get(hgRepository);
    invariant(repositoryStack, 'There must be an repository stack for a given repository!');
    return repositoryStack;
  }

  async _setActiveRepositoryStack(repositoryStack: RepositoryStack): Promise<void> {
    if (this._activeRepositoryStack === repositoryStack) {
      return;
    }
    this._activeRepositoryStack = repositoryStack;
    repositoryStack.setDiffOption(viewModeToDiffOption(this._state.viewMode));
    if (!this._isActive) {
      return;
    }
    const revisionsState = await repositoryStack.getCachedRevisionsStatePromise();
    this._updateChangedRevisions(repositoryStack, revisionsState, false);
  }


  @trackTiming('diff-view.save-file')
  saveActiveFile(): Promise<void> {
    const {filePath} = this._activeFileState;
    track('diff-view-save-file', {filePath});
    return this._saveFile(filePath).catch(notifyInternalError);
  }

  @trackTiming('diff-view.publish-diff')
  async publishDiff(publishMessage: string): Promise<void> {
    this._setState({
      ...this._state,
      publishMessage,
      publishModeState: PublishModeState.AWAITING_PUBLISH,
    });
    const {publishMode} = this._state;
    track('diff-view-publish', {
      publishMode,
    });
    const commitMessage = publishMode === PublishMode.CREATE ? publishMessage : null;
    let cleanResult;
    try {
      cleanResult = await this._promptToCleanDirtyChanges(commitMessage);
    } catch (error) {
      atom.notifications.addError('Error clearning dirty changes', {
        detail: error.message,
        dismissable: true,
        nativeFriendly: true,
      });
    }
    if (cleanResult == null) {
      this._setState({
        ...this._state,
        publishModeState: PublishModeState.READY,
      });
      return;
    }
    const {amended, allowUntracked} = cleanResult;
    try {
      switch (publishMode) {
        case PublishMode.CREATE:
          // Create uses `verbatim` and `n` answer buffer
          // and that implies that untracked files will be ignored.
          const createdPhabricatorRevision = await this._createPhabricatorRevision(
            publishMessage,
            amended,
          );
          notifyRevisionStatus(createdPhabricatorRevision, 'created');
          break;
        case PublishMode.UPDATE:
          const updatedPhabricatorRevision = await this._updatePhabricatorRevision(
            publishMessage,
            allowUntracked,
          );
          notifyRevisionStatus(updatedPhabricatorRevision, 'updated');
          break;
        default:
          throw new Error(`Unknown publish mode '${publishMode}'`);
      }
      // Populate Publish UI with the most recent data after a successful push.
      this._setState({
        ...this._state,
        publishModeState: PublishModeState.READY,
      });
      this.setViewMode(DiffMode.BROWSE_MODE);
    } catch (error) {
      atom.notifications.addError('Couldn\'t Publish to Phabricator', {
        detail: error.message,
        nativeFriendly: true,
      });
      this._setState({
        ...this._state,
        publishModeState: PublishModeState.PUBLISH_ERROR,
      });
    }
  }

  async _promptToCleanDirtyChanges(
    commitMessage: ?string,
  ): Promise<?{allowUntracked: boolean; amended: boolean;}> {
    const activeStack = this._activeRepositoryStack;
    invariant(activeStack != null, 'No active repository stack when cleaning dirty changes');

    const hgRepo = activeStack.getRepository();
    const checkingStatusNotification = atom.notifications.addInfo(
      'Running `hg status` to check dirty changes to Add/Amend/Revert',
      {dismissable: true},
    );
    await hgRepo.getStatuses([hgRepo.getProjectDirectory()]);
    checkingStatusNotification.dismiss();

    const dirtyFileChanges = activeStack.getDirtyFileChanges();

    let shouldAmend = false;
    let amended = false;
    let allowUntracked = false;
    if (dirtyFileChanges.size === 0) {
      return {
        amended,
        allowUntracked,
      };
    }
    const untrackedChanges: Map<NuclideUri, FileChangeStatusValue> = new Map(
      Array.from(dirtyFileChanges.entries())
        .filter(fileChange => fileChange[1] === FileChangeStatus.UNTRACKED)
    );
    if (untrackedChanges.size > 0) {
      const untrackedChoice = atom.confirm({
        message: 'You have untracked files in your working copy:',
        detailedMessage: getFileStatusListMessage(untrackedChanges),
        buttons: ['Cancel', 'Add', 'Allow Untracked'],
      });
      getLogger().info('Untracked changes choice:', untrackedChoice);
      if (untrackedChoice === 0) /*Cancel*/ {
        return null;
      } else if (untrackedChoice === 1) /*Add*/ {
        await activeStack.addAll(Array.from(untrackedChanges.keys()));
        shouldAmend = true;
      } else if (untrackedChoice === 2) /*Allow Untracked*/ {
        allowUntracked = true;
      }
    }
    const revertableChanges: Map<NuclideUri, FileChangeStatusValue> = new Map(
      Array.from(dirtyFileChanges.entries())
        .filter(fileChange => fileChange[1] !== FileChangeStatus.UNTRACKED)
    );
    if (revertableChanges.size > 0) {
      const cleanChoice = atom.confirm({
        message: 'You have uncommitted changes in your working copy:',
        detailedMessage: getFileStatusListMessage(revertableChanges),
        buttons: ['Cancel', 'Revert', 'Amend'],
      });
      getLogger().info('Dirty changes clean choice:', cleanChoice);
      if (cleanChoice === 0) /*Cancel*/ {
        return null;
      } else if (cleanChoice === 1) /*Revert*/ {
        const canRevertFilePaths: Array<NuclideUri> =
          Array.from(dirtyFileChanges.entries())
          .filter(fileChange => fileChange[1] !== FileChangeStatus.UNTRACKED)
          .map(fileChange => fileChange[0]);
        await activeStack.revert(canRevertFilePaths);
      } else if (cleanChoice === 2) /*Amend*/ {
        shouldAmend = true;
      }
    }
    if (shouldAmend) {
      await activeStack.amend(commitMessage);
      amended = true;
    }
    return {
      amended,
      allowUntracked,
    };
  }

  _getArcanistFilePath(): string {
    let {filePath} = this._activeFileState;
    if (filePath === '' && this._activeRepositoryStack != null) {
      filePath = this._activeRepositoryStack.getRepository().getProjectDirectory();
    }
    return filePath;
  }

  async _createPhabricatorRevision(
    publishMessage: string,
    amended: boolean,
  ): Promise<?PhabricatorRevisionInfo> {
    const filePath = this._getArcanistFilePath();
    const lastCommitMessage = await this._loadActiveRepositoryLatestCommitMessage();
    const activeRepositoryStack = this._activeRepositoryStack;
    invariant(activeRepositoryStack, 'No active repository stack');
    if (!amended && publishMessage !== lastCommitMessage) {
      getLogger().info('Amending commit with the updated message');
      await activeRepositoryStack.amend(publishMessage);
      atom.notifications.addSuccess('Commit amended with the updated message');
    }

    this._publishUpdates.next({level: 'log', text: 'Creating new revision...\n'});
    const stream = arcanist.createPhabricatorRevision(filePath);
    await this._processArcanistOutput(stream);
    const asyncHgRepo = activeRepositoryStack.getRepository().async;
    const headCommitMessagePromise = asyncHgRepo.getHeadCommitMessage();
    // Invalidate the current revisions state because the current commit info has changed.
    activeRepositoryStack.getRevisionsStatePromise();
    const commitMessage = await headCommitMessagePromise;
    if (commitMessage == null) {
      return null;
    }
    return getPhabricatorRevisionFromCommitMessage(commitMessage);
  }

  async _updatePhabricatorRevision(
    publishMessage: string,
    allowUntracked: boolean,
  ): Promise<PhabricatorRevisionInfo> {
    const filePath = this._getArcanistFilePath();
    const {phabricatorRevision} = await this._getActiveHeadRevisionDetails();
    invariant(phabricatorRevision != null, 'A phabricator revision must exist to update!');
    const updateTemplate = getRevisionUpdateMessage(phabricatorRevision).trim();
    const userUpdateMessage = publishMessage.replace(updateTemplate, '').trim();
    if (userUpdateMessage.length === 0) {
      throw new Error('Cannot update revision with empty message');
    }

    this._publishUpdates.next({
      level: 'log',
      text: `Updating revision \`${phabricatorRevision.name}\`...\n`,
    });
    const stream = arcanist.updatePhabricatorRevision(filePath, userUpdateMessage, allowUntracked);
    await this._processArcanistOutput(stream);
    return phabricatorRevision;
  }

  async _processArcanistOutput(stream: Rx.Observable<any>): Promise<void> {
    let fatalError = false;
    stream = stream
      // Split stream into single lines.
      .flatMap((message: {stderr?: string; stdout?: string}) => {
        const lines = [];
        for (const fd of ['stderr', 'stdout']) {
          let out = message[fd];
          if (out != null) {
            out = out.replace(/\n$/, '');
            for (const line of out.split('\n')) {
              lines.push({[fd]: line});
            }
          }
        }
        return lines;
      })
      // Unpack JSON
      .flatMap((message: {stderr?: string; stdout?: string}) => {
        const stdout = message.stdout;
        const messages = [];
        if (stdout != null) {
          let decodedJSON = null;
          try {
            decodedJSON = JSON.parse(stdout);
          } catch (err) {
            messages.push({type: 'phutil:out', message: stdout + '\n'});
            getLogger().error('Invalid JSON encountered: ' + stdout);
          }
          if (decodedJSON != null) {
            messages.push(decodedJSON);
          }
        }
        if (message.stderr != null) {
          messages.push({type: 'phutil:err', message: message.stderr + '\n'});
        }
        return messages;
      })
      // Process message type.
      .flatMap((decodedJSON: {type: string; message: string}) => {
        const messages = [];
        switch (decodedJSON.type) {
          case 'phutil:out':
          case 'phutil:out:raw':
            messages.push({level: 'log', text: decodedJSON.message});
            break;
          case 'phutil:err':
            messages.push({level: 'error', text: decodedJSON.message});
            break;
          case 'error':
            messages.push({level: 'error', text: decodedJSON.message});
            fatalError = true;
            break;
          default:
            getLogger().info(
              'Unhandled message type:',
              decodedJSON.type,
              'Message payload:',
              decodedJSON.message,
            );
            break;
        }
        return messages;
      })
      // Split messages on new line characters.
      .flatMap((message: {level: string; text: string}) => {
        const splitMessages = [];
        // Split on newlines without removing new line characters.  This will remove empty
        // strings but that's OK.
        for (const part of message.text.split(/^/m)) {
          splitMessages.push({level: message.level, text: part});
        }
        return splitMessages;
      });
    const levelStreams: Array<Rx.Observable<Array<{level: string; text: string}>>> = [];
    for (const level of ['log', 'error']) {
      const levelStream = stream
        .filter(
          (message: {level: string; text: string}) => message.level === level
        )
        .share();
      levelStreams.push(bufferUntil(levelStream, message => message.text.endsWith('\n')));
    }
    await Rx.Observable.merge(...levelStreams)
      .do(
        (messages: Array<{level: string; text: string}>) => {
          if (messages.length > 0) {
            this._publishUpdates.next({
              level: messages[0].level,
              text: messages.map(message => message.text).join(''),
            });
          }
        },
      )
      .toPromise().catch(error => {
        fatalError = true;
      });

    if (fatalError) {
      throw new Error(
        'Failed publish to Phabricator\n' +
        'You could have missed test plan or mistyped reviewers.\n' +
        'Please fix and try again.'
      );
    }
  }

  async _saveFile(filePath: NuclideUri): Promise<void> {
    const buffer = bufferForUri(filePath);
    if (buffer == null) {
      throw new Error(`Could not find file buffer to save: \`${filePath}\``);
    }
    try {
      await buffer.save();
    } catch (err) {
      throw new Error(`Could not save file buffer: \`${filePath}\` - ${err.toString()}`);
    }
  }

  onDidUpdateState(callback: () => mixed): IDisposable {
    return this._emitter.on(DID_UPDATE_STATE_EVENT, callback);
  }

  onRevisionsUpdate(callback: (state: ?RevisionsState) => void): IDisposable {
    return this._emitter.on(CHANGE_REVISIONS_EVENT, callback);
  }

  onActiveFileUpdates(callback: (state: FileChangeState) => void): IDisposable {
    return this._emitter.on(ACTIVE_FILE_UPDATE_EVENT, callback);
  }

  async _updateInlineComponents(): Promise<void> {
    const {filePath} = this._activeFileState;
    if (!filePath) {
      return;
    }
    const inlineComponents = await this._fetchInlineComponents(filePath);
    if (filePath !== this._activeFileState.filePath) {
      return;
    }
    this._setActiveFileState({...this._activeFileState, inlineComponents});
  }

  @trackTiming('diff-view.fetch-comments')
  async _fetchInlineComponents(filePath: NuclideUri): Promise<Array<UIElement>> {
    // TODO(most): Fix UI rendering and re-introduce: t8174332
    // provider.composeUiElements(filePath)
    const uiElementPromises = this._uiProviders.map(
      provider => Promise.resolve([]),
    );
    const uiComponentLists = await Promise.all(uiElementPromises);
    // Flatten uiComponentLists from list of lists of components to a list of components.
    const uiComponents = [].concat.apply([], uiComponentLists);
    return uiComponents;
  }

  setUiProviders(uiProviders: Array<UIProvider>): void {
    this._uiProviders = uiProviders;
    this._updateInlineComponents().catch(notifyInternalError);
  }

  async _loadCommitModeState(): Promise<void> {
    this._setState({
      ...this._state,
      commitModeState: CommitModeState.LOADING_COMMIT_MESSAGE,
    });

    let commitMessage = null;
    try {
      if (this._state.commitMessage != null) {
        commitMessage = this._state.commitMessage;
      } else if (this._state.commitMode === CommitMode.COMMIT) {
        commitMessage = await this._loadActiveRepositoryTemplateCommitMessage();
      } else {
        commitMessage = await this._loadActiveRepositoryLatestCommitMessage();
      }
    } catch (error) {
      notifyInternalError(error);
    } finally {
      this._setState({
        ...this._state,
        commitMessage,
        commitModeState: CommitModeState.READY,
      });
    }
  }

  async _loadPublishModeState(): Promise<void> {
    if (this._state.publishModeState === PublishModeState.AWAITING_PUBLISH) {
      // That must be an a update triggered by an `amend` operation,
      // done as part of diffing.
      return;
    }
    let publishMessage = this._state.publishMessage;
    this._setState({
      ...this._state,
      publishMode: PublishMode.CREATE,
      publishModeState: PublishModeState.LOADING_PUBLISH_MESSAGE,
      publishMessage: null,
      headRevision: null,
    });
    const {headRevision, phabricatorRevision} = await this._getActiveHeadRevisionDetails();
    if (publishMessage == null || publishMessage.length === 0) {
      publishMessage = phabricatorRevision != null
        ? getRevisionUpdateMessage(phabricatorRevision)
        : headRevision.description;
    }
    this._setState({
      ...this._state,
      publishMode: phabricatorRevision != null ? PublishMode.UPDATE : PublishMode.CREATE,
      publishModeState: PublishModeState.READY,
      publishMessage,
      headRevision,
    });
  }

  async _getActiveHeadRevisionDetails(): Promise<{
    headRevision: RevisionInfo;
    phabricatorRevision: ?PhabricatorRevisionInfo;
  }> {
    const revisionsState = await this.getActiveRevisionsState();
    if (revisionsState == null) {
      throw new Error('Cannot Load Publish View: No active file or repository');
    }
    const {revisions} = revisionsState;
    invariant(revisions.length > 0, 'Diff View Error: Zero Revisions');
    const headRevision = revisions[revisions.length - 1];
    const phabricatorRevision = getPhabricatorRevisionFromCommitMessage(
      headRevision.description,
    );
    return {
      headRevision,
      phabricatorRevision,
    };
  }

  async _loadActiveRepositoryLatestCommitMessage(): Promise<string> {
    if (this._activeRepositoryStack == null) {
      throw new Error('Diff View: No active file or repository open');
    }
    const revisionsState = await this.getActiveRevisionsState();
    invariant(revisionsState, 'Diff View Internal Error: revisionsState cannot be null');
    const {revisions} = revisionsState;
    invariant(revisions.length > 0, 'Diff View Error: Cannot amend non-existing commit');
    return revisions[revisions.length - 1].description;
  }

  async _loadActiveRepositoryTemplateCommitMessage(): Promise<?string> {
    if (this._activeRepositoryStack == null) {
      throw new Error('Diff View: No active file or repository open');
    }
    let commitMessage = await this._activeRepositoryStack.getTemplateCommitMessage();
    // Commit templates that include newline strings, '\\n' in JavaScript, need to convert their
    // strings to literal newlines, '\n' in JavaScript, to be rendered as line breaks.
    if (commitMessage != null) {
      commitMessage = convertNewlines(commitMessage);
    }
    return commitMessage;
  }

  async getActiveRevisionsState(): Promise<?RevisionsState> {
    if (this._activeRepositoryStack == null || !this._isActive) {
      return null;
    }
    return await this._activeRepositoryStack.getCachedRevisionsStatePromise();
  }

  _setState(newState: State) {
    this._state = newState;
    this._emitter.emit(DID_UPDATE_STATE_EVENT);
  }

  @trackTiming('diff-view.commit')
  async commit(message: string): Promise<void> {
    if (message === '') {
      atom.notifications.addError('Commit aborted', {detail: 'Commit message empty'});
      return;
    }

    this._setState({
      ...this._state,
      commitMessage: message,
      commitModeState: CommitModeState.AWAITING_COMMIT,
    });

    const {commitMode} = this._state;
    track('diff-view-commit', {
      commitMode,
    });

    const activeStack = this._activeRepositoryStack;
    try {
      invariant(activeStack, 'No active repository stack');
      switch (commitMode) {
        case CommitMode.COMMIT:
          await activeStack.commit(message);
          atom.notifications.addSuccess('Commit created', {nativeFriendly: true});
          break;
        case CommitMode.AMEND:
          await activeStack.amend(message);
          atom.notifications.addSuccess('Commit amended', {nativeFriendly: true});
          break;
      }

      // Force trigger an update to the revisions to update the UI state with the new commit info.
      activeStack.getRevisionsStatePromise();
      this.setViewMode(DiffMode.BROWSE_MODE);
    } catch (e) {
      atom.notifications.addError('Error creating commit', {
        detail: `Details: ${e.message}`,
        nativeFriendly: true,
      });
      this._setState({
        ...this._state,
        commitModeState: CommitModeState.READY,
      });
      return;
    }
  }

  getState(): State {
    return this._state;
  }

  setCommitMode(commitMode: CommitModeType, loadModeState?: boolean = true): void {
    if (this._state.commitMode === commitMode) {
      return;
    }
    track('diff-view-switch-commit-mode', {
      commitMode,
    });
    this._setState({
      ...this._state,
      commitMode,
      commitMessage: null,
    });
    if (loadModeState) {
      // When the commit mode changes, load the appropriate commit message.
      this._loadModeState(true);
    }
  }

  activate(): void {
    this._updateRepositories();
    this._isActive = true;
    for (const repositoryStack of this._repositoryStacks.values()) {
      repositoryStack.activate();
    }
  }

  deactivate(): void {
    this._isActive = false;
    if (this._activeRepositoryStack != null) {
      this._activeRepositoryStack.deactivate();
      this._activeRepositoryStack = null;
    }
    this._setActiveFileState(getInitialFileChangeState());
    this._activeSubscriptions.dispose();
  }

  dispose(): void {
    this._subscriptions.dispose();
    for (const repositoryStack of this._repositoryStacks.values()) {
      repositoryStack.dispose();
    }
    this._repositoryStacks.clear();
    for (const subscription of this._repositorySubscriptions.values()) {
      subscription.dispose();
    }
    this._repositorySubscriptions.clear();
    this._activeSubscriptions.dispose();
  }
}

module.exports = DiffViewModel;
