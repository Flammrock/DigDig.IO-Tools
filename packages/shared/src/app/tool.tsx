import type { BrowserWindow } from 'electron'
import { AppRemoteApi } from './remote-api'
import React from 'react'

export abstract class ToolMain {
  public abstract get name(): string
  public abstract mount(window: BrowserWindow, remote: AppRemoteApi): Promise<void>
  public abstract unmount(window: BrowserWindow, remote: AppRemoteApi): Promise<void>
  public abstract is(): Promise<boolean>
}

export abstract class ToolRenderer {
  public abstract get name(): string

  /**
   * This method is called each time the tool is mounted.
   */
  public abstract reset(): void

  /**
   * This method is called each time the tool is being to be rendered.
   */
  public abstract render(): React.ReactNode

  public get icon(): React.ReactNode {
    if (typeof this.name === 'string') return <span>{this.name[0].toUpperCase()}</span>
    return <span>#</span>
  }
}
