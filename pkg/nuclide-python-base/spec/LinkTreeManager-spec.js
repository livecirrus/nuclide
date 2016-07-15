'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import nuclideUri from '../../nuclide-remote-uri';
import fsPlus from 'fs-plus';
import temp from 'temp';
import LinkTreeManager from '../lib/LinkTreeManager';

temp.track();

function copyProject(projectInFixturesDirectory: string) {
  const tempDir = temp.mkdirSync('LinkTreeManager-spec');
  fsPlus.copySync(nuclideUri.join(__dirname, 'fixtures', projectInFixturesDirectory),
      tempDir);
  return tempDir;
}

// Disable buckd so it doesn't linger around after the test.
process.env.NO_BUCKD = '1';

describe('LinkTreeManager', () => {

  let linkTreeManager;
  const projectDir = copyProject('test-buck-project');
  const mockBuckProject = {
    getOwner(src) {
      return ['//test', '//test2'];
    },
    getPath() {
      return projectDir;
    },
    query(q) {
      return ['//testbin', '//testbin2'];
    },
  };

  beforeEach(() => {
    linkTreeManager = new LinkTreeManager();
  });

  it('correctly builds a link tree path given a source file path (mocked project)', () => {
    waitsForPromise(async () => {
      spyOn(linkTreeManager, '_getBuckProject').andReturn(mockBuckProject);

      const spy = spyOn(mockBuckProject, 'query').andReturn(['//testbin', '//testbin2']);
      const srcPath = nuclideUri.join(projectDir, 'test1/test1.py');
      const expectedPaths = [
        nuclideUri.join(projectDir, 'buck-out/gen/testbin#link-tree'),
        nuclideUri.join(projectDir, 'buck-out/gen/testbin2#link-tree'),
      ];

      const linkTreePaths = await linkTreeManager.getLinkTreePaths(srcPath);
      // rdeps query should be executed with the first owner found, and scoped to
      // the target of the source path's directory.
      expect(spy).toHaveBeenCalledWith(
        `kind(python_binary, rdeps(//test1:, owner(${srcPath})))`
      );
      // Properly resolve a link-tree path based on the source's firstly found
      // binary dependency.
      expect(linkTreePaths).toEqual(expectedPaths);
    });
  });

  it('queries for python_unittest targets if no python_binary was found', () => {
    waitsForPromise(async () => {
      spyOn(linkTreeManager, '_getBuckProject').andReturn(mockBuckProject);

      // Return an empty array for results, in which case the manager should try
      // querying for python_unittest targets too.
      const spy = spyOn(mockBuckProject, 'query').andReturn([]);
      const srcPath = nuclideUri.join(projectDir, 'test1/test1.py');
      const linkTreePaths = await linkTreeManager.getLinkTreePaths(srcPath);
      expect(spy).toHaveBeenCalledWith(
        `kind(python_unittest, rdeps(//test1:, owner(${srcPath})))`
      );
      expect(linkTreePaths).toEqual([]);
    });
  });

  it('resolves a link tree path with a buck project\'s source file', () => {
    // Large timeout for buck to warm up.
    waitsForPromise({timeout: 30000}, async () => {
      const srcPath = nuclideUri.join(projectDir, 'test1/test1.py');
      const linkTreePaths = await linkTreeManager.getLinkTreePaths(srcPath);
      expect(linkTreePaths).toEqual([
        nuclideUri.join(projectDir, 'buck-out/gen/test1/testbin1#link-tree'),
      ]);
    });
  });

});
