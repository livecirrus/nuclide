'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

// eslint-disable-next-line nuclide-internal/no-cross-atom-imports
import {DebuggerLaunchAttachProvider} from '../../nuclide-debugger-atom';
import {React} from 'react-for-atom';
import {LaunchUiComponent} from './LaunchUiComponent';
import {AttachUiComponent} from './AttachUiComponent';
import invariant from 'assert';

export class HhvmLaunchAttachProvider extends DebuggerLaunchAttachProvider {
  constructor(debuggingTypeName: string, targetUri: string) {
    super(debuggingTypeName, targetUri);
  }

  getActions(): Array<string> {
    return ['Attach', 'Launch'];
  }

  getComponent(action: string): ?React.Element<any> {
    if (action === 'Launch') {
      return <LaunchUiComponent targetUri={this.getTargetUri()} />;
    } else if (action === 'Attach') {
      return <AttachUiComponent targetUri={this.getTargetUri()} />;
    } else {
      invariant(false, 'Unrecognized action for component.');
    }
  }

  dispose(): void {}
}
