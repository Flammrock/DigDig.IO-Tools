/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { Client } from './client'

/**
 *
 */
export class ClientManager {
  private clients: Record<string, Client>

  public constructor() {
    this.clients = {}
  }

  public add(client: Client) {
    this.clients[client.id] = client
  }

  public remove(client: Client) {
    delete this.clients[client.id]
  }

  public has(client: Client): boolean {
    return typeof this.clients[client.id] !== 'undefined'
  }

  public list(): Array<Client> {
    return Object.values(this.clients)
  }
}

export default ClientManager
