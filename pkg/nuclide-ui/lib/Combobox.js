'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

type ComboboxOption = {
  value: string;
  valueLowercase: string;
  matchIndex: number;
};

import Rx from 'rxjs';
import {CompositeDisposable} from 'atom';
import {AtomInput} from './AtomInput';
import {React, ReactDOM} from 'react-for-atom';

type DefaultProps = {
  className: string;
  maxOptionCount: number;
  onChange: (newValue: string) => mixed;
  onSelect: (newValue: string) => mixed;
  width: number;
};

type State = {
  error: ?Error;
  filteredOptions: Array<Object>;
  loadingOptions: boolean;
  options: Array<string>;
  optionsVisible: boolean;
  selectedIndex: number;
  textInput: string;
};

/**
 * A Combo Box.
 * TODO allow making text input non-editable via props
 * TODO open/close options dropdown upon focus/blur
 * TODO add public getter/setter for textInput
 * TODO use generic search provider
 * TODO move combobox to separate package.
 */
export class Combobox extends React.Component {
  state: State;
  _updateSubscription: ?rx$ISubscription;
  _subscriptions: ?CompositeDisposable;

  static propTypes = {
    className: React.PropTypes.string.isRequired,
    formatRequestOptionsErrorMessage: React.PropTypes.func,
    initialTextInput: React.PropTypes.string,
    loadingMessage: React.PropTypes.string,
    placeholderText: React.PropTypes.string,
    maxOptionCount: React.PropTypes.number.isRequired,
    onChange: React.PropTypes.func.isRequired,
    onRequestOptionsError: React.PropTypes.func,
    onSelect: React.PropTypes.func.isRequired,
    onBlur: React.PropTypes.func,
    /**
     * promise-returning function; Gets called with
     * the current value of the input field as its only argument
     */
    requestOptions: React.PropTypes.func.isRequired,
    size: React.PropTypes.oneOf(['xs', 'sm', 'lg']),
    width: React.PropTypes.number,
  };

  static defaultProps: DefaultProps = {
    className: '',
    maxOptionCount: 10,
    onChange: (newValue: string) => {},
    onSelect: (newValue: string) => {},
    width: 200,
  };

  constructor(props: Object) {
    super(props);
    this.state = {
      error: null,
      filteredOptions: [],
      loadingOptions: false,
      options: [],
      optionsVisible: false,
      selectedIndex: -1,
      textInput: props.initialTextInput,
    };
    (this: any).receiveUpdate = this.receiveUpdate.bind(this);
    (this: any)._handleTextInputChange = this._handleTextInputChange.bind(this);
    (this: any)._handleInputBlur = this._handleInputBlur.bind(this);
    (this: any)._handleInputFocus = this._handleInputFocus.bind(this);
    (this: any)._handleMoveDown = this._handleMoveDown.bind(this);
    (this: any)._handleMoveUp = this._handleMoveUp.bind(this);
    (this: any)._handleCancel = this._handleCancel.bind(this);
    (this: any)._handleConfirm = this._handleConfirm.bind(this);
    (this: any)._scrollSelectedOptionIntoViewIfNeeded =
      this._scrollSelectedOptionIntoViewIfNeeded.bind(this);
  }

  componentDidMount() {
    const node = ReactDOM.findDOMNode(this);
    const _subscriptions = this._subscriptions = new CompositeDisposable();
    _subscriptions.add(
      atom.commands.add(node, 'core:move-up', this._handleMoveUp),
      atom.commands.add(node, 'core:move-down', this._handleMoveDown),
      atom.commands.add(node, 'core:cancel', this._handleCancel),
      atom.commands.add(node, 'core:confirm', this._handleConfirm),
      this.refs.freeformInput.onDidChange(this._handleTextInputChange)
    );
    this.requestUpdate(this.state.textInput);
  }

  componentWillUnmount() {
    if (this._subscriptions) {
      this._subscriptions.dispose();
    }
    if (this._updateSubscription != null) {
      this._updateSubscription.unsubscribe();
    }
  }

  requestUpdate(textInput: string): void {
    // Cancel pending update.
    if (this._updateSubscription != null) {
      this._updateSubscription.unsubscribe();
    }

    this.setState({error: null, loadingOptions: true});

    this._updateSubscription = Rx.Observable.fromPromise(
      this.props.requestOptions(textInput)
    )
      .subscribe(
        options => this.receiveUpdate(options),
        err => {
          this.setState({
            error: err,
            loadingOptions: false,
            options: [],
            filteredOptions: [],
          });
          if (this.props.onRequestOptionsError != null) {
            this.props.onRequestOptionsError(err);
          }
        },
      );
  }

  receiveUpdate(newOptions: Array<string>) {
    const filteredOptions = this._getFilteredOptions(newOptions, this.state.textInput);
    this.setState({
      error: null,
      loadingOptions: false,
      options: newOptions,
      filteredOptions,
    });
  }

  selectValue(newValue: string, didRenderCallback?: () => void) {
    this.refs.freeformInput.setText(newValue);
    this.setState({
      textInput: newValue,
      selectedIndex: -1,
      optionsVisible: false,
    }, didRenderCallback);
    this.props.onSelect(newValue);
    // Selecting a value in the dropdown changes the text as well. Call the callback accordingly.
    this.props.onChange(newValue);
  }

  getText(): string {
    return this.refs.freeformInput.getText();
  }

  // TODO use native (fuzzy/strict - configurable?) filter provider
  _getFilteredOptions(options: Array<string>, filterValue: string): Array<ComboboxOption> {
    const lowerCaseState = filterValue.toLowerCase();
    return options
      .map(
        option => {
          const valueLowercase = option.toLowerCase();
          return {
            value: option,
            valueLowercase,
            matchIndex: valueLowercase.indexOf(lowerCaseState),
          };
        }
      ).filter(
        option => option.matchIndex !== -1
      ).slice(0, this.props.maxOptionCount);
  }

  _handleTextInputChange(): void {
    const newText = this.refs.freeformInput.getText();
    if (newText === this.state.textInput) {
      return;
    }
    this.requestUpdate(newText);
    const filteredOptions = this._getFilteredOptions(this.state.options, newText);
    let selectedIndex;
    if (filteredOptions.length === 0) {
      // If there aren't any options, don't select anything.
      selectedIndex = -1;
    } else if (this.state.selectedIndex === -1 ||
        this.state.selectedIndex >= filteredOptions.length) {
      // If there are options and the selected index is out of bounds,
      // default to the first item.
      selectedIndex = 0;
    } else {
      selectedIndex = this.state.selectedIndex;
    }
    this.setState({
      textInput: newText,
      optionsVisible: true,
      filteredOptions,
      selectedIndex,
    });
    this.props.onChange(newText);
  }

  _handleInputFocus(): void {
    this.requestUpdate(this.state.textInput);
    this.setState({optionsVisible: true});
  }

  _handleInputBlur(): void {
    // Delay hiding the combobox long enough for a click inside the combobox to trigger on it in
    // case the blur was caused by a click inside the combobox. 150ms is empirically long enough to
    // let the stack clear from this blur event and for the click event to trigger.
    setTimeout(this._handleCancel, 150);
    if (this.props.onBlur) {
      this.props.onBlur(this.getText());
    }
  }

  _handleItemClick(selectedValue: string, event: any) {
    this.selectValue(selectedValue, () => {
      // Focus the input again because the click will cause the input to blur. This mimics native
      // <select> behavior by keeping focus in the form being edited.
      const input = ReactDOM.findDOMNode(this.refs.freeformInput);
      if (input) {
        input.focus();
      }
    });
  }

  _handleMoveDown() {
    this.setState({
      selectedIndex: Math.min(
        this.props.maxOptionCount - 1,
        this.state.selectedIndex + 1,
        this.state.filteredOptions.length - 1,
      ),
    }, this._scrollSelectedOptionIntoViewIfNeeded);
  }

  _handleMoveUp() {
    this.setState({
      selectedIndex: Math.max(
        0,
        this.state.selectedIndex - 1,
      ),
    }, this._scrollSelectedOptionIntoViewIfNeeded);
  }

  _handleCancel() {
    this.setState({
      optionsVisible: false,
    });
  }

  _handleConfirm() {
    const option = this.state.filteredOptions[this.state.selectedIndex];
    if (option !== undefined) {
      this.selectValue(option.value);
    }
  }

  _setSelectedIndex(selectedIndex: number) {
    this.setState({selectedIndex});
  }

  _scrollSelectedOptionIntoViewIfNeeded(): void {
    const selectedOption = ReactDOM.findDOMNode(this.refs.selectedOption);
    if (selectedOption) {
      selectedOption.scrollIntoViewIfNeeded();
    }
  }

  render(): React.Element<any> {
    let optionsContainer;
    const options = [];

    if (this.props.loadingMessage && this.state.loadingOptions) {
      options.push(
        <li key="loading-text" className="loading">
          <span className="loading-message">{this.props.loadingMessage}</span>
        </li>
      );
    }

    if (this.state.error != null && this.props.formatRequestOptionsErrorMessage != null) {
      const message = this.props.formatRequestOptionsErrorMessage(this.state.error);
      options.push(
        <li className="text-error">
          {message}
        </li>
      );
    }

    if (this.state.optionsVisible) {
      options.push(...this.state.filteredOptions.map((option, i) => {
        const beforeMatch = option.value.substring(0, option.matchIndex);
        const endOfMatchIndex = option.matchIndex + this.state.textInput.length;
        const highlightedMatch = option.value.substring(
          option.matchIndex,
          endOfMatchIndex
        );
        const afterMatch = option.value.substring(
          endOfMatchIndex,
          option.value.length
        );
        const isSelected = i === this.state.selectedIndex;
        return (
          <li
            className={isSelected ? 'selected' : null}
            key={option.value}
            onClick={this._handleItemClick.bind(this, option.value)}
            onMouseOver={this._setSelectedIndex.bind(this, i)}
            ref={isSelected ? 'selectedOption' : null}>
            {beforeMatch}
            <strong className="text-highlight">{highlightedMatch}</strong>
            {afterMatch}
          </li>
        );
      }));

      if (!options.length) {
        options.push(
          <li className="text-subtle" key="no-results-found">
            No results found
          </li>
        );
      }

      optionsContainer = (
        <ol className="list-group">
          {options}
        </ol>
      );
    }

    const {
      initialTextInput,
      placeholderText,
      size,
      width,
    } = this.props;
    return (
      <div className={'select-list popover-list popover-list-subtle ' + this.props.className}
           style={{width: `${width}px`}}>
        <AtomInput
          initialValue={initialTextInput}
          onBlur={this._handleInputBlur}
          onFocus={this._handleInputFocus}
          placeholderText={placeholderText}
          ref="freeformInput"
          size={size}
          width={width}
        />
        {optionsContainer}
      </div>
    );
  }

}
