import { ChannelClient, ChannelClientEventType } from 'shared'
import Client from './client'

export class ClientManager {
  private clients: Record<string, Client> = {}
  public add(cc: ChannelClient): Client {
    if (typeof this.clients[cc.id] !== 'undefined') return this.clients[cc.id]
    this.clients[cc.id] = new Client(cc)
    const handleClose = () => {
      cc.off(ChannelClientEventType.Close, handleClose)
      this.remove(cc)
    }
    cc.on(ChannelClientEventType.Close, handleClose)
    return this.clients[cc.id]
  }
  public remove(cc: ChannelClient): void {
    delete this.clients[cc.id]
  }
  public list(): Array<Client> {
    return Object.values(this.clients)
  }
}
