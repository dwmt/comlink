export default class Server {
  constructor () {
    this._dialects = {}
    this._channels = {}
    this._clients = {}
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

  applyChannel (channelName, wss) {
    const channel = this._channels[channelName]
    if (!channel) {
      throw new Error(`Channel with name ${channelName} is not registered!`)
    }
    wss.on('connection', async (ws, req) => {
      if (channel.auth) {
        console.log('Authenticating ws connection')
        if (!req.headers['sec-websocket-protocol'] || req.headers['sec-websocket-protocol'].length === 0) {
          return ws.close()
        }
        let check = channel.tokenValidator(req.headers['sec-websocket-protocol'])
        if (!check) {
          return ws.close()
        }
      }
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
            id,
            error: `The used dialect ${dialect} is not supported on this channel`
          }))
        }
        try {
          const returnValue = await this._dialects[dialect].onRequest(parsed)
          ws.send(JSON.stringify({
            id,
            result: returnValue
          }))
        } catch (err) {
          ws.send(JSON.stringify({
            id,
            error: err.message
          }))
        }
      })
    })
  }
}
