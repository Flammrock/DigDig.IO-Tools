/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import React from 'react'
import { MouseButton, PanZoom, ToolRenderer } from 'shared'
import App from './App'
import { name } from '../common/settings'
import { State } from './state'
import ChunkCache from './core/chunk-cache'

class ViewerToolRenderer extends ToolRenderer {
  private state: State

  public constructor() {
    super()
    this.state = {
      // panZoom: new PanZoom({ panMouseButton: MouseButton.Right }),
      cache: new ChunkCache()
    }
  }

  public reset(): void {
    this.state.cache.clear()
    //this.state.panZoom = new PanZoom({ panMouseButton: MouseButton.Right })
  }

  public override render() {
    return <App state={this.state} />
  }

  public get name(): string {
    return name
  }
}

export const toolRenderer = new ViewerToolRenderer()
