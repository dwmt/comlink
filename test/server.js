
const CL = require('@dwmt/comlink')

const api = new CL.Server({})

api.registerDialect({
  name: 'CM',
  interface: {
    namespace: '',
    method: '',
    parameters: ''
  },
  async onRequest (msg) {
    const type = msg._type
  }
})

api.channelListener({
  type: 'ws',
  name: 'tunnel',
  dialects: ['CM'],
  auth: true,
  tokenValidator (token) {
    return token[token] && token[token].expiry < Date.now()
  }
})

api.applyChannelListener('tunnel', ws)

function applyChannelListener (channelListenerName, wsInstance) {
  wsInstance.on('connection', (ws, req) => {
    ws.on('message', async (message) => {
      const parsed = JSON.parse(message)
      const dialect = parsed._dialect
      if (!dialect) {
        return
      }
      const id = parsed.id
      const channelDialect = this.channelListeners[channelListenerName][dialect]
      if (!channelDialect) {
        ws.send(JSON.stringify({
          id,
          error: `The used dialect ${dialect} is not supported on this channel`
        }))
      }
      try {
        const returnValue = await channelDialect.onRequest(parsed)
        ws.send(JSON.stringify({
          id,
          result: returnValue
        }))
      } catch (err) {
        ws.send(JSON.stringify({
          id,
          error: err
        }))
      }
    })
  })
}
