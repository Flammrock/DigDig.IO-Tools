/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BrowserWindow } from 'electron'
import 'common/constants'

export const whenBrowserWindowisReady = (window: BrowserWindow): Promise<void> => {
  return new Promise<void>((resolve) => {
    window.once('ready-to-show', resolve)
  })
}

export const createSplash = () => {
  // Handle when mainWindow is ready to close the splash screen window
  const promises: Array<Promise<unknown>> = []

  // Create the browser splash window.
  const window = new BrowserWindow({
    width: 500,
    height: 300,
    show: false,
    frame: false
  })

  // and load the index.html of the app.
  window.loadURL(SPLASH_WINDOW_WEBPACK_ENTRY)
  window.center()

  promises.push(
    new Promise<void>((resolve) => {
      window.once('ready-to-show', () => {
        window.show()
        setTimeout(function () {
          resolve()
        }, 2000)
      })
    })
  )

  return {
    wait: (promise: Promise<unknown>) => {
      promises.push(promise)
    },
    run: async () => {
      const results = await Promise.all(promises)
      window.close()
      return results
    }
  }
}
