/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { app, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import path from 'path'

import './common/constants'
import { registerElectronHandlers } from './main/ipc/electron'
import { registerMainHandlers } from './main/ipc/main'
import { createSplash, whenBrowserWindowisReady } from './main/splash'
import { registerTool, registerToolHandlers } from './main/ipc/tool'
import { createWebSocketServer } from './main/network/websocket'
import { port } from 'shared'
// import { MenuCallbackChannel } from './bridge/channel'
// import { MenuEventCallbacks } from './bridge/api'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

// https://www.electronjs.org/docs/latest/tutorial/performance
// https://github.com/electron/electron/issues/35512
Menu.setApplicationMenu(null)

const createWindow = async (): Promise<void> => {
  // Create the browser window.
  const window = new BrowserWindow({
    height: 600,
    width: 800,
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true
    },
    icon: path.resolve(__dirname, 'src', 'icons', 'icon.png')
  })

  // and load the index.html of the app.
  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY)

  // Create a splash screen
  const splash = createSplash()

  // We wait for the mainWindow to be ready
  splash.wait(whenBrowserWindowisReady(window))

  // Then we run the splash screen (it will wait until all is ready)
  await splash.run()

  /*const sendMenuEvent = <T extends MenuCallbackChannel>(
    channel: T,
    window: BrowserWindow,
    ...args: Parameters<MenuEventCallbacks[StripPrefix<T, 'menu.'>]>
  ): void => {
    window?.webContents.send(channel, ...args)
  }*/

  registerToolHandlers()

  // Register tools here (TODO: automatisation of this to register all tools)
  registerTool((await import('map-scanner-remote')).toolMain)

  createWebSocketServer({ window, port })

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'New',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              //sendMenuEvent('menu.click', window, { name: 'new' })
            }
          },
          {
            label: 'Open',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              //sendMenuEvent('menu.click', window, { name: 'open' })
            }
          },
          {
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            click: () => {
              //sendMenuEvent('menu.click', window, { name: 'save' })
            }
          },
          {
            label: 'Save as...',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => {
              //sendMenuEvent('menu.click', window, { name: 'save-as' })
            }
          }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Show controls',
            click: () => {
              //sendMenuEvent('menu.click', window, { name: 'show-controls' })
            }
          }
        ]
      }
    ])
  )
  window.center()
  window.show()

  // Open the DevTools.
  if (process.env.NODE_ENV === 'development') {
    window.webContents.openDevTools()
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  registerElectronHandlers()
  registerMainHandlers()
  createWindow()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
process.on('uncaughtException', (error) => {
  console.log('Uncaught Exception:', error)
})
