'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

// TODO @jxg export debugger typedefs from main module. (t11406963)
import type {
  EvaluationResult,
  ExpansionResult,
} from '../../nuclide-debugger-atom/lib/types';
import type {Observable} from 'rxjs';

import {React} from 'react-for-atom';
import invariant from 'assert';
import {bindObservableAsProps} from './bindObservableAsProps';
import {highlightOnUpdate} from './highlightOnUpdate';
import {ValueComponentClassNames} from './ValueComponentClassNames';
import {
  TreeList,
  TreeItem,
  NestedTreeItem,
} from './Tree';
import {LoadingSpinner} from './LoadingSpinner';

const SPINNER_DELAY = 100; /* ms */
const NOT_AVAILABLE_MESSAGE = '<not available>';

function isObjectValue(result: EvaluationResult): boolean {
  return result._objectId != null;
}

function TreeItemWithLoadingSpinner(): React.Element<any> {
  return <TreeItem><LoadingSpinner size="EXTRA_SMALL" delay={SPINNER_DELAY} /></TreeItem>;
}

type LoadableValueComponentProps = {
  children?: ExpansionResult;
  fetchChildren: ?(objectId: string) => Observable<?ExpansionResult>;
  path: string;
  expandedValuePaths: Map<string, NodeData>;
  onExpandedStateChange: (path: string, isExpanded: boolean) => void;
  simpleValueComponent: ReactClass<any>;
  shouldCacheChildren: boolean;
  getCachedChildren: (path: string) => ?ExpansionResult;
  setCachedChildren: (path: string, children: ExpansionResult) => void;
};

/**
 * A wrapper that renders a (delayed) spinner while the list of child properties is being loaded.
 * Otherwise, it renders ValueComponent for each property in `children`.
 */
const LoadableValueComponent = (props: LoadableValueComponentProps) => {
  const {
    children,
    fetchChildren,
    path,
    expandedValuePaths,
    onExpandedStateChange,
    simpleValueComponent,
    shouldCacheChildren,
    getCachedChildren,
    setCachedChildren,
  } = props;
  if (children == null) {
    return TreeItemWithLoadingSpinner();
  }
  if (shouldCacheChildren) {
    setCachedChildren(path, children);
  }
  return (
    <span>
      {
        children.map(child =>
          <TreeItem key={child.name}>
            <ValueComponent
              evaluationResult={child.value}
              fetchChildren={fetchChildren}
              expression={child.name}
              expandedValuePaths={expandedValuePaths}
              onExpandedStateChange={onExpandedStateChange}
              path={path + '.' + child.name}
              simpleValueComponent={simpleValueComponent}
              shouldCacheChildren={shouldCacheChildren}
              getCachedChildren={getCachedChildren}
              setCachedChildren={setCachedChildren}
            />
          </TreeItem>
        )
      }
    </span>
  );
};

// TODO allow passing action components (edit button, pin button) here
function renderValueLine(
  expression: React.Element<any> | ?string,
  value: React.Element<any> | string,
): React.Element<any> {
  if (expression == null) {
    return <div>{value}</div>;
  } else {
    // TODO @jxg use a text editor to apply proper syntax highlighting for expressions (t11408154)
    return (
      <div>
        <span className={ValueComponentClassNames.identifier}>{expression}</span>
        : {value}
      </div>
    );
  }
}

type LazyNestedValueComponentProps = {
  evaluationResult: ?EvaluationResult;
  fetchChildren: ?(objectId: string) => Observable<?ExpansionResult>;
  expression: ?string;
  isRoot?: boolean;
  expandedValuePaths: Map<string, NodeData>;
  onExpandedStateChange: (path: string, expanded: boolean) => void;
  path: string;
  simpleValueComponent: ReactClass<any>;
  shouldCacheChildren: boolean;
  getCachedChildren: (path: string) => ?ExpansionResult;
  setCachedChildren: (path: string, children: ExpansionResult) => void;
};

type LazyNestedValueComponentState = {
  isExpanded: boolean;
  children: ?Observable<?ExpansionResult>;
};

/**
 * A component that knows how to render recursive, interactive expression/evaluationResult pairs.
 * The rendering of non-expandable "leaf" values is delegated to the SimpleValueComponent.
 */
class ValueComponent extends React.Component {
  props: LazyNestedValueComponentProps;
  state: LazyNestedValueComponentState;

  constructor(props: LazyNestedValueComponentProps) {
    super(props);
    this.state = {
      isExpanded: false,
      children: null,
    };
    this.state.children = null;
    (this: any)._toggleExpand = this._toggleExpand.bind(this);
  }

  componentDidMount(): void {
    const {
      path,
      expandedValuePaths,
      fetchChildren,
      evaluationResult,
    } = this.props;
    const nodeData = expandedValuePaths.get(path);
    if (
      !this.state.isExpanded &&
      nodeData != null &&
      nodeData.isExpanded &&
      this._shouldFetch() &&
      evaluationResult != null &&
      evaluationResult._objectId != null &&
      fetchChildren != null
    ) {
      invariant(evaluationResult._objectId != null);
      this.setState({
        children: fetchChildren(evaluationResult._objectId),
        isExpanded: true,
      });
    }
  }

  componentWillReceiveProps(nextProps: LazyNestedValueComponentProps): void {
    if (
      this._shouldFetch() &&
      this.state.isExpanded &&
      nextProps.evaluationResult != null &&
      nextProps.fetchChildren != null
    ) {
      const {_objectId} = nextProps.evaluationResult;
      if (_objectId == null) {
        return;
      }
      this.setState({
        children: nextProps.fetchChildren(_objectId),
      });
    }
  }

  _shouldFetch(): boolean {
    const {shouldCacheChildren, getCachedChildren, path} = this.props;
    const children = getCachedChildren(path);
    return !shouldCacheChildren || children == null;
  }

  _toggleExpand(event: SyntheticMouseEvent): void {
    const {
      fetchChildren,
      evaluationResult,
      onExpandedStateChange,
      path,
    } = this.props;
    const newState: LazyNestedValueComponentState = {
      children: null,
      isExpanded: !this.state.isExpanded,
    };
    if (!this.state.isExpanded) {
      if (
        this._shouldFetch() &&
        typeof fetchChildren === 'function' &&
        evaluationResult != null &&
        evaluationResult._objectId != null
      ) {
        newState.children = fetchChildren(evaluationResult._objectId);
      }
    }
    onExpandedStateChange(path, newState.isExpanded);
    this.setState(newState);
    event.stopPropagation();
  }

  render(): ?React.Element<any> {
    const {
      evaluationResult,
      expression,
      fetchChildren,
      isRoot,
      path,
      expandedValuePaths,
      onExpandedStateChange,
      shouldCacheChildren,
      getCachedChildren,
      setCachedChildren,
      simpleValueComponent: SimpleValueComponent,
    } = this.props;
    if (evaluationResult == null) {
      return renderValueLine(expression, NOT_AVAILABLE_MESSAGE);
    }
    if (!isObjectValue(evaluationResult)) {
      const simpleValueElement = (
        <SimpleValueComponent
          expression={expression}
          evaluationResult={evaluationResult}
          simpleValueComponent={SimpleValueComponent}
        />
      );
      return isRoot ? simpleValueElement : <TreeItem>{simpleValueElement}</TreeItem>;
    }
    const _description = evaluationResult._description || '<no description provided>';
    const {
      children,
      isExpanded,
    } = this.state;
    let childListElement = null;
    if (isExpanded) {
      const cachedChildren = getCachedChildren(path);
      if (shouldCacheChildren && cachedChildren != null) {
        childListElement = (
          <LoadableValueComponent
            children={cachedChildren}
            fetchChildren={fetchChildren}
            path={path}
            expandedValuePaths={expandedValuePaths}
            onExpandedStateChange={onExpandedStateChange}
            simpleValueComponent={SimpleValueComponent}
            shouldCacheChildren={shouldCacheChildren}
            getCachedChildren={getCachedChildren}
            setCachedChildren={setCachedChildren}
          />
        );
      } else if (children == null) {
        childListElement = <TreeItemWithLoadingSpinner />;
      } else {
        const ChildrenComponent = bindObservableAsProps(
          children.map(childrenValue => ({children: childrenValue})).startWith({children: null}),
          LoadableValueComponent
        );
        childListElement = (
          <ChildrenComponent
            fetchChildren={fetchChildren}
            path={path}
            expandedValuePaths={expandedValuePaths}
            onExpandedStateChange={onExpandedStateChange}
            simpleValueComponent={SimpleValueComponent}
            shouldCacheChildren={shouldCacheChildren}
            getCachedChildren={getCachedChildren}
            setCachedChildren={setCachedChildren}
          />
        );
      }
    }
    const title = renderValueLine(expression, _description);
    return (
      <TreeList showArrows={true}>
        <NestedTreeItem
          collapsed={!this.state.isExpanded}
          onClick={this._toggleExpand}
          title={title}>
          {childListElement}
        </NestedTreeItem>
      </TreeList>
    );
  }
}

type TopLevelValueComponentProps = {
  evaluationResult: ?EvaluationResult;
  fetchChildren: ?(objectId: string) => Observable<?ExpansionResult>;
  expression: ?string;
  simpleValueComponent: ReactClass<any>;
  // $FlowIssue -- Flow's object spread operator inference is buggy.
  shouldCacheChildren: ?boolean;
};

type NodeData = {
  isExpanded: boolean;
  cachedChildren: ?ExpansionResult;
};

/**
 * TopLevelValueComponent wraps all expandable value components. It is in charge of keeping track
 * of the set of recursively expanded values. The set is keyed by a "path", which is a string
 * containing the concatenated object keys of all recursive parent object for a given item. This
 * is necessary to preserve the expansion state while the values are temporarily unavailable, such
 * as after stepping in the debugger, which triggers a recursive re-fetch.
 */
class TopLevelLazyNestedValueComponent extends React.Component {
  // $FlowIssue `evaluationResult` gets injected via HOC.
  props: TopLevelValueComponentProps;
  expandedValuePaths: Map<string, NodeData>;
  shouldCacheChildren: boolean;

  constructor(props: TopLevelValueComponentProps) {
    super(props);
    this.expandedValuePaths = new Map();
    (this: any).handleExpansionChange = this.handleExpansionChange.bind(this);
    (this: any).getCachedChildren = this.getCachedChildren.bind(this);
    (this: any).setCachedChildren = this.setCachedChildren.bind(this);
    this.shouldCacheChildren = this.props.shouldCacheChildren == null
      ? false
      : this.props.shouldCacheChildren;
  }

  handleExpansionChange(expandedValuePath: string, isExpanded: boolean): void {
    const nodeData =
      this.expandedValuePaths.get(expandedValuePath) || {isExpanded, cachedChildren: null};
    if (isExpanded) {
      this.expandedValuePaths.set(expandedValuePath, {...nodeData, isExpanded: true});
    } else {
      this.expandedValuePaths.set(expandedValuePath, {...nodeData, isExpanded: false});
    }
  }

  getCachedChildren(path: string): ?ExpansionResult {
    const nodeData = this.expandedValuePaths.get(path);
    if (nodeData == null) {
      return null;
    } else {
      return nodeData.cachedChildren;
    }
  }

  setCachedChildren(path: string, children: ExpansionResult): void {
    const nodeData = this.expandedValuePaths.get(path);
    if (nodeData != null) {
      this.expandedValuePaths.set(path, {...nodeData, cachedChildren: children});
    }
  }

  render(): React.Element<any> {
    return (
      <span className="nuclide-ui-lazy-nested-value">
        <ValueComponent
          {...this.props}
          isRoot={true}
          expandedValuePaths={this.expandedValuePaths}
          onExpandedStateChange={this.handleExpansionChange}
          path="root"
          shouldCacheChildren={this.shouldCacheChildren}
          getCachedChildren={this.getCachedChildren}
          setCachedChildren={this.setCachedChildren}
        />
      </span>
    );
  }
}

function arePropsEqual(
  p1: LazyNestedValueComponentProps,
  p2: LazyNestedValueComponentProps,
): boolean {
  const evaluationResult1 = p1.evaluationResult;
  const evaluationResult2 = p2.evaluationResult;
  if (evaluationResult1 === evaluationResult2) {
    return true;
  }
  if (evaluationResult1 == null || evaluationResult2 == null) {
    return false;
  }
  return (
    evaluationResult1.value === evaluationResult2.value &&
    evaluationResult1._type === evaluationResult2._type &&
    evaluationResult1._description === evaluationResult2._description
  );
}
export const LazyNestedValueComponent = highlightOnUpdate(
  TopLevelLazyNestedValueComponent,
  arePropsEqual,
  undefined, /* custom classname */
  undefined, /* custom delay */
);
