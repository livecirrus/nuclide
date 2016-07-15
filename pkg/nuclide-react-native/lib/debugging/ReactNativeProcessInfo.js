'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {NuclideUri} from '../../../nuclide-remote-uri';

// eslint-disable-next-line nuclide-internal/no-cross-atom-imports
import {DebuggerProcessInfo} from '../../../nuclide-debugger-atom';
import {ReactNativeDebuggerInstance} from './ReactNativeDebuggerInstance';

export class ReactNativeProcessInfo extends DebuggerProcessInfo {

  constructor(targetUri: NuclideUri) {
    super('react-native', targetUri);
  }

  debug(): Promise<ReactNativeDebuggerInstance> {
    // This is the port that the V8 debugger usually listens on.
    // TODO(matthewwithanm): Provide a way to override this in the UI.
    return Promise.resolve(new ReactNativeDebuggerInstance(this, 5858));
  }

  compareDetails(other: DebuggerProcessInfo): number {
    return 1;
  }

  displayString(): string {
    return this.getTargetUri();
  }

}
