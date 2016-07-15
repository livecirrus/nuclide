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
import type {
  BookmarkInfo,
  LineDiff,
  StatusCodeNumberValue,
} from '../../nuclide-hg-repository-base/lib/HgService';
import type {HgRepositoryClient} from './HgRepositoryClient';

import {
  StatusCodeNumber,
  HgStatusOption,
} from '../../nuclide-hg-repository-base/lib/hg-constants';

/*
 * Delegate to the passed in HgRepositoryClient.
 */
export default class HgRepositoryClientAsync {

  _client: HgRepositoryClient;

  constructor(client: HgRepositoryClient) {
    this._client = client;
  }

  getType(): string {
    return this._client.getType();
  }

  getWorkingDirectory(): string {
    return this._client.getWorkingDirectory();
  }

  /**
   * That extends the `GitRepositoryAsync` implementation which takes a single file path.
   * Here, it's possible to pass an array of file paths to revert/checkout-head.
   */
  checkoutHead(filePathsArg: NuclideUri | Array<NuclideUri>): Promise<void> {
    const filePaths = Array.isArray(filePathsArg) ? filePathsArg : [filePathsArg];
    return this._client._service.revert(filePaths);
  }

  checkoutReference(reference: string, create: boolean): Promise<void> {
    return this._client._service.checkout(reference, create);
  }

  createBookmark(name: string, revision: ?string): Promise<void> {
    return this._client._service.createBookmark(name, revision);
  }

  deleteBookmark(name: string): Promise<void> {
    return this._client._service.deleteBookmark(name);
  }

  renameBookmark(name: string, nextName: string): Promise<void> {
    return this._client._service.renameBookmark(name, nextName);
  }

  getBookmarks(): Promise<Array<BookmarkInfo>> {
    return this._client._service.fetchBookmarks();
  }

  async getShortHead(): Promise<string> {
    let newlyFetchedBookmark = '';
    try {
      newlyFetchedBookmark = await this._client._service.fetchActiveBookmark();
    } catch (e) {
      // Suppress the error. There are legitimate times when there may be no
      // current bookmark, such as during a rebase. In this case, we just want
      // to return an empty string if there is no current bookmark.
    }
    if (newlyFetchedBookmark !== this._client._activeBookmark) {
      this._client._activeBookmark = newlyFetchedBookmark;
      // The Atom status-bar uses this as a signal to refresh the 'shortHead'.
      // There is currently no dedicated 'shortHeadDidChange' event.
      this._client._emitter.emit('did-change-statuses');
      this._client._emitter.emit('did-change-short-head');
    }
    return this._client._activeBookmark || '';
  }

  getCachedPathStatus(filePath: ?NuclideUri): Promise<StatusCodeNumberValue> {
    return Promise.resolve(this._client.getCachedPathStatus(filePath));
  }

  // TODO This is a stub.
  getCachedUpstreamAheadBehindCount(
    path: ?NuclideUri,
  ): Promise<{ahead: number; behind: number;}> {
    return Promise.resolve(this._client.getCachedUpstreamAheadBehindCount(path));
  }

  getDiffStats(filePath: NuclideUri): Promise<{added: number; deleted: number;}> {
    return Promise.resolve(this._client.getDiffStats(filePath));
  }

  /**
   * Recommended method to use to get the line diffs of files in this repo.
   * @param path The absolute file path to get the line diffs for. If the path \
   *   is not in the project, an empty Array will be returned.
   */
  getLineDiffs(filePath: NuclideUri): Promise<Array<LineDiff>> {
    return Promise.resolve(this._client.getLineDiffs(filePath));
  }

  async refreshStatus(): Promise<void> {
    const repoRoot = this._client.getWorkingDirectory();
    const repoProjects = atom.project.getPaths().filter(projPath => projPath.startsWith(repoRoot));
    await this._client.getStatuses(repoProjects, {
      hgStatusOption: HgStatusOption.ONLY_NON_IGNORED,
    });
  }

  getHeadCommitMessage(): Promise<?string> {
    return this._client._service.getHeadCommitMessage();
  }

  /**
   * Return relative paths to status code number values object.
   * matching `GitRepositoryAsync` implementation.
   */
  getCachedPathStatuses(): {[filePath: string]: StatusCodeNumberValue} {
    const absoluteCodePaths = this._client.getAllPathStatuses();
    const relativeCodePaths = {};
    for (const absolutePath in absoluteCodePaths) {
      const relativePath = this._client.relativize(absolutePath);
      relativeCodePaths[relativePath] = absoluteCodePaths[absolutePath];
    }
    return relativeCodePaths;
  }

  isPathIgnored(filePath: ?NuclideUri): Promise<boolean> {
    return Promise.resolve(this._client.isPathIgnored(filePath));
  }

  isStatusStaged(status: ?number): boolean {
    return false;
  }

  isStatusIgnored(status: ?number): boolean {
    return status === StatusCodeNumber.IGNORED;
  }

  isStatusModified(status: ?number): boolean {
    return status === StatusCodeNumber.MODIFIED;
  }

  isStatusDeleted(status: ?number): boolean {
    return (
      status === StatusCodeNumber.MISSING ||
      status === StatusCodeNumber.REMOVED
    );
  }

  isStatusNew(status: ?number): boolean {
    return (
      status === StatusCodeNumber.ADDED ||
      status === StatusCodeNumber.UNTRACKED
    );
  }

  isStatusAdded(status: ?number): boolean {
    return status === StatusCodeNumber.ADDED;
  }

  isStatusUntracked(status: ?number): boolean {
    return status === StatusCodeNumber.UNTRACKED;
  }

  onDidChangeBookmarks(callback: () => mixed): IDisposable {
    return this._client._emitter.on('did-change-bookmarks', callback);
  }

  onDidChangeShortHead(callback: () => mixed): IDisposable {
    return this._client._emitter.on('did-change-short-head', callback);
  }

  onDidChangeStatus(
    callback: (event: {path: string; pathStatus: StatusCodeNumberValue}) => mixed,
  ): IDisposable {
    return this._client.onDidChangeStatus(callback);
  }

  onDidChangeStatuses(callback: () => mixed): IDisposable {
    return this._client.onDidChangeStatuses(callback);
  }

  addAll(filePaths: Array<NuclideUri>): Promise<void> {
    return this._client.addAll(filePaths);
  }

  onDidDestroy(callback: () => mixed): IDisposable {
    return this._client.onDidDestroy(callback);
  }

}
