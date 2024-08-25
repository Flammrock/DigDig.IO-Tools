/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { hot } from 'react-hot-loader'

import App from './ui/App'
import './index.css'
import './resources/fonts'

const root = createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

export default hot(module)(App)
