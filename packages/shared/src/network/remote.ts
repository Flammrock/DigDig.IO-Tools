import { useEffect, useMemo } from 'react'
import Buffer, { BufferLike } from '../core/buffer'
import EventEmitter, { EventCallbacks } from '../core/event-emitter'
import { TimeSpan } from '../core/timespan'
import { MD5 } from '../hash/md5'
import { Nullable } from '../utils/helpers'
import { port } from './bridge'
import { RefCounter } from '../core/ref-counter'

// TODO: refactor

export interface ChannelClient extends EventEmitter<ChannelClientEventCallbacks> {
  get id(): string
  send(message: ArrayBuffer): void
  close(): void
}

export interface ChannelClientManager extends EventEmitter<ChannelClientManagerEventCallbacks> {}

export enum ChannelClientEventType {
  Message,
  Close
}

export interface ChannelClientEventCallbacks extends EventCallbacks {
  [ChannelClientEventType.Message]: (message: ArrayBuffer) => void
  [ChannelClientEventType.Close]: () => void
}

class ChannelClientInternal extends EventEmitter<ChannelClientEventCallbacks> implements ChannelClient {
  public constructor(
    private identifier: ChannelIdentifier,
    public id: string
  ) {
    super()
  }
  public initiateHandshake(): void {
    const channelMessage = new Uint8Array(1 + this.identifier.length)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.InitiateHandshake
    wss.send(this.id, channelMessage)
  }
  public resolveHandshake(): void {
    const channelMessage = new Uint8Array(1 + this.identifier.length)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.ResolveHandshake
    wss.send(this.id, channelMessage)
  }
  public send(message: ArrayBuffer): void {
    const channelMessage = new Uint8Array(1 + this.identifier.length + message.byteLength)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.Message
    channelMessage.set(new Uint8Array(message), this.identifier.length + 1)
    wss.send(this.id, channelMessage)
  }
  public forwardMessage(channelMessage: ArrayBuffer): void {
    this.fire(ChannelClientEventType.Message, channelMessage)
  }
  public close(): void {
    const channelMessage = new Uint8Array(1 + this.identifier.length)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.Close
    wss.send(this.id, channelMessage)
    // Note: Use wss.close(id) to close definitively the socket
    // But this method should be use to disconnect from the channel not the server
    this.fire(ChannelClientEventType.Close)
  }
}

export enum ChannelClientManagerEventType {
  InComing
}

export interface ChannelClientManagerEventCallbacks extends EventCallbacks {
  [ChannelClientManagerEventType.InComing]: (cc: ChannelClient) => void
}

export class ChannelClientInternalManager
  extends EventEmitter<ChannelClientManagerEventCallbacks>
  implements ChannelClientManager
{
  private clients: Record<string, ChannelClientInternal>
  private identifier: ChannelIdentifier
  public getIdentifier(): ChannelIdentifier {
    return this.identifier
  }
  public constructor(channelName: string) {
    super()
    this.clients = {}
    this.identifier = Channel.computeIdentifier(channelName)
  }
  public add(id: string): void {
    if (this.clients[id]) return
    this.clients[id] = new ChannelClientInternal(this.identifier, id)
    this.fire(ChannelClientManagerEventType.InComing, this.clients[id])
  }
  public remove(id: string): void {
    if (!this.clients[id]) return
    this.clients[id].fire(ChannelClientEventType.Close)
    delete this.clients[id]
  }
  public get(id: string): Nullable<ChannelClient> {
    return this.clients[id] ?? null
  }
  public has(id: string): boolean {
    return typeof this.clients[id] !== 'undefined'
  }
  public forward(id: string, channelMessage: ArrayBuffer): void {
    const cc = this.clients[id]
    if (!cc) return
    cc.forwardMessage(channelMessage)
  }
  public clear(): void {
    for (const id in this.clients) {
      this.clients[id].close()
    }
    this.clients = {}
  }
  public notifyAll(ids: Array<string>): void {
    ids.forEach((id) => !this.has(id) && new ChannelClientInternal(this.identifier, id).initiateHandshake())
  }
}

class ChannelManagerStore {
  public static instance: ChannelManagerStore
  private managers: Record<string, RefCounter<ChannelClientInternalManager>>
  private constructor() {
    this.managers = {}
  }
  public get(channelName: string): ChannelClientInternalManager {
    if (!this.has(channelName)) return this.create(channelName)
    return this.increment(channelName)
  }
  public release(channelName: string): void {
    const manager = this.decrement(channelName)
    if (this.managers[channelName].isUse()) return
    manager.clear()
    manager.offAll()
    delete this.managers[channelName]
  }
  public has(channelName: string): boolean {
    return typeof this.managers[channelName] !== 'undefined'
  }
  private create(channelName: string): ChannelClientInternalManager {
    this.managers[channelName] = new RefCounter(new ChannelClientInternalManager(channelName)).increment()
    return this.managers[channelName].item
  }
  private increment(channelName: string): ChannelClientInternalManager {
    return this.managers[channelName].increment().item
  }
  private decrement(channelName: string): ChannelClientInternalManager {
    return this.managers[channelName].decrement().item
  }
  public static getInstance(): ChannelManagerStore {
    if (!this.instance) this.instance = new ChannelManagerStore()
    return this.instance
  }
}

/**
 * Use this to be connected to the remote injected script
 * (from a ToolRenderer)
 */
export const useChannel = (channelName: string): ChannelClientManager => {
  const manager = useMemo(() => {
    return ChannelManagerStore.getInstance().get(channelName)
  }, [channelName])

  useEffect(() => {
    let isListening = false
    let isDestroyed = false

    const handleMessage = (id: string, message: ArrayBuffer): void => {
      const channelMessage = Channel.tryExtract(manager.getIdentifier(), message)
      if (!channelMessage) return // cancel if the message is not for this channel
      if (channelMessage.byteLength === 0) return // might never happen

      // extract the channel code (act as an opcode to understand the
      // type of the message that might follow)
      const channelCode = new Uint8Array(channelMessage)[0] as ChannelCode

      // process the message
      switch (channelCode) {
        case ChannelCode.ResolveHandshake: // happen when the handshake is triggered by the channel itself
          return manager.add(id) // must send a InComing event
        case ChannelCode.InitiateHandshake:
          new ChannelClientInternal(manager.getIdentifier(), id).resolveHandshake()
          return manager.add(id) // must send a InComing event
        case ChannelCode.Message:
          return manager.forward(id, channelMessage.slice(1)) // must send a Message event
        case ChannelCode.Close:
          return manager.remove(id) // must send a Close event
      }
    }

    /**
     * Occurs when the socket is completely disconnected from the server
     * If it happen, this means that the socket is also disconnected
     * from the channel and must send a Close event
     *
     * **Warning**: this must not send a Close event if a InComing event for
     *              that socket was never triggered.
     *              But because the manager contains only already-handshaked clients,
     *              It means that the InComing event was triggered for these clients.
     *              So we can safely remove the client and trigger a Close event.
     */
    const handleDisconnection = (id: string) => {
      manager.remove(id) // must send a Close event
    }

    // because this hook can be runned at anytime
    // we fetch the already connected client that might wait
    // for a handshake to connect
    wss.getAll().then((ids) => {
      if (isDestroyed) return
      isListening = true

      // notify clients that the channel is opened
      // clients interested for this channel will resolve the handshake
      manager.notifyAll(ids)

      // then start listening for new handshake or for disconnection
      wss.message(handleMessage)
      wss.disconnection(handleDisconnection)
    })

    return () => {
      // we always get the channel manager (from the useMemo)
      // so we need to always release it too
      ChannelManagerStore.getInstance().release(channelName)

      isDestroyed = true
      if (!isListening) return
      wss.removeMessage(handleMessage)
      wss.removeDisconnection(handleDisconnection)
    }
  }, [manager])

  return manager
}

export enum ConnectionEventType {
  Open,
  Close,
  Message,
  Error
}

export enum ChannelState {
  Unknown,
  Opening,
  Handshaking,
  Opened,
  Closed
}

export enum ConnectionState {
  Unknown,
  Opening,
  Opened,
  Closed
}

export interface ConnectionEventCallbacks extends EventCallbacks {
  [ConnectionEventType.Open]: () => void
  [ConnectionEventType.Close]: (reason: string) => void
  [ConnectionEventType.Message]: (message: ArrayBuffer) => void
  [ConnectionEventType.Error]: (error: unknown) => void
}

export type ChannelIdentifier = Array<number>

export enum ChannelCode {
  InitiateHandshake,
  ResolveHandshake,
  Message,
  Close
}

export class Channel extends EventEmitter<ConnectionEventCallbacks> {
  private identifier: ChannelIdentifier
  private state: ChannelState

  private handleOpen: () => void
  private handleClose: (reason: string) => void
  private handleMessage: (message: ArrayBuffer) => void
  private handleError: (error: unknown) => void

  public constructor(
    public readonly name: string,
    private connection: Connection
  ) {
    super()
    this.identifier = Channel.computeIdentifier(this.name)
    this.state = ChannelState.Unknown
    this.handleOpen = () => {
      if (this.state === ChannelState.Opening) this.state = ChannelState.Handshaking
      console.log('SERVER OPEN')
      this.initiateHandshake()
    }
    this.handleClose = (reason) => {
      console.log('SERVER CLOSE')
      this.state = ChannelState.Opening // if main connection is closed, wait for a new attempt
      this.fire(ConnectionEventType.Close, reason)
    }
    this.handleMessage = (message) => {
      const channelMessage = Channel.tryExtract(this.identifier, message)
      if (!channelMessage) return
      if (channelMessage.byteLength === 0) return
      const channelCode = new Uint8Array(channelMessage)[0]
      switch (channelCode) {
        case ChannelCode.ResolveHandshake:
          return this.resolveHandshake()
        case ChannelCode.InitiateHandshake:
          // happen where the request handshake is initiated by the server itself
          // so if this channel is not opened yet but wait for open
          // resolve the server handshake (this will accept the handshake request
          // issued by the server)
          return this.handleRemoteHandshake()
        case ChannelCode.Message:
          // the server send us a message so trigger the Message event
          return this.isOpened() && this.fire(ConnectionEventType.Message, channelMessage.slice(1))
        case ChannelCode.Close:
          // close by the server (so we wait for the server to re-open)
          console.log('CHANNEL CLOSE')
          this.state = ChannelState.Opening
          this.fire(ConnectionEventType.Close, 'Close by the server')
          return
      }
    }
    this.handleError = (error) => this.fire(ConnectionEventType.Error, error)
  }

  public connect(): this {
    this.unlisten()
    this.state = ChannelState.Opening
    this.listen()
    this.state = this.connection.getState() === ConnectionState.Opened ? ChannelState.Handshaking : ChannelState.Opening
    if (this.state === ChannelState.Handshaking) this.initiateHandshake()
    return this
  }

  public close(): void {
    this.state = ChannelState.Closed
    this.unlisten()
    this.fire(ConnectionEventType.Close, 'Closed by user.')
  }

  private initiateHandshake(): void {
    console.log('INITIATE THE HANDSHAKE')
    this.state = ChannelState.Handshaking
    const channelMessage = new Uint8Array(1 + this.identifier.length)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.InitiateHandshake
    this.connection.send(channelMessage.buffer)
  }

  private resolveHandshake(): void {
    console.log('FINISH THE HANDSHAKE')
    if (this.state !== ChannelState.Handshaking) return
    if (this.connection.getState() !== ConnectionState.Opened) {
      // the Open event will be triggered soon and
      // this will start a now handshake process
      console.log('SERVER DISCONNECTED WAIT FOR SERVER TO OPEN')
      this.state = ChannelState.Opening
      return
    }
    // The handshake process is a success so
    // we can start to read/write on this channel
    console.log('NOW CONNECTED TO CHANNEL')
    this.state = ChannelState.Opened
  }

  private handleRemoteHandshake(): void {
    console.log('SERVER HAVE SENT HANDSHAKE')
    // only accept the handshake if this channel is gonna to be opened
    if (this.state === ChannelState.Closed || this.state === ChannelState.Unknown) return

    console.log('WE ACCEPT SERVER HANDSHAKE')

    // then resolve the handshake (so the server will known that we accept)
    const channelMessage = new Uint8Array(1 + this.identifier.length)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.ResolveHandshake
    this.connection.send(channelMessage.buffer)

    console.log('NOW CONNECTED TO CHANNEL')
    // we assume that the handshake is resolved and the channel is ready to be used
    this.state = ChannelState.Opened
  }

  private listen(): void {
    this.connection.on(ConnectionEventType.Open, this.handleOpen)
    this.connection.on(ConnectionEventType.Close, this.handleClose)
    this.connection.on(ConnectionEventType.Message, this.handleMessage)
    this.connection.on(ConnectionEventType.Error, this.handleError)
  }

  private unlisten(): void {
    this.connection.off(ConnectionEventType.Open, this.handleOpen)
    this.connection.off(ConnectionEventType.Close, this.handleClose)
    this.connection.off(ConnectionEventType.Message, this.handleMessage)
    this.connection.off(ConnectionEventType.Error, this.handleError)
  }

  public isOpened(): boolean {
    return this.state === ChannelState.Opened
  }

  public send(message: BufferLike): void {
    if (!this.isOpened())
      throw new Error(
        'You cannot send a message on a closed/opening channel. Use channel.open() to open the channel first or use channel.isOpened() to check.'
      )
    const buffer = message instanceof Buffer ? message.getArrayBuffer() : message
    const channelMessage = new Uint8Array(1 + this.identifier.length + buffer.byteLength)
    channelMessage.set(this.identifier, 0)
    channelMessage[this.identifier.length] = ChannelCode.Message
    channelMessage.set(new Uint8Array(buffer), this.identifier.length + 1)
    this.connection.send(channelMessage.buffer)
  }

  public static computeIdentifier(channelName: string): ChannelIdentifier {
    return MD5.hash(channelName).toArray()
  }

  public static check(identifier: ChannelIdentifier, message: ArrayBuffer): boolean {
    const bytes = new Uint8Array(message)
    if (message.byteLength < identifier.length) return false
    for (let i = 0; i < identifier.length; i++) {
      if (identifier[i] !== bytes[i]) return false
    }
    return true
  }

  public static tryExtract(identifier: ChannelIdentifier, message: ArrayBuffer): Nullable<ArrayBuffer> {
    if (!Channel.check(identifier, message)) return null
    return message.slice(identifier.length)
  }
}

function canSendTo(socket: Nullable<WebSocket>): socket is WebSocket {
  return socket !== null && socket.readyState === WebSocket.OPEN
}

/**
 * Use this to be connected to the remote app
 * (from an injected script)
 */
export class Connection extends EventEmitter<ConnectionEventCallbacks> {
  private static instance: Connection

  private socket: Nullable<WebSocket>
  private reconnectDelay: TimeSpan
  private state: ConnectionState

  private queue: Array<ArrayBuffer>

  private constructor() {
    super()
    this.reconnectDelay = TimeSpan.fromSeconds(5)
    this.socket = null
    this.queue = []
    this.state = ConnectionState.Unknown
    this.connect()
  }

  private connect() {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`)
    this.socket.binaryType = 'arraybuffer'
    this.state = ConnectionState.Opening
    this.socket.onopen = () => {
      this.state = ConnectionState.Opened
      this.tryToClearQueuedMessages()
      this.dispatcher.emit(ConnectionEventType.Open)
    }
    this.socket.onclose = (e) => {
      this.state = ConnectionState.Closed
      this.dispatcher.emit(ConnectionEventType.Close, e.reason)
      setTimeout(() => this.connect(), this.reconnectDelay.totalMilliseconds())
    }
    this.socket.onmessage = (e) => this.dispatcher.emit(ConnectionEventType.Message, e.data)
    this.socket.onerror = (e) => this.dispatcher.emit(ConnectionEventType.Error, e)
  }

  private tryToClearQueuedMessages(): void {
    if (!canSendTo(this.socket)) return
    while (this.queue.length) {
      const message = this.queue.shift()
      if (typeof message === 'undefined') continue
      try {
        this.socket.send(message)
      } catch (e) {
        this.queue.unshift(message)
        break // The connection might be instable or lost so break and wait for a new connection
      }
    }
  }

  public getState(): ConnectionState {
    return this.state
  }

  public send(message: ArrayBuffer): void {
    if (!canSendTo(this.socket)) {
      this.queue.push(message)
      return
    }
    this.tryToClearQueuedMessages()
    try {
      this.socket.send(message)
    } catch (e) {
      this.queue.push(message)
    }
  }

  public static createChannel(channelName: string): Channel {
    if (!this.instance) this.instance = new Connection()
    return new Channel(channelName, this.instance)
  }
}
