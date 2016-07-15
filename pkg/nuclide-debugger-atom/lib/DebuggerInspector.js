'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import BreakpointStore from './BreakpointStore';
import Bridge from './Bridge';
import DebuggerActions from './DebuggerActions';
import {React, ReactDOM} from 'react-for-atom';
import nuclideUri from '../../nuclide-remote-uri';
import {
  Button,
  ButtonTypes,
} from '../../nuclide-ui/lib/Button';

/**
 * Wrapper for Chrome Devtools frontend view.
 */
const DebuggerInspector = React.createClass({
  _webviewNode: (null: ?Object),

  displayName: 'DebuggerInspector',

  propTypes: {
    actions: React.PropTypes.instanceOf(DebuggerActions).isRequired,
    breakpointStore: React.PropTypes.instanceOf(BreakpointStore).isRequired,
    socket: React.PropTypes.string.isRequired,
    bridge: React.PropTypes.instanceOf(Bridge).isRequired,
    toggleOldView: React.PropTypes.func.isRequired,
    showOldView: React.PropTypes.bool.isRequired,
  },

  shouldComponentUpdate(nextProps: Object, nextState: Object): boolean {
    return (
      nextProps.actions !== this.props.actions ||
      nextProps.breakpointStore !== this.props.breakpointStore ||
      nextProps.socket !== this.props.socket ||
      nextProps.bridge !== this.props.bridge ||
      nextProps.showOldView !== this.props.showOldView ||
      nextProps.toggleOldView !== this.props.toggleOldView
    );
  },

  render(): ?React.Element<any> {
    return (
      <div className="inspector">
        <div className="control-bar" ref="controlBar">
          <Button
            title="Detach from the current process."
            icon="x"
            buttonType={ButtonTypes.ERROR}
            onClick={this._handleClickClose}
          />
          <Button
            title="(Debug) Open Web Inspector for the debugger frame."
            icon="gear"
            onClick={this._handleClickDevTools}
          />
          <Button
            title="Switch back to the old debugger UI"
            icon="history"
            onClick={this._handleClickUISwitch}
          />
        </div>
      </div>
    );
  },

  componentDidMount() {
    // Cast from HTMLElement down to WebviewElement without instanceof
    // checking, as WebviewElement constructor is not exposed.
    const webviewNode = ((document.createElement('webview'): any): WebviewElement);
    webviewNode.src = this._getUrl();
    webviewNode.nodeintegration = true;
    webviewNode.disablewebsecurity = true;
    webviewNode.classList.add('native-key-bindings'); // required to pass through certain key events
    webviewNode.classList.add('nuclide-debugger-webview');
    if (!this.props.showOldView) {
      webviewNode.classList.add('nuclide-debugger-webview-hidden');
    }
    this._webviewNode = webviewNode;
    const controlBarNode = ReactDOM.findDOMNode(this.refs.controlBar);
    controlBarNode.parentNode.insertBefore(webviewNode, controlBarNode.nextSibling);
    this.props.bridge.setWebviewElement(webviewNode);
  },

  componentDidUpdate(prevProps: Object, prevState: Object): void {
    const webviewNode = this._webviewNode;
    if (webviewNode == null) {
      return;
    }
    if (this.props.socket !== prevProps.socket) {
      webviewNode.src = this._getUrl();
    }
    const {showOldView} = this.props;
    if (showOldView !== prevProps.showOldView) {
      webviewNode.classList.toggle('nuclide-debugger-webview-hidden', !showOldView);
    }
  },

  componentWillUnmount() {
    if (this.props.bridge) {
      this.props.bridge.cleanup();
    }
    this._webviewNode = null;
  },

  _getUrl(): string {
    return `${nuclideUri.join(__dirname, '../scripts/inspector.html')}?${this.props.socket}`;
  },

  _handleClickClose() {
    this.props.actions.stopDebugging();
  },

  _handleClickDevTools() {
    const webviewNode = this._webviewNode;
    if (webviewNode) {
      webviewNode.openDevTools();
    }
  },

  _handleClickUISwitch(): void {
    this.props.toggleOldView();
  },
});

module.exports = DebuggerInspector;
