import generateUUID from './util/uuid'
const {EventEmitter} = require('events')

export default class Server {
  constructor () {
    this._dialects = {}
    this._channels = {}
    this._clients = {}
    this.session = {}
    this.eventEmitter = new EventEmitter()
  }

  registerDialect (_dialect) {
    this._dialects[_dialect.name] = _dialect
  }

  registerChannel (_channel) {
    if (_channel.auth && !_channel.tokenValidator) {
      throw new Error('For authentication you need a token validator')
    }
    if (_channel.type !== 'ws') {
      throw new Error('Only websocket listeners implemented yet!')
    }
    this._channels[_channel.name] = _channel
  }

  sendMessageToClient (clientID, event, message) {
    if (!this.session[clientID]) {
      throw new Error('No user with given clientID')
    }
    this.eventEmitter.emit(`sendEventTo:${clientID}`, {
      _type: 'event',
      event,
      message
    })
  }

  getCLientIDByToken (token) {
    let sessions = Object.keys(this.session)
    let clientID = false
    for(let id of sessions) {
      if (this.session[id].token === token) {
        clientID = id
        break
      }
    }
    if (!clientID) {
      throw new Error('No user with given token')
    }
    console.log('ClientID: ', clientID)
    return clientID
  }

  applyChannel (channelName, wss) {
    const channel = this._channels[channelName]
    if (!channel) {
      throw new Error(`Channel with name ${channelName} is not registered!`)
    }
    wss.on('connection', async (ws, req) => {
      let clientID = generateUUID()
      this.session[clientID] = {}
      if (channel.auth) {
        console.log('Authenticating ws connection')
        if (!req.headers['sec-websocket-protocol'] || req.headers['sec-websocket-protocol'].length === 0) {
          return ws.close()
        }
        let check = channel.tokenValidator(req.headers['sec-websocket-protocol'])
        if (!check) {
          return ws.close()
        }
        this.session[clientID].token = req.headers['sec-websocket-protocol']
        ws.id = clientID
      }
      this.eventEmitter.on(`sendEventTo:${clientID}`, (msg) => {
        console.log('Event:', `sendEventTo:${clientID}`, msg)
        ws.send(JSON.stringify(msg))
      })
      ws.on('message', async (message) => {
        console.log('Incoming message from client: ' + ws.id)
        const parsed = JSON.parse(message)
        const dialect = parsed._dialect
        if (!dialect) {
          return
        }
        const id = parsed.id
        const channelDialect = this._channels[channelName].dialects.includes(dialect)
        if (!channelDialect) {
          ws.send(JSON.stringify({
            _type: 'rpcError',
            id,
            error: `The used dialect ${dialect} is not supported on this channel`
          }))
        }
        let headers = {}
        if (channel.headerInjector) {
          try {
            let h = await channel.headerInjector(this.session[ws.id])
            headers = Object.assign({}, h)
          } catch (err) {
            return ws.send(JSON.stringify({
              _type: 'rpcError',
              id,
              error: err.message,
              headers: Object.assign({}, headers, {
                serverTime: Date.now()
              })
            }))
          }
        }
        try {
          const returnValue = await this._dialects[dialect].onRequest(parsed)
          ws.send(JSON.stringify({
            _type: 'rpcResponse',
            id,
            result: returnValue,
            headers: Object.assign({}, headers, {
              serverTime: Date.now()
            })
          }))
        } catch (err) {
          ws.send(JSON.stringify({
            _type: 'rpcError',
            id,
            error: err.message,
            headers: Object.assign({}, headers, {
              serverTime: Date.now()
            })
          }))
        }
      })
    })
  }
}
