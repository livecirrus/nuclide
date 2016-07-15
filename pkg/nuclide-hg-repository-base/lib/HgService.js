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

import nuclideUri from '../../nuclide-remote-uri';
import fs from 'fs';
import {WatchmanClient} from '../../nuclide-watchman-helpers';

import {
  HgStatusOption,
  MergeConflictStatus,
  StatusCodeId,
} from './hg-constants';
import {Observable, Subject} from 'rxjs';
import {parseHgBlameOutput} from './hg-blame-output-parser';
import {parseMultiFileHgDiffUnifiedOutput} from './hg-diff-output-parser';
import {
  expressionForCommonAncestor,
  expressionForRevisionsBeforeHead,
  fetchRevisionInfoBetweenRevisions,
  fetchRevisionInfo,
} from './hg-revision-expression-helpers';
import {
  fetchFileContentAtRevision,
  fetchFilesChangedAtRevision,
} from './hg-revision-state-helpers';
import {hgAsyncExecute} from './hg-utils';
import fsPromise from '../../commons-node/fsPromise';
import debounce from '../../commons-node/debounce';

import {readArcConfig} from '../../nuclide-arcanist-base';
import {getLogger} from '../../nuclide-logging';

const logger = getLogger();
const DEFAULT_ARC_PROJECT_FORK_BASE = 'remote/master';
const DEFAULT_FORK_BASE_NAME = 'default';

const WATCHMAN_SUBSCRIPTION_NAME_PRIMARY = 'hg-repository-watchman-subscription-primary';
const WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARK = 'hg-repository-watchman-subscription-hgbookmark';
const WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARKS = 'hg-repository-watchman-subscription-hgbookmarks';
const WATCHMAN_HG_DIR_STATE = 'hg-repository-watchman-subscription-dirstate';
const CHECK_CONFLICT_DELAY_MS = 500;

// If Watchman reports that many files have changed, it's not really useful to report this.
// This is typically caused by a large rebase or a Watchman re-crawl.
// We'll just report that the repository state changed, which should trigger a full client refresh.
const FILES_CHANGED_LIMIT = 1000;

// Mercurial (as of v3.7.2) [strips lines][1] matching the following prefix when a commit message is
// created by an editor invoked by Mercurial. Because Nuclide is not invoked by Mercurial, Nuclide
// must mimic the same stripping.
//
// Note: `(?m)` converts to `/m` in JavaScript-flavored RegExp to mean 'multiline'.
//
// [1] https://selenic.com/hg/file/3.7.2/mercurial/cmdutil.py#l2734
const COMMIT_MESSAGE_STRIP_LINE = /^HG:.*(\n|$)/gm;

// Suffixes of hg error messages that indicate that an error is safe to ignore,
// and should not warrant a user-visible error. These generally happen
// when performing an hg operation on a non-existent or untracked file.
const IGNORABLE_ERROR_SUFFIXES = [
  'abort: no files to copy',
  'No such file or directory',
  'does not exist!',
];

/**
 * These are status codes used by Mercurial's output.
 * Documented in http://selenic.com/hg/help/status.
 */
export type StatusCodeIdValue = 'A' | 'C' | 'I' | 'M' | '!' | 'R' | '?' | 'U';

export type MergeConflictStatusValue = 'both changed' | 'deleted in theirs' | 'deleted in ours';

/**
 * Internally, the HgRepository uses the string StatusCodeId to do bookkeeping.
 * However, GitRepository uses numbers to represent its statuses, and returns
 * statuses as numbers. In order to keep our status 'types' the same, we map the
 * string StatusCodeId to numbers.
 * The numbers themselves should not matter; they are meant to be passed
 * to ::isStatusNew/::isStatusModified to be interpreted.
 */
export type StatusCodeNumberValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type HgStatusOptionValue = 1 | 2 | 3;

export type LineDiff = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

export type BookmarkInfo = {
  active: boolean;
  bookmark: string;
  node: string;
  rev: number;
};

export type DiffInfo = {
  added: number;
  deleted: number;
  lineDiffs: Array<LineDiff>;
};

export type RevisionInfo = {
  id: number;
  hash: string;
  title: string;
  author: string;
  date: Date;
  description: string;
  // List of bookmarks at this revision.
  bookmarks: Array<string>;
};

export type AsyncExecuteRet = {
  command?: string;
  errorMessage?: string;
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type RevisionFileCopy = {
  from: NuclideUri;
  to: NuclideUri;
};

export type RevisionFileChanges = {
  all: Array<NuclideUri>;
  added: Array<NuclideUri>;
  deleted: Array<NuclideUri>;
  copied: Array<RevisionFileCopy>;
  modified: Array<NuclideUri>;
};

export type HgStatusCommandOptions = {
  hgStatusOption: HgStatusOptionValue;
};

export type VcsLogEntry = {
  node: string;
  user: string;
  desc: string;
  date: [number, number];
};

export type VcsLogResponse = {
  entries: Array<VcsLogEntry>;
};

export type MergeConflict = {
  path: string;
  message: MergeConflictStatusValue;
};

export type CheckoutSideName = 'ours' | 'theirs';

async function getForkBaseName(directoryPath: string): Promise<string> {
  const arcConfig = await readArcConfig(directoryPath);
  if (arcConfig != null) {
    return arcConfig['arc.feature.start.default']
      || arcConfig['arc.land.onto.default']
      || DEFAULT_ARC_PROJECT_FORK_BASE;
  }
  return DEFAULT_FORK_BASE_NAME;
}

/**
 * @return Array of additional watch expressions to apply to the primary
 *   watchman subscription.
 */
function getPrimaryWatchmanSubscriptionRefinements(): Array<mixed> {
  let refinements = [];
  try {
    // $FlowFB
    refinements = require('./fb/config').primaryWatchSubscriptionRefinements;
  } catch (e) {
    // purposely blank
  }
  return refinements;
}

export class HgService {
  _lockFileHeld: boolean;
  _lockFilePath: string;
  _isRebasing: boolean;
  _isInConflict: boolean;
  _rebaseStateFilePath: string;
  _watchmanClient: ?WatchmanClient;
  _hgDirWatcher: ?fs.FSWatcher;
  _origBackupPath: ?string;

  _workingDirectory: string;
  _filesDidChangeObserver: Subject<any>;
  _hgActiveBookmarkDidChangeObserver: Subject<any>;
  _hgBookmarksDidChangeObserver: Subject<any>;
  _hgRepoStateDidChangeObserver: Subject<any>;
  _watchmanSubscriptionPromise: Promise<void>;
  _hgConflictStateDidChangeObserver: Subject<boolean>;
  _debouncedCheckConflictChange: () => void;

  constructor(workingDirectory: string) {
    this._workingDirectory = workingDirectory;
    this._filesDidChangeObserver = new Subject();
    this._hgActiveBookmarkDidChangeObserver = new Subject();
    this._hgBookmarksDidChangeObserver = new Subject();
    this._hgRepoStateDidChangeObserver = new Subject();
    this._hgConflictStateDidChangeObserver = new Subject();
    this._lockFileHeld = false;
    this._lockFilePath = nuclideUri.join(workingDirectory, '.hg', 'wlock');
    this._rebaseStateFilePath = nuclideUri.join(workingDirectory, '.hg', 'rebasestate');
    this._isRebasing = false;
    this._isInConflict = false;
    this._debouncedCheckConflictChange = debounce(
      () => {
        this._checkConflictChange();
      },
      CHECK_CONFLICT_DELAY_MS,
    );
    this._watchmanSubscriptionPromise = this._subscribeToWatchman();
  }

  waitForWatchmanSubscriptions(): Promise<void> {
    return this._watchmanSubscriptionPromise;
  }

  async dispose(): Promise<void> {
    this._filesDidChangeObserver.complete();
    this._hgRepoStateDidChangeObserver.complete();
    this._hgActiveBookmarkDidChangeObserver.complete();
    this._hgBookmarksDidChangeObserver.complete();
    this._hgConflictStateDidChangeObserver.complete();
    if (this._hgDirWatcher != null) {
      this._hgDirWatcher.close();
      this._hgDirWatcher = null;
    }
    await this._cleanUpWatchman();
  }

  // Wrapper to help mocking during tests.
  _hgAsyncExecute(args: Array<string>, options: any): Promise<any> {
    return hgAsyncExecute(args, options);
  }

  /**
   * Section: File and Repository Status
   */

  /**
   * Shells out of the `hg status` to get the statuses of the paths. All paths
   * are presumed to be within the repo. (If any single path is not within the repo,
   * this method will return an empty map.)
   * @param options An Object with the following fields:
   *   * `hgStatusOption`: an HgStatusOption
   */
  async fetchStatuses(
    filePaths: Array<NuclideUri>,
    options: ?any,
  ): Promise<Map<NuclideUri, StatusCodeIdValue>> {
    const statusMap = new Map();

    let args = ['status', '-Tjson'];
    if (options && ('hgStatusOption' in options)) {
      if (options.hgStatusOption === HgStatusOption.ONLY_IGNORED) {
        args.push('--ignored');
      } else if (options.hgStatusOption === HgStatusOption.ALL_STATUSES) {
        args.push('--all');
      }
    }
    args = args.concat(filePaths);
    const execOptions = {
      cwd: this._workingDirectory,
    };
    let output;
    try {
      output = await this._hgAsyncExecute(args, execOptions);
    } catch (e) {
      return statusMap;
    }

    const statuses = JSON.parse(output.stdout);
    statuses.forEach(status => {
      statusMap.set(
        nuclideUri.join(this._workingDirectory, status.path),
        status.status,
      );
    });
    return statusMap;
  }

  async _subscribeToWatchman(): Promise<void> {
    // Using a local variable here to allow better type refinement.
    const watchmanClient = new WatchmanClient();
    this._watchmanClient = watchmanClient;
    const workingDirectory = this._workingDirectory;

    let primarySubscriptionExpression: Array<mixed> = ['allof',
      ['not', ['dirname', '.hg']],
      // Hg appears to modify temporary files that begin with these
      // prefixes, every time a file is saved.
      // TODO (t7832809) Remove this when it is unnecessary.
      ['not', ['match', 'hg-checkexec-*', 'wholename']],
      ['not', ['match', 'hg-checklink-*', 'wholename']],
      // This watchman subscription is used to determine when and which
      // files to fetch new statuses for. There is no reason to include
      // directories in these updates, and in fact they may make us overfetch
      // statuses. (See diff summary of D2021498.)
      // This line restricts this subscription to only return files.
      ['type', 'f'],
    ];
    primarySubscriptionExpression =
      primarySubscriptionExpression.concat(getPrimaryWatchmanSubscriptionRefinements());

    // Subscribe to changes to files unrelated to source control.
    const primarySubscribtion = await watchmanClient.watchDirectoryRecursive(
      workingDirectory,
      WATCHMAN_SUBSCRIPTION_NAME_PRIMARY,
      {
        fields: ['name', 'exists', 'new'],
        expression: primarySubscriptionExpression,
        defer: ['hg.update'],
      },
    );
    logger.debug(`Watchman subscription ${WATCHMAN_SUBSCRIPTION_NAME_PRIMARY} established.`);

    // TODO(most): Replace the usage of node watchers when watchman is ready
    //  with the advanced option: "defer": "hg.update"
    // Watchman currently (v4.5) doesn't report `.hg` file updates until it reaches
    // a stable filesystem (not respecting `defer_vcs` option) and
    // that doesn't happen with big mercurial updates (the primary use of state file watchers).
    // Hence, we here use node's filesystem watchers instead.
    try {
      this._hgDirWatcher = fs.watch(nuclideUri.join(workingDirectory, '.hg'), (event, fileName) => {
        if (fileName === 'wlock') {
          this._debouncedCheckConflictChange();
        } else if (fileName === 'rebasestate') {
          this._debouncedCheckConflictChange();
        }
      });
      logger.debug('Node watcher created for wlock files.');
    } catch (error) {
      getLogger().error('Error when creating node watcher for hg state files', error);
    }

    // Subscribe to changes to the active Mercurial bookmark.
    const hgActiveBookmarkSubscription = await watchmanClient.watchDirectoryRecursive(
      workingDirectory,
      WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARK,
      {
        fields: ['name', 'exists'],
        expression: ['name', '.hg/bookmarks.current', 'wholename'],
        defer: ['hg.update'],
      },
    );
    logger.debug(`Watchman subscription ${WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARK} established.`);

    // Subscribe to changes in Mercurial bookmarks.
    const hgBookmarksSubscription = await watchmanClient.watchDirectoryRecursive(
      workingDirectory,
      WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARKS,
      {
        fields: ['name', 'exists'],
        expression: ['name', '.hg/bookmarks', 'wholename'],
        defer: ['hg.update'],
      },
    );
    logger.debug(`Watchman subscription ${WATCHMAN_SUBSCRIPTION_NAME_HGBOOKMARKS} established.`);

    const dirStateSubscribtion = await watchmanClient.watchDirectoryRecursive(
      workingDirectory,
      WATCHMAN_HG_DIR_STATE,
      {
        fields: ['name'],
        expression: ['name', '.hg/dirstate', 'wholename'],
        defer: ['hg.update'],
      },
    );
    logger.debug(`Watchman subscription ${WATCHMAN_HG_DIR_STATE} established.`);

    primarySubscribtion.on('change', this._filesDidChange.bind(this));
    hgActiveBookmarkSubscription.on('change', this._hgActiveBookmarkDidChange.bind(this));
    hgBookmarksSubscription.on('change', this._hgBookmarksDidChange.bind(this));
    dirStateSubscribtion.on('change', this._emitHgRepoStateChanged.bind(this));
  }

  async _cleanUpWatchman(): Promise<void> {
    if (this._watchmanClient != null) {
      await this._watchmanClient.dispose();
      this._watchmanClient = null;
    }
  }

  /**
   * @param fileChanges The latest changed watchman files.
   */
  _filesDidChange(fileChanges: Array<any>): void {
    if (fileChanges.length > FILES_CHANGED_LIMIT) {
      this._emitHgRepoStateChanged();
      return;
    }

    const workingDirectory = this._workingDirectory;
    const changedFiles = fileChanges.map(change => nuclideUri.join(workingDirectory, change.name));
    this._filesDidChangeObserver.next(changedFiles);
  }

  async _updateStateFilesExistence(): Promise<void> {
    const [lockExists, rebaseStateExists] = await Promise.all([
      fsPromise.exists(this._lockFilePath),
      fsPromise.exists(this._rebaseStateFilePath),
    ]);
    this._lockFileHeld = lockExists;
    this._isRebasing = rebaseStateExists;
  }

  async _checkConflictChange(): Promise<void> {
    await this._updateStateFilesExistence();
    if (this._isInConflict) {
      if (!this._isRebasing) {
        this._isInConflict = false;
        this._hgConflictStateDidChangeObserver.next(false);
      }
      return;
    }
    // Detect if we are not in a conflict.
    if (!this._lockFileHeld && this._isRebasing) {
      const mergeConflicts = await this.fetchMergeConflicts();
      if (mergeConflicts.length > 0) {
        this._isInConflict = true;
        this._hgConflictStateDidChangeObserver.next(true);
      }
    }
  }

  _emitHgRepoStateChanged(): void {
    this._hgRepoStateDidChangeObserver.next();
  }

  _hgActiveBookmarkDidChange(): void {
    this._hgActiveBookmarkDidChangeObserver.next();
  }

  _hgBookmarksDidChange(): void {
    this._hgBookmarksDidChangeObserver.next();
  }

  /**
   * Observes one of more files has changed. Applies to all files except
   * .hgignore files. (See ::onHgIgnoreFileDidChange.)
   * @return A Observable which emits the changed file paths.
   */
  observeFilesDidChange(): Observable<Array<NuclideUri>> {
    return this._filesDidChangeObserver;
  }

  /**
   * Observes that a Mercurial event has occurred (e.g. histedit) that would
   * potentially invalidate any data cached from responses from this service.
   */
  observeHgRepoStateDidChange(): Observable<void> {
    return this._hgRepoStateDidChangeObserver;
  }

  /**
   * Observes when a Mercurial repository enters and exits a rebase state.
   */
  observeHgConflictStateDidChange(): Observable<boolean> {
    this._checkConflictChange();
    return this._hgConflictStateDidChangeObserver;
  }

  /**
   * Shells out to `hg diff` to retrieve line diff information for the paths.
   * @param An Array of NuclideUri (absolute paths) for which to fetch diff info.
   * @return A map of each NuclideUri (absolute path) to its DiffInfo.
   *   Each path is presumed to be in the repo.
   *   If the `hg diff` call fails, this method returns null.
   *   If a path has no changes, it will not appear in the returned Map.
   */
  async fetchDiffInfo(filePaths: Array<NuclideUri>): Promise<?Map<NuclideUri, DiffInfo>> {
    // '--unified 0' gives us 0 lines of context around each change (we don't
    // care about the context).
    // '--noprefix' omits the a/ and b/ prefixes from filenames.
    // '--nodates' avoids appending dates to the file path line.
    const args = ['diff', '--unified', '0', '--noprefix', '--nodates'].concat(filePaths);
    const options = {
      cwd: this._workingDirectory,
    };
    let output;
    try {
      output = await this._hgAsyncExecute(args, options);
    } catch (e) {
      getLogger().error(
          `Error when running hg diff for paths: ${filePaths.toString()} \n\tError: ${e.stderr}`);
      return null;
    }
    const pathToDiffInfo = parseMultiFileHgDiffUnifiedOutput(output.stdout);
    const absolutePathToDiffInfo = new Map();
    for (const [filePath, diffInfo] of pathToDiffInfo) {
      absolutePathToDiffInfo.set(
        nuclideUri.join(this._workingDirectory, filePath),
        diffInfo,
      );
    }
    return absolutePathToDiffInfo;
  }

  /**
   * Section: Bookmarks
   */

  createBookmark(name: string, revision: ?string): Promise<void> {
    const args = [];
    if (revision) {
      args.push('--rev', revision);
    }
    args.push(name);

    return this._runSimpleInWorkingDirectory('bookmark', args);
  }

  deleteBookmark(name: string): Promise<void> {
    return this._runSimpleInWorkingDirectory('bookmarks', ['--delete', name]);
  }

  renameBookmark(name: string, nextName: string): Promise<void> {
    return this._runSimpleInWorkingDirectory('bookmarks', ['--rename', name, nextName]);
  }

  /**
   * @return The name of the current bookmark.
   */
  fetchActiveBookmark(): Promise<string> {
    const {fetchActiveBookmark} = require('./hg-bookmark-helpers');
    return fetchActiveBookmark(nuclideUri.join(this._workingDirectory, '.hg'));
  }

  /**
   * @return An Array of bookmarks for this repository.
   */
  async fetchBookmarks(): Promise<Array<BookmarkInfo>> {
    const args = ['bookmarks', '-Tjson'];
    const execOptions = {
      cwd: this._workingDirectory,
    };

    let output;
    try {
      output = await this._hgAsyncExecute(args, execOptions);
    } catch (e) {
      getLogger().error(`LocalHgServiceBase failed to fetch bookmarks. Error: ${e.stderr}`);
      throw e;
    }

    return JSON.parse(output.stdout);
  }

  /**
   * Observes that the active Mercurial bookmark has changed.
   */
  observeActiveBookmarkDidChange(): Observable<void> {
    return this._hgActiveBookmarkDidChangeObserver;
  }

  /**
   * Observes that Mercurial bookmarks have changed.
   */
  observeBookmarksDidChange(): Observable<void> {
    return this._hgBookmarksDidChangeObserver;
  }

  /**
   * Section: Repository State at Specific Revisions
   */

  /**
   * @param filePath: The full path to the file of interest.
   * @param revision: An expression that hg can understand, specifying the
   * revision at which we want to see the file content.
   */
  fetchFileContentAtRevision(filePath: NuclideUri, revision: ?string): Promise<?string> {
    return fetchFileContentAtRevision(filePath, revision, this._workingDirectory);
  }

  fetchFilesChangedAtRevision(revision: string): Promise<?RevisionFileChanges> {
    return fetchFilesChangedAtRevision(revision, this._workingDirectory);
  }

  /**
   * Fetch the revision details between the current head and the the common ancestor
   * of head and master in the repository.
   * @return an array with the revision info (`title`, `author`, `date` and `id`)
   * or `null` if no common ancestor was found.
   */
  async fetchRevisionInfoBetweenHeadAndBase(): Promise<?Array<RevisionInfo>> {
    const forkBaseName = await getForkBaseName(this._workingDirectory);
    const revisionsInfo = await fetchRevisionInfoBetweenRevisions(
      expressionForCommonAncestor(forkBaseName),
      expressionForRevisionsBeforeHead(0),
      this._workingDirectory,
    );
    return revisionsInfo;
  }

  /**
   * Resolve the revision details of the base branch
   */
  async getBaseRevision(): Promise<RevisionInfo> {
    const forkBaseName = await getForkBaseName(this._workingDirectory);
    return await fetchRevisionInfo(
      expressionForCommonAncestor(forkBaseName),
      this._workingDirectory
    );
  }

  /**
   * Gets the blame for the filePath at the current revision, including uncommitted changes
   * (but not unsaved changes).
   * @param filePath The file to get blame information for.
   * @return A Map that maps a line number (0-indexed) to the name that line blames to.
   *   The name is of the form: "Firstname Lastname <username@email.com> ChangeSetID".
   *   The Firstname Lastname may not appear sometimes.
   *   If no blame information is available, returns an empty Map.
   */
  async getBlameAtHead(filePath: NuclideUri): Promise<Map<string, string>> {
    const args =
      ['blame', '-r', 'wdir()', '-Tjson', '--changeset', '--user', '--line-number', filePath];
    const execOptions = {
      cwd: this._workingDirectory,
    };
    let output;
    try {
      output = await this._hgAsyncExecute(args, execOptions);
    } catch (e) {
      getLogger().error(
          `LocalHgServiceBase failed to fetch blame for file: ${filePath}. Error: ${e.stderr}`);
      throw e;
    }
    return parseHgBlameOutput(output.stdout);
  }

  /**
   * Returns the value of the config item at `key`.
   * @param key Name of config item
   */
  async getConfigValueAsync(key: string): Promise<?string> {
    const args = ['config', key];
    const execOptions = {
      cwd: this._workingDirectory,
    };
    try {
      return (await this._hgAsyncExecute(args, execOptions)).stdout.trim();
    } catch (e) {
      getLogger().error(
        `Failed to fetch Hg config for key ${key}.  Error: ${e.toString()}`
      );
      return null;
    }
  }

  /**
   * Gets the Differential Revision id (aka DXXXXXX) id for the specified changeSetId, if it exists.
   * Otherwise, returns null.
   * This implementation relies on the "phabdiff" template being available as defined in:
   * https://bitbucket.org/facebook/hg-experimental/src/fbf23b3f96bade5986121a7c57d7400585d75f54/phabdiff.py.
   */
  async getDifferentialRevisionForChangeSetId(changeSetId: string): Promise<?string> {
    const args = ['log', '-T', '{phabdiff}\n', '--limit', '1', '--rev', changeSetId];
    const execOptions = {
      cwd: this._workingDirectory,
    };
    try {
      const output = await this._hgAsyncExecute(args, execOptions);
      const stdout = output.stdout.trim();
      return stdout ? stdout : null;
    } catch (e) {
      // This should not happen: `hg log` does not error even if it does not recognize the template.
      getLogger().error(`Failed when trying to get differential revision for: ${changeSetId}`);
      return null;
    }
  }

  /**
   * Get the output of the experimental smartlog extension from Mercurial:
   * https://bitbucket.org/facebook/hg-experimental/#markdown-header-smartlog.
   * @param ttyOutput If true, return the output as if stdout were attached to a tty.
   * @param concise true to run `hg smartlog`; false to run `hg ssl`.
   * @return The output from running the command.
   */
  async getSmartlog(ttyOutput: boolean, concise: boolean): Promise<AsyncExecuteRet> {
    // disable the pager extension so that 'hg ssl' terminates. We can't just use
    // HGPLAIN because we have not found a way to get colored output when we do.
    const args = ['--config', 'extensions.pager=!', concise ? 'ssl' : 'smartlog'];
    const execOptions = {
      cwd: this._workingDirectory,
      NO_HGPLAIN: concise, // `hg ssl` is likely user-defined.
      TTY_OUTPUT: ttyOutput,
    };
    return await this._hgAsyncExecute(args, execOptions);
  }

  async _commitCode(
    message: ?string,
    extraArgs?: Array<string> = [],
  ): Promise<void> {
    const args = ['commit'];
    let tempFile = null;
    if (message != null) {
      tempFile = await fsPromise.tempfile();
      const strippedMessage = message.replace(COMMIT_MESSAGE_STRIP_LINE, '');
      await fsPromise.writeFile(tempFile, strippedMessage);
      args.push('-l', tempFile);
    }
    const execOptions = {
      cwd: this._workingDirectory,
    };
    try {
      await this._hgAsyncExecute(args.concat(extraArgs), execOptions);
    } finally {
      if (tempFile != null) {
        await fsPromise.unlink(tempFile);
      }
    }
  }

  /**
   * Commit code to version control.
   * @param message Commit message.
   */
  commit(message: string): Promise<void> {
    return this._commitCode(message);
  }

  /**
   * Amend code changes to the latest commit.
   * @param message Commit message.  Message will remain unchaged if not provided.
   */
  amend(message: ?string): Promise<void> {
    const extraArgs = ['--amend'];
    if (message == null) {
      extraArgs.push('--reuse-message', '.');
    }
    return this._commitCode(message, extraArgs);
  }

  revert(filePaths: Array<NuclideUri>): Promise<void> {
    return this._runSimpleInWorkingDirectory('revert', filePaths);
  }

  async _runSimpleInWorkingDirectory(
    action: string,
    args: Array<string>,
    opts: child_process$spawnOpts = {},
  ): Promise<void> {
    const options = {
      ...opts,
      cwd: this._workingDirectory,
    };
    const cmd = [action].concat(args);
    try {
      await this._hgAsyncExecute(cmd, options);
    } catch (e) {
      const errorString = e.stderr || e.message || e.toString();
      getLogger().error(
        'hg %s failed with [%s] arguments: %s',
        action,
        args.toString(),
        errorString,
      );
      throw new Error(errorString);
    }
  }

  /**
   * @param revision This could be a changeset ID, name of a bookmark, revision number, etc.
   * @param create Currently, this parameter is ignored.
   */
  checkout(revision: string, create: boolean): Promise<void> {
    return this._runSimpleInWorkingDirectory('checkout', [revision]);
  }

  /*
   * Silence errors from hg calls that don't include any tracked files - these
   * are generally harmless and should not create an error notification.
   * This checks the error string in order to avoid potentially slow hg pre-checks.
   */
  _rethrowErrorIfHelpful(e: Error): void {
    if (!IGNORABLE_ERROR_SUFFIXES.some(s => e.message.endsWith(s + '\n'))) {
      throw e;
    }
  }

  /**
   * Rename/move files versioned under Hg.
   * @param filePaths Which files should be renamed/moved.
   * @param destPath What should the file be renamed/moved to.
   */
  async rename(
    filePaths: Array<NuclideUri>,
    destPath: NuclideUri,
    after?: boolean,
  ): Promise<void> {
    const args = [
      ...filePaths.map(p => nuclideUri.getPath(p)), // Sources
      nuclideUri.getPath(destPath),                 // Dest
    ];
    if (after) {
      args.unshift('--after');
    }
    try {
      await this._runSimpleInWorkingDirectory('rename', args);
    } catch (e) {
      if (after) {
        this._rethrowErrorIfHelpful(e);
      } else {
        throw e;
      }
    }
  }

  /**
   * Remove a file versioned under Hg.
   * @param filePath Which file should be removed.
   */
  async remove(filePaths: Array<NuclideUri>, after?: boolean): Promise<void> {
    const args = ['-f', ...filePaths.map(p => nuclideUri.getPath(p))];
    if (after) {
      args.unshift('--after');
    }

    try {
      await this._runSimpleInWorkingDirectory('remove', args);
    } catch (e) {
      if (after) {
        this._rethrowErrorIfHelpful(e);
      } else {
        throw e;
      }
    }
  }

  /**
   * Version a new file under Hg.
   * @param filePath Which file should be versioned.
   */
  add(filePaths: Array<NuclideUri>): Promise<void> {
    return this._runSimpleInWorkingDirectory('add', filePaths);
  }

  async getHeadCommitMessage(): Promise<?string> {
    const args = [
      'log', '-T', '{desc}\n',
      '--limit', '1',
      '--rev', expressionForRevisionsBeforeHead(0),
    ];
    const execOptions = {
      cwd: this._workingDirectory,
    };
    try {
      const output = await this._hgAsyncExecute(args, execOptions);
      const stdout = output.stdout.trim();
      return stdout || null;
    } catch (e) {
      // This should not happen: `hg log` does not error even if it does not recognize the template.
      getLogger().error('Failed when trying to get head commit message');
      return null;
    }
  }

  async log(filePaths: Array<NuclideUri>, limit?: ?number): Promise<VcsLogResponse> {
    const args = ['log', '-Tjson'];
    if (limit != null && limit > 0) {
      args.push('--limit', String(limit));
    }
    for (const filePath of filePaths) {
      args.push(filePath);
    }

    const execOptions = {
      cwd: this._workingDirectory,
    };
    const result = await this._hgAsyncExecute(args, execOptions);
    const entries = JSON.parse(result.stdout);
    return {entries};
  }

  async fetchMergeConflicts(): Promise<Array<MergeConflict>> {
    const {stdout} = await this._hgAsyncExecute(['resolve', '--list', '-Tjson'], {
      cwd: this._workingDirectory,
    });
    const fileListStatuses = JSON.parse(stdout);
    const conflictedFiles = fileListStatuses.filter(fileStatus => {
      return fileStatus.status === StatusCodeId.UNRESOLVED;
    });
    const origBackupPath = await this._getOrigBackupPath();
    const conflicts = await Promise.all(conflictedFiles.map(async conflictedFile => {
      let message;
      // Heuristic: If the `.orig` file doesn't exist, then it's deleted by the rebasing commit.
      if (await this._checkOrigFile(origBackupPath, conflictedFile.path)) {
        message = MergeConflictStatus.BOTH_CHANGED;
      } else {
        message = MergeConflictStatus.DELETED_IN_THEIRS;
      }
      return {
        path: conflictedFile.path,
        message,
      };
    }));
    return conflicts;
  }

  async _getOrigBackupPath(): Promise<string> {
    if (this._origBackupPath == null) {
      const relativeBackupPath = await this.getConfigValueAsync('ui.origbackuppath');
      if (relativeBackupPath == null) {
        this._origBackupPath = this._workingDirectory;
      } else {
        this._origBackupPath = nuclideUri.join(this._workingDirectory, relativeBackupPath);
      }
    }
    return this._origBackupPath;
  }

  async _checkOrigFile(origBackupPath: string, filePath: string): Promise<boolean> {
    const origFilePath = nuclideUri.join(origBackupPath, `${filePath}.orig`);
    logger.info('origBackupPath:', origBackupPath);
    logger.info('filePath:', filePath);
    logger.info('origFilePath:', origFilePath);
    return await fsPromise.exists(origFilePath);
  }

  resolveConflictedFile(filePath: NuclideUri): Promise<void> {
    return this._runSimpleInWorkingDirectory('resolve', ['-m', filePath]);
  }

  continueRebase(): Promise<void> {
    return this._runSimpleInWorkingDirectory('rebase', ['--continue']);
  }

  abortRebase(): Promise<void> {
    return this._runSimpleInWorkingDirectory('rebase', ['--abort']);
  }

}
