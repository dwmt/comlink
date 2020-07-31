import generateUUID from './util/uuid'
const {EventEmitter} = require('events')

export default class Server {
  constructor (logger) {
    this._dialects = {}
    this._channels = {}
    this._clients = {}
    this.session = {}
    this.eventEmitter = new EventEmitter()
    this.logger = logger || console
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
    this.session[_channel.name] = {
      clients: {},
      tokens: {}
    }
  }

  sendMessageToClient (channelName, clientID, event, message) {
    if (!this.session[channelName].clients[clientID]) {
      throw new Error('No user with given clientID')
    }
    this.eventEmitter.emit(`sendEventTo:${clientID}`, {
      _type: 'event',
      event,
      message
    })
  }

  getClientIDByToken (channelName, token) {
    let clientID = this.session[channelName].tokens[token].client
    if (!clientID) {
      throw new Error('No user with given token')
    }
    return clientID
  }
  getTokenByClientID (channelName, clientID) {
    let token = this.session[channelName].clients[clientID].token
    if (!token) {
      throw new Error('No user with given clientID')
    }
    return token
  }

  isTokenActive (channelName, token) {
    let clientID = this.session[channelName].tokens[token].client
    return !!clientID
  }

  isClientActive (channelName, clientID) {
    let token = this.session[channelName].clients[clientID].token
    return !!token
  }

  applyChannel (channelName, wss) {
    const channel = this._channels[channelName]
    if (!channel) {
      throw new Error(`Channel with name ${channelName} is not registered!`)
    }
    wss.on('connection', async (ws, req) => {
      let clientID = generateUUID()
      this.session[channelName].clients[clientID] = {}
      if (channel.auth) {
        const token = req.headers['sec-websocket-protocol']
        if (!token || token.length === 0) {
          return ws.close()
        }
        let check = await channel.tokenValidator(token)
        if (!check) {
          return ws.close()
        }
        this.session[channelName].clients[clientID].token = token
        this.session[channelName].tokens[token] = { client: clientID }
        ws.id = clientID
      }
      this.eventEmitter.on(`sendEventTo:${clientID}`, (msg) => {
        ws.send(JSON.stringify(msg))
      })
      ws.on('close', async () => {
        let token = this.session[channelName].clients[ws.id].token
        delete this.session[channelName].clients[ws.id]
        delete this.session[channelName].tokens[token]
      })
      ws.on('message', async (message) => {
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
            let h = await channel.headerInjector(this.session[channelName].clients[ws.id].token)
            headers = Object.assign({}, h)
          } catch (err) {
            ws.send(JSON.stringify({
              _type: 'rpcError',
              id,
              error: err.message,
              headers: Object.assign({}, headers, {
                serverTime: Date.now()
              })
            }))
            throw err
            return
          }
        }
        let ctx = {}
        ctx.token = this.session[channelName].clients[ws.id].token
        ctx.clientID = ws.id
        try {
          const returnValue = await this._dialects[dialect].onRequest(parsed, ctx)
          if (parsed._type === 'request') {
            ws.send(JSON.stringify({
              _type: 'rpcResponse',
              id,
              result: returnValue,
              headers: Object.assign({}, headers, {
                serverTime: Date.now()
              })
            }))
          }
        } catch (err) {
          ws.send(JSON.stringify({
            _type: 'rpcError',
            id,
            error: err.message,
            headers: Object.assign({}, headers, {
              serverTime: Date.now()
            })
          }))
          throw err
        }
      })
    })
  }
}
