'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {HandlesByType} from '../../types';

import {React} from 'react-for-atom';

type Props = {
  cpuPercentage: number;
  memory: number;
  heapPercentage: number;
  lastKeyLatency: number;
  activeHandles: number;
  activeRequests: number;
  activeHandlesByType: HandlesByType;
};

export default class BasicStatsSectionComponent extends React.Component {
  props: Props;

  render(): React.Element<any> {
    const stats = [
      {
        name: 'CPU',
        value: `${this.props.cpuPercentage.toFixed(0)}%`,
      }, {
        name: 'Heap',
        value: `${this.props.heapPercentage.toFixed(1)}%`,
      }, {
        name: 'Memory',
        value: `${Math.floor(this.props.memory / 1024 / 1024)}MB`,
      }, {
        name: 'Key latency',
        value: `${this.props.lastKeyLatency}ms`,
      }, {
        name: 'Handles',
        value: `${this.props.activeHandles}`,
      }, {
        name: 'Child processes',
        value: `${this.props.activeHandlesByType.childprocess.length}`,
      }, {
        name: 'Event loop',
        value: `${this.props.activeRequests}`,
      },
    ];

    return (
      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat, s) =>
            <tr key={s}>
              <th>{stat.name}</th>
              <td>{stat.value}</td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
}
