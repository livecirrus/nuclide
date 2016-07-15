'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import typeof * as FindInProjectService from '../../nuclide-remote-search';
import type {search$FileResult} from '../../nuclide-remote-search';

import {Observable, ReplaySubject} from 'rxjs';
import {RemoteDirectory} from '../../nuclide-remote-connection';

type RemoteDirectorySearch = {
  then: (onFullfilled: any, onRejected: any) => Promise<any>;
  cancel: () => void;
};

class RemoteDirectorySearcher {
  _serviceProvider: (dir: RemoteDirectory) => FindInProjectService;

  // When constructed, RemoteDirectorySearcher must be passed a function that
  // it can use to get a 'FindInProjectService' for a given remote path.
  constructor(serviceProvider: (dir: RemoteDirectory) => FindInProjectService) {
    this._serviceProvider = serviceProvider;
  }

  canSearchDirectory(directory: atom$Directory | RemoteDirectory): boolean {
    return RemoteDirectory.isRemoteDirectory(directory);
  }

  search(
    directories: Array<RemoteDirectory>,
    regex: RegExp,
    options: Object,
  ): RemoteDirectorySearch {
    // Track the files that we have seen updates for.
    const seenFiles = new Set();

    // Get the remote service that corresponds to each remote directory.
    const services = directories.map(dir => this._serviceProvider(dir));

    const searchStreams: Array<Observable<search$FileResult>> = directories.map((dir, index) =>
      services[index].findInProjectSearch(dir.getPath(), regex, options.inclusions));

    // Start the search in each directory, and merge the resulting streams.
    const searchStream = Observable.merge(...searchStreams);

    // Create a subject that we can use to track search completion.
    const searchCompletion = new ReplaySubject();
    searchCompletion.next();

    const subscription = searchStream.subscribe(next => {
      options.didMatch(next);

      // Call didSearchPaths with the number of unique files we have seen matches in. This is
      // not technically correct, as didSearchPaths is also supposed to count files for which
      // no matches were found. However, we currently have no way of obtaining this information.
      seenFiles.add(next.filePath);
      options.didSearchPaths(seenFiles.size);
    }, error => {
      options.didError(error);
      searchCompletion.error(error);
    }, () => {
      searchCompletion.complete();
    });

    // Return a promise that resolves on search completion.
    const completionPromise = searchCompletion.toPromise();
    return {
      then: completionPromise.then.bind(completionPromise),
      cancel() {
        // Cancel the subscription, which should also kill the grep process.
        subscription.unsubscribe();
      },
    };
  }
}

module.exports = RemoteDirectorySearcher;
