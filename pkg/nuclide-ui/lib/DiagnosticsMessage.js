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
  FileDiagnosticMessage,
  Trace,
} from '../../nuclide-diagnostics-base';

import invariant from 'assert';
import {React} from 'react-for-atom';
import {Button} from './Button';
import {ButtonGroup} from './ButtonGroup';
import {DiagnosticsMessageText} from './DiagnosticsMessageText';
import {DiagnosticsTraceItem} from './DiagnosticsTraceItem';
import nuclideUri from '../../nuclide-remote-uri';

type DiagnosticsMessageProps = {
  message: FileDiagnosticMessage;
  goToLocation: (path: string, line: number) => mixed;
  fixer: (message: FileDiagnosticMessage) => void;
};

function plainTextForItem(item: FileDiagnosticMessage | Trace): string {
  let mainComponent = undefined;
  if (item.html != null) {
    // Quick and dirty way to get an approximation for the plain text from HTML.
    // This will work in simple cases, anyway.
    mainComponent = item.html.replace('<br/>', '\n').replace(/<[^>]*>/g, '');
  } else {
    invariant(item.text != null);
    mainComponent = item.text;
  }

  let pathComponent;
  if (item.filePath == null) {
    pathComponent = '';
  } else {
    const lineComponent = item.range != null ? `:${item.range.start.row + 1}` : '';
    pathComponent = ': ' + nuclideUri.getPath(item.filePath) + lineComponent;
  }
  return mainComponent + pathComponent;
}

function plainTextForDiagnostic(message: FileDiagnosticMessage): string {
  const trace = message.trace != null ? message.trace : [];
  return [message, ...trace].map(plainTextForItem).join('\n');
}

/**
 * Visually groups Buttons passed in as children.
 */
export const DiagnosticsMessage = (props: DiagnosticsMessageProps) => {
  const {
      message,
      goToLocation,
      fixer,
  } = props;
  const providerClassName = message.type === 'Error'
    ? 'highlight-error'
    : 'highlight-warning';
  const copy = () => {
    const text = plainTextForDiagnostic(message);
    atom.clipboard.write(text);
  };
  let fixButton = null;
  if (message.fix != null) {
    const applyFix = () => {
      fixer(message);
    };
    fixButton = (
      <Button className="btn-success" size="EXTRA_SMALL" onClick={applyFix}>Fix</Button>
    );
  }
  const header = (
    <div className="nuclide-diagnostics-gutter-ui-popup-header">
      <ButtonGroup>
        {fixButton}
        <Button size="EXTRA_SMALL" onClick={copy}>Copy</Button>
      </ButtonGroup>
      <span className={providerClassName}>{message.providerName}</span>
    </div>
  );
  const traceElements = message.trace
    ? message.trace.map((traceItem, i) =>
      <DiagnosticsTraceItem
        key={i}
        trace={traceItem}
        goToLocation={goToLocation}
      />
    )
    : null;
  return (
    <div>
      {header}
      <div className="nuclide-diagnostics-gutter-ui-popup-message">
        <DiagnosticsMessageText message={message} />
      </div>
      {traceElements}
    </div>
  );
};
