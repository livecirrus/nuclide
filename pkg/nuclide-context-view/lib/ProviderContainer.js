'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {React} from 'react-for-atom';
import {Section} from '../../nuclide-ui/lib/Section';
import {ShowMoreComponent} from '../../nuclide-ui/lib/ShowMoreComponent';
import analytics from '../../nuclide-analytics';

type Props = {
  title: string;
  isEditorBased: boolean;
  children?: React.Element<any>;
};

type State = {
  collapsed: boolean;
};

/**
 * Each context provider view is rendered inside a ProviderContainer.
 */
export class ProviderContainer extends React.Component {

  props: Props;
  state: State;

  constructor(props: Props): void {
    super(props);
    this.state = {
      collapsed: false,
    };
    (this: any)._setCollapsed = this._setCollapsed.bind(this);
  }

  render(): ?React.Element<any> {
    return (
      <div className="nuclide-context-view-provider-container">
        <Section headline={this.props.title}
          collapsable={true}
          onChange={this._setCollapsed}
          collapsed={this.state.collapsed}>
          {this.props.isEditorBased ? this.props.children : this._textBasedComponent()}
        </Section>
      </div>
    );
  }

  _setCollapsed(collapsed: boolean): void {
    this.setState({collapsed});
    analytics.track('nuclide-context-view-toggle-provider', {
      title: this.props.title,
      collapsed: String(collapsed),
    });
  }

  _textBasedComponent(): React.Element<any> {
    return (
      <ShowMoreComponent maxHeight={600} showMoreByDefault={false}>
        {this.props.children}
      </ShowMoreComponent>
    );
  }
}
