'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Octicon} from './Octicons';

import remote from 'remote';
import {React} from 'react-for-atom';
import {Button, ButtonSizes} from './Button';
import {ButtonGroup} from './ButtonGroup';

type ButtonSize = 'EXTRA_SMALL' | 'SMALL' | 'LARGE';

const Menu = remote.require('menu');
const MenuItem = remote.require('menu-item');

type Option<T> = {
  value: T;
  label: string;
  selectedLabel?: string;
  icon?: Octicon;
  disabled?: boolean;
};

type Props<T> = {
  value: T;
  buttonComponent?: ReactClass<any>;
  options: Array<Option<T>>;
  onChange?: (value: T) => mixed;
  onConfirm: (value: T) => mixed;
  confirmDisabled?: boolean;
  changeDisabled?: boolean;
  size: ?ButtonSize;
};

export class SplitButtonDropdown<T> extends React.Component {

  constructor(props: Props<T>) {
    super(props);
    (this: any)._handleDropdownClick = this._handleDropdownClick.bind(this);
  }

  render(): React.Element<any> {
    const selectedOption =
      this.props.options.find(option => option.value === this.props.value) || this.props.options[0];

    const ButtonComponent = this.props.buttonComponent || Button;

    return (
      <ButtonGroup className="nuclide-ui-split-button-dropdown">
        <ButtonComponent
          size={this.props.size}
          disabled={this.props.confirmDisabled === true}
          icon={selectedOption.icon}
          onClick={this.props.onConfirm}>
          {selectedOption.selectedLabel || selectedOption.label}
        </ButtonComponent>
        <Button
          size={this.props.size}
          className="nuclide-ui-split-button-dropdown-toggle"
          disabled={this.props.changeDisabled === true}
          icon="triangle-down"
          onClick={this._handleDropdownClick}
        />
      </ButtonGroup>
    );
  }

  _handleDropdownClick(event: SyntheticMouseEvent): void {
    const currentWindow = remote.getCurrentWindow();
    const menu = new Menu();
    this.props.options.forEach(option => {
      menu.append(new MenuItem({
        type: 'checkbox',
        checked: this.props.value === option.value,
        label: option.label,
        enabled: option.disabled !== true,
        click: () => {
          if (this.props.onChange != null) {
            this.props.onChange(option.value);
          }
        },
      }));
    });
    menu.popup(currentWindow, event.clientX, event.clientY);
  }

}

export {ButtonSizes};
