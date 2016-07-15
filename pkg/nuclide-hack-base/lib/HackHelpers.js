'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {HackSearchPosition} from './HackService';
import type {HackSearchResult, HHSearchPosition} from './types';
import type {SearchResultTypeValue} from '../../nuclide-hack-common';

import invariant from 'assert';
import {asyncExecute} from '../../commons-node/process';
import {PromiseQueue} from '../../commons-node/promise-executors';
import {SearchResultType} from '../../nuclide-hack-common';
import {findHackConfigDir, getHackExecOptions} from './hack-config';

const HH_SERVER_INIT_MESSAGE = 'hh_server still initializing';
const HH_SERVER_BUSY_MESSAGE = 'hh_server is busy';
import {logger} from './hack-config';

let hhPromiseQueue: ?PromiseQueue = null;
const pendingSearchPromises: Map<string, Promise<any>> = new Map();

 /**
  * Executes hh_client with proper arguments returning the result string or json object.
  */
export async function callHHClient(
  args: Array<any>,
  errorStream: boolean,
  outputJson: boolean,
  processInput: ?string,
  filePath: string): Promise<?(string | Object)> {

  if (!hhPromiseQueue) {
    hhPromiseQueue = new PromiseQueue();
  }

  const hackExecOptions = await getHackExecOptions(filePath);
  if (!hackExecOptions) {
    return null;
  }
  const {hackRoot, hackCommand} = hackExecOptions;

  invariant(hhPromiseQueue);
  return hhPromiseQueue.submit(async (resolve, reject) => {
    // Append args on the end of our commands.
    const defaults = ['--retries', '0', '--retry-if-init', 'false', '--from', 'nuclide'];
    if (outputJson) {
      defaults.unshift('--json');
    }

    const allArgs = defaults.concat(args);
    allArgs.push(hackRoot);

    let execResult = null;
    try {
      logger.logTrace(`Calling Hack: ${hackCommand} with ${allArgs.toString()}`);
      execResult = await asyncExecute(hackCommand, allArgs, {stdin: processInput});
    } catch (err) {
      reject(err);
      return;
    }
    const {stdout, stderr} = execResult;
    if (stderr.indexOf(HH_SERVER_INIT_MESSAGE) !== -1) {
      reject(new Error(`${HH_SERVER_INIT_MESSAGE}: try: \`arc build\` or try again later!`));
      return;
    } else if (stderr.startsWith(HH_SERVER_BUSY_MESSAGE)) {
      reject(new Error(`${HH_SERVER_BUSY_MESSAGE}: try: \`arc build\` or try again later!`));
      return;
    }

    const output = errorStream ? stderr : stdout;
    logger.logTrace(`Hack output for ${allArgs.toString()}: ${output}`);
    if (!outputJson) {
      resolve(output);
      return;
    }
    try {
      resolve(JSON.parse(output));
    } catch (err) {
      const errorMessage = `hh_client error, args: [${args.join(',')}]
stdout: ${stdout}, stderr: ${stderr}`;
      logger.logError(errorMessage);
      reject(new Error(errorMessage));
    }
  });
}

export async function getSearchResults(
    filePath: string,
    search: string,
    filterTypes?: ?Array<SearchResultTypeValue>,
    searchPostfix?: string,
  ): Promise<?HackSearchResult> {
  if (search == null) {
    return null;
  }
  const hackRoot = await findHackConfigDir(filePath);
  if (hackRoot == null) {
    return null;
  }

  // `pendingSearchPromises` is used to temporally cache search result promises.
  // So, when a matching search query is done in parallel, it will wait and resolve
  // with the original search call.
  let searchPromise = pendingSearchPromises.get(search);
  if (!searchPromise) {
    searchPromise = callHHClient(
        /*args*/ ['--search' + (searchPostfix || ''), search],
        /*errorStream*/ false,
        /*outputJson*/ true,
        /*processInput*/ null,
        /*file*/ filePath,
    );
    pendingSearchPromises.set(search, searchPromise);
  }

  let searchResponse: ?Array<HHSearchPosition> = null;
  try {
    searchResponse = (
      ((await searchPromise): any): ?Array<HHSearchPosition>
    );
  } finally {
    pendingSearchPromises.delete(search);
  }

  if (searchResponse == null) {
    return null;
  }

  const searchResult = searchResponse;
  let result: Array<HackSearchPosition> = [];
  for (const entry of searchResult) {
    const resultFile = entry.filename;
    if (!resultFile.startsWith(hackRoot)) {
      // Filter out files out of repo results, e.g. hh internal files.
      continue;
    }
    result.push({
      line: entry.line - 1,
      column: entry.char_start - 1,
      name: entry.name,
      path: resultFile,
      length: entry.char_end - entry.char_start + 1,
      scope: entry.scope,
      additionalInfo: entry.desc,
    });
  }

  if (filterTypes) {
    result = filterSearchResults(result, filterTypes);
  }
  return {hackRoot, result};
}

// Eventually this will happen on the hack side, but for now, this will do.
function filterSearchResults(
  results: Array<HackSearchPosition>,
  filter: Array<SearchResultTypeValue>,
): Array<HackSearchPosition> {
  return results.filter(result => {
    const info = result.additionalInfo;
    const searchType = getSearchType(info);
    return filter.indexOf(searchType) !== -1;
  });
}

function getSearchType(info: string): SearchResultTypeValue {
  switch (info) {
    case 'typedef':
      return SearchResultType.TYPEDEF;
    case 'function':
      return SearchResultType.FUNCTION;
    case 'constant':
      return SearchResultType.CONSTANT;
    case 'trait':
      return SearchResultType.TRAIT;
    case 'interface':
      return SearchResultType.INTERFACE;
    case 'abstract class':
      return SearchResultType.ABSTRACT_CLASS;
    default: {
      if (info.startsWith('method') || info.startsWith('static method')) {
        return SearchResultType.METHOD;
      }
      if (info.startsWith('class var') || info.startsWith('static class var')) {
        return SearchResultType.CLASS_VAR;
      }
      return SearchResultType.CLASS;
    }
  }
}
