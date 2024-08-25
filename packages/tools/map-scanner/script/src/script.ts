/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { BaseScript, ChunkAggregator } from 'shared'
import { InformationExtractor, Scanner, ScannerEvent } from 'injection'
import { Client } from './client'

// ╭═────═⌘═────═╮
// | Entry  Point |
// ╰═────═⌘═────═╯
export class Script extends BaseScript {
  public override run(): void {
    const extractor = InformationExtractor.inject()
    const client = new Client()
    const aggregator = new ChunkAggregator()
    new Scanner(extractor)
      .on(ScannerEvent.ChunkRecieved, (chunk) => {
        aggregator.feed(chunk)
        client.feedChunk(chunk)
      })
      .on(ScannerEvent.PlayerPosition, (position) => {
        client.updatePosition(position)
      })
  }
}

export default Script
