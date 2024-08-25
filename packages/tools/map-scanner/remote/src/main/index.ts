/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BrowserWindow } from 'electron'
import { AppRemoteApi, Nullable, ToolMain } from 'shared'
import { name } from '../common/settings'

class ViewerToolMain extends ToolMain {
  private isMounted = false
  public get name(): string {
    return name
  }
  public override async mount(window: BrowserWindow, remote: AppRemoteApi): Promise<void> {
    this.isMounted = true
  }
  public override async unmount(): Promise<void> {
    this.isMounted = false
  }
  public override async is(): Promise<boolean> {
    return this.isMounted
  }
}

export const toolMain = new ViewerToolMain()
