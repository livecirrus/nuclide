'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Reference} from '../types';

import {AtomInput} from '../../../nuclide-ui/lib/AtomInput';
import {React} from 'react-for-atom';

type Props = {
  text: string;
  grammar: atom$Grammar;
  references: Array<Reference>;
  startLine: number;
  endLine: number;
  onClick: (event: SyntheticMouseEvent) => mixed;
};

export default class FilePreview extends React.Component {
  props: Props;

  componentDidMount() {
    const editor = this.refs.editor.getTextEditor();
    const {grammar, references, startLine} = this.props;

    if (grammar) {
      editor.setGrammar(grammar);
    }

    references.forEach((ref: Reference) => {
      const marker = editor.markBufferRange([
        [ref.start.line - startLine, ref.start.column - 1],
        [ref.end.line - startLine, ref.end.column],
      ]);
      editor.decorateMarker(marker, {type: 'highlight', class: 'reference'});
    });

    // Make sure at least one highlight is visible.
    editor.scrollToBufferPosition([
      references[0].end.line - startLine,
      references[0].end.column - 1,
    ]);
  }

  render(): React.Element<any> {
    const lineNumbers = [];
    for (let i = this.props.startLine; i <= this.props.endLine; i++) {
      lineNumbers.push(
        <div key={i} className="nuclide-find-references-line-number">
          {i}
        </div>
      );
    }
    return (
      <div className="nuclide-find-references-file-preview">
        <div className="nuclide-find-references-line-number-column">
          {lineNumbers}
        </div>
        <AtomInput
          ref="editor"
          initialValue={this.props.text}
          disabled={true}
          onClick={this.props.onClick}
        />
      </div>
    );
  }

}
