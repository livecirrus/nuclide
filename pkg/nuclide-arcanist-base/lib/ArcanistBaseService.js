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
import type {RevisionFileChanges} from '../../nuclide-hg-repository-base/lib/HgService';

import invariant from 'assert';
import {Observable} from 'rxjs';
import nuclideUri from '../../nuclide-remote-uri';
import {
  checkOutput,
  scriptSafeSpawnAndObserveOutput,
} from '../../commons-node/process';
import fsPromise from '../../commons-node/fsPromise';
import {
  fetchFilesChangedAtRevision,
} from '../../nuclide-hg-repository-base/lib/hg-revision-state-helpers';
import {
  expressionForRevisionsBeforeHead,
} from '../../nuclide-hg-repository-base/lib/hg-revision-expression-helpers';
import {
  findHgRepository,
} from '../../nuclide-source-control-helpers';


const logger = require('../../nuclide-logging').getLogger();

const ARC_CONFIG_FILE_NAME = '.arcconfig';

export type ArcDiagnostic = {
  type: string;
  text: string;
  filePath: NuclideUri;
  row: number;
  col: number;
  code: ?string;

  // For autofix
  original?: string;
  replacement?: string;
};

// Exported for testing
export const arcConfigDirectoryMap: Map<NuclideUri, ?NuclideUri> = new Map();
const arcProjectMap: Map<?NuclideUri, ?Object> = new Map();

export async function findArcConfigDirectory(fileName: NuclideUri): Promise<?NuclideUri> {
  if (!arcConfigDirectoryMap.has(fileName)) {
    const result = await fsPromise.findNearestFile(ARC_CONFIG_FILE_NAME, fileName);
    arcConfigDirectoryMap.set(fileName, result);
  }
  return arcConfigDirectoryMap.get(fileName);
}

export async function readArcConfig(fileName: NuclideUri): Promise<?any> {
  const arcConfigDirectory = await findArcConfigDirectory(fileName);
  if (!arcConfigDirectory) {
    return null;
  }
  if (!arcProjectMap.has(arcConfigDirectory)) {
    const arcconfigFile = nuclideUri.join(arcConfigDirectory, ARC_CONFIG_FILE_NAME);
    const contents = await fsPromise.readFile(arcconfigFile, 'utf8');
    invariant(typeof contents === 'string');
    const result = JSON.parse(contents);
    arcProjectMap.set(arcConfigDirectory, result);
  }
  return arcProjectMap.get(arcConfigDirectory);
}

export async function findArcProjectIdOfPath(fileName: NuclideUri): Promise<?string> {
  const project = await readArcConfig(fileName);
  return project ? project.project_id : null;
}

export async function getProjectRelativePath(fileName: NuclideUri): Promise<?string> {
  const arcPath = await findArcConfigDirectory(fileName);
  return arcPath && fileName ? nuclideUri.relative(arcPath, fileName) : null;
}

export async function findDiagnostics(pathToFiles: Array<NuclideUri>, skip: Array<string>):
    Promise<Array<ArcDiagnostic>> {
  const arcConfigDirToFiles: Map<string, Array<string>> = new Map();
  await Promise.all(
    pathToFiles.map(async file => {
      const arcConfigDir = await findArcConfigDirectory(file);
      if (arcConfigDir) {
        let files = arcConfigDirToFiles.get(arcConfigDir);
        if (files == null) {
          files = [];
          arcConfigDirToFiles.set(arcConfigDir, files);
        }
        files.push(file);
      }
    })
  );

  // Kick off all the arc execs at once, then await later so they all happen in parallel.
  const results: Array<Promise<Array<ArcDiagnostic>>> = [];
  for (const [arcDir, files] of arcConfigDirToFiles) {
    results.push(execArcLint(arcDir, files, skip));
  }

  // Flatten the resulting array
  return [].concat(...(await Promise.all(results)));
}


async function getMercurialHeadCommitChanges(filePath: string): Promise<?RevisionFileChanges> {
  const hgRepoDetails = findHgRepository(filePath);
  if (hgRepoDetails == null) {
    return null;
  }
  const filesChanged = await fetchFilesChangedAtRevision(
    expressionForRevisionsBeforeHead(0),
    hgRepoDetails.workingDirectoryPath,
  );
  if (filesChanged == null) {
    throw new Error('Failed to fetch commit changed files while diffing');
  }
  return filesChanged;
}

async function getCommitBasedArcConfigDirectory(filePath: string): Promise<?string> {
  // TODO Support other source control types file changes (e.g. `git`).
  const filesChanged = await getMercurialHeadCommitChanges(filePath);
  if (filesChanged == null) {
    throw new Error('Cannot find source control root to diff from');
  }
  let configLookupPath = null;
  if (filesChanged.all.length > 0) {
    configLookupPath = fsPromise.getCommonAncestorDirectory(filesChanged.all);
  } else {
    configLookupPath = filePath;
  }
  return await findArcConfigDirectory(configLookupPath);
}

function _callArcDiff(
  filePath: NuclideUri,
  extraArcDiffArgs: Array<string>,
): Observable<{stderr?: string; stdout?: string;}> {
  const args = ['diff', '--json'].concat(extraArcDiffArgs);

  return Observable
    .fromPromise(getCommitBasedArcConfigDirectory(filePath))
    .flatMap((arcConfigDir: ?string) => {
      if (arcConfigDir == null) {
        throw new Error('Failed to find Arcanist config.  Is this project set up for Arcanist?');
      }
      const options = {
        cwd: arcConfigDir,
      };
      return scriptSafeSpawnAndObserveOutput('arc', args, options);
    }).share();
}

export function createPhabricatorRevision(
  filePath: NuclideUri,
): Observable<{stderr?: string; stdout?: string;}> {
  return _callArcDiff(filePath, ['--verbatim']);
}

export function updatePhabricatorRevision(
  filePath: NuclideUri,
  message: string,
  allowUntracked: boolean,
): Observable<{stderr?: string; stdout?: string;}> {
  const args = ['-m', message];
  if (allowUntracked) {
    args.push('--allow-untracked');
  }
  return _callArcDiff(filePath, args);
}

async function execArcLint(cwd: string, filePaths: Array<NuclideUri>, skip: Array<string>):
    Promise<Array<ArcDiagnostic>> {
  const args: Array<string> = ['lint', '--output', 'json', ...filePaths];
  if (skip.length > 0) {
    args.push('--skip', skip.join(','));
  }
  const options = {cwd};
  const result = await checkOutput('arc', args, options);

  const output: Map<string, Array<Object>> = new Map();
  // Arc lint outputs multiple JSON objects on mutliple lines. Split them, then merge the
  // results.
  for (const line of result.stdout.trim().split('\n')) {
    let json;
    try {
      json = JSON.parse(line);
    } catch (error) {
      logger.warn('Error parsing `arc lint` JSON output', line);
      continue;
    }
    for (const file of Object.keys(json)) {
      const errorsToAdd = json[file];

      let errors = output.get(file);
      if (errors == null) {
        errors = [];
        output.set(file, errors);
      }
      for (const error of errorsToAdd) {
        errors.push(error);
      }
    }
  }

  const lints = [];
  for (const file of filePaths) {
    // TODO(7876450): For some reason, this does not work for particular values of pathToFile.
    // Depending on the location of .arcconfig, we may get a key that is different from what `arc
    // lint` actually returns, and end up without any lints for this path.
    const key = nuclideUri.relative(cwd, file);
    const rawLints = output.get(key);
    if (rawLints) {
      for (const lint of convertLints(file, rawLints)) {
        lints.push(lint);
      }
    }
  }
  return lints;
}

function convertLints(
  pathToFile: string,
  lints: Array<{
    severity: string;
    line: number;
    char: number;
    code: string;
    description: string;
    original?: string;
    replacement?: string;
  }>,
): Array<ArcDiagnostic> {
  return lints.map(lint => {
    // Choose an appropriate level based on lint['severity'].
    const severity = lint.severity;
    const level = severity === 'error' ? 'Error' : 'Warning';

    const line = lint.line;
    // Sometimes the linter puts in global errors on line 0, which will result
    // in a negative index. We offset those back to the first line.
    const col = Math.max(0, lint.char - 1);
    const row = Math.max(0, line - 1);

    const diagnostic: ArcDiagnostic = {
      type: level,
      text: lint.description,
      filePath: pathToFile,
      row,
      col,
      code: lint.code,
    };
    if (lint.original != null) {
      diagnostic.original = lint.original;
    }
    if (lint.replacement != null) {
      diagnostic.replacement = lint.replacement;
    }
    return diagnostic;
  });
}
