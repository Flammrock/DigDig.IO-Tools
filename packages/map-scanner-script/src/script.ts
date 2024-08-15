/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { ChunkAggregator } from 'shared'
import { InformationExtractor, Scanner, ScannerEvent } from 'injection'
import { Client } from './client'

// ╭═────═⌘═────═╮
// | Entry  Point |
// ╰═────═⌘═────═╯
const extractor = InformationExtractor.inject()
const client = new Client()
client.connect()
const aggregator = new ChunkAggregator()
new Scanner(extractor)
  .on(ScannerEvent.ChunkRecieved, (chunk) => {
    aggregator.feed(chunk)
    client.feedChunk(chunk)
  })
  .on(ScannerEvent.PlayerPosition, (position) => {
    client.updatePosition(position)
  })
