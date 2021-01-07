const axios = require('axios')
import generateUUID from './util/uuid'
const WebSocket = require('isomorphic-ws')

const Loader = require('@dwmt/loader/lib/Loader')

function getLoader (channel, options) {
  let loader = new Loader()
  if (typeof options.loader === 'boolean' && !options.loader) {
    return loader
  }

  if (typeof options.loader === 'undefined') {
    loader = channel.loader
  }

  if(typeof options.loader === 'object' && options.loader.work && options.loader.terminate) {
    loader = options.loader
  }

  return loader
}

const retry = (fn, ms = 1000, maxRetries = 10) => new Promise((resolve, reject) => {
  fn()
    .then(resolve)
    .catch(() => {
      setTimeout(() => {
        if (maxRetries === 0) {
          return reject(new Error('maximum retries exceeded'))
        }
        retry(fn, ms, maxRetries - 1).then(resolve)
      }, ms)
    })
})

function httpStrategy (options) {
  return {
    type: 'http',
    name: options.name,
    protocol: options.ssl ? 'https://' : 'http://',
    uri: options.uri,
    default: options.default || false,
    rpc: options.rpc || undefined,
    onError: options.onError || function (err) { console.error(err) },
    headerHandler: options.headerHandler || async function (headers) { return true },
    loader: options.loader || new Loader(),
    logger: options.logger,
    connectable: false
  }
}
function wsStrategy (options) {
  const self = this
  const channel = {
    type: 'ws',
    name: options.name,
    protocol: options.ssl ? 'wss://' : 'ws://',
    uri: options.uri,
    default: options.default || false,
    auth: options.auth,
    authHeader: options.authHeader,
    rpc: options.rpc,
    onError: options.onError || function (err) { console.error(err) },
    loader: options.loader || new Loader(),
    logger: options.logger,
    connection: null,
    connectable: true,
    alive: false,
    answers: {},
    listeners: {},
    onConnectionOpen : options.onConnectionOpen || function () {},
    onConnectionTermination : options.onConnectionTermination || function () {},
    onConnectionClose : options.onConnectionClose || function () {},
    onConnectionError : options.onConnectionError || function () {},
    callbacks: {
      onConnectionOpen: function () {},
      onConnectionClose: function () {},
      onConnectionError: function () {},
      onConnectionTermination: function () {}
    },
    terminate () {
      self._channels[options.name].connection.close()
      self._channels[options.name].connection = null
      self._channels[options.name].answers = {}
      self._channels[options.name].listeners = {}
      self._channels[options.name].onConnectionTermination()
      self._channels[options.name].callbacks.onConnectionTermination()
    },
    connect () {
      return new Promise ((resolve, reject) => {
        if (self._channels[options.name].connection !== null) {
          return resolve(true)
        }
        const opts = []
        if (options.auth) {
          const headerObject = self.getHeader(options.authHeader)
          opts.push(headerObject.value)
        }
        const ws = new WebSocket(channel.protocol + channel.uri, opts)
        self._channels[options.name].connection = ws
        ws.addEventListener('open', () => {
          self._channels[options.name].alive = true
          self._channels[options.name].onConnectionOpen()
          self._channels[options.name].callbacks.onConnectionOpen()
          resolve(true)
        })
        ws.addEventListener('close', () => {
          self._channels[options.name].alive = false
          self._channels[options.name].onConnectionClose()
          self._channels[options.name].callbacks.onConnectionClose()
        })
        ws.addEventListener('error', (err) => {
          self._channels[options.name].alive = false
          self._channels[options.name].onConnectionError(err)
          self._channels[options.name].callbacks.onConnectionError(err)
          reject(err)
        })

        if (options.rpc) {
          ws.addEventListener('message', function (msg) {
            try {
              const tr = JSON.parse(msg.data)
              if (options.rpc && options.rpc.headerHandler) {
                options.rpc.headerHandler(tr.headers || {})
              }
              if ((tr._type === 'rpcResponse' || tr._type === 'rpcError' || typeof tr._type === 'undefined') && tr.id) {
                if (typeof tr.result !== 'undefined') {
                  self._channels[options.name].answers[tr.id].resolve(tr.result)
                } else {
                  self._channels[options.name].answers[tr.id].reject({ error: tr.error })
                }
              }
              if (tr._type === 'event') {
                let eventSubscribers = self._channels[options.name].listeners[tr.event]
                if (eventSubscribers.length) {
                  for (let subscriber of eventSubscribers) {
                    subscriber(tr.message)
                  }
                }
              }
            } catch (err) {
              console.error(err)
            }
          })
        }
      })
    }
  }
  return channel
}

export default class Client {
  constructor (options = {}) {
    this._axios = axios
    this._ws = WebSocket
    this._dialects = {}
    this._channels = {}
    this._headers = {}
    this._deafultHTTPChannel = null
    this._deafultWSChannel = null
    this._deafultRPCChannel = null
    this._defaultDialect = null

    this._instanceID = generateUUID()

    this._devtools = options.devtools || true
  }

  get channels () {
    let channels = Object.keys(this._channels)
    return channels || []
  }

  disableDevtools () {
    this._devtools = false
  }

  bindDevtools () {
    if (global.window) {
      if (!global.window._COMLINK_DEV_TOOLS) {
        global.window._COMLINK_DEV_TOOLS = {}
      }

      global.window._COMLINK_DEV_TOOLS[this._instanceID] = this
      console.log('[COMLINK] Devtools enabled with instanceID: ' + this._instanceID)
    }
  }

  async connect () {
    let connecting = []
    for(let channelName of Object.keys(this._channels)) {
      let channel = this._channels[channelName]
      if (channel.type === 'ws' && !channel.alive) {
        connecting.push(channel.connect())
      }
    }
    return Promise.all(connecting)
  }

  channel (channelName) {
    if (!this._channels[channelName]) {
      throw new Error(`No channel registered with ${channelName}`)
    }
    let self = this
    const channel = {}

    channel.name = this._channels[channelName].name
    channel.alive = this._channels[channelName].alive
    if (this._channels[channelName].connectable) {
      channel.connection = this._channels[channelName].connection
      channel.connect = this._channels[channelName].connect
      channel.terminate = this._channels[channelName].terminate
    }
    channel.registerCallback = function (callbackName, cb) {
      self._channels[channelName].callbacks[callbackName] = cb
    }
    return channel
  }

  registerDialect (_dialect) {
    const dialect = Object.assign({}, _dialect)
    dialect.router = dialect.router || function (route) { return { path: route } }
    dialect.parameter = dialect.parameter || function (data) { return { parameters: data } }
    dialect.optioner = dialect.optioner || function () { return {} }
    dialect.handler = dialect.handler || function () { return {} }
    this._dialects[dialect.name] = dialect
    if (dialect.default || this._defaultDialect === null) {
      this._defaultDialect = dialect.name
    }
  }

  registerHeader (header) {
    this._headers[header.name] = header
  }

  registerChannel (channel) {
    let availableChannelTypes = ['http', 'ws']
    if (!channel.type in availableChannelTypes ) {
      throw new Error(`[Comlink] Channel type "${channel.type}" is not supported!`)
    }
    if (channel.type === 'http') {
      const chn = httpStrategy.call(this, channel)
      if (chn.default) {
        this._deafultHTTPChannel = chn.name
      }
      if (chn.default && chn.rpc) {
        this._deafultRPCChannel = chn.name
      }
      this._channels[chn.name] = chn
    }
    if (channel.type === 'ws') {
      const chn = wsStrategy.call(this, channel)
      if (chn.default) {
        this._deafultWSChannel = chn.name
      }
      if (chn.default && chn.rpc) {
        this._deafultRPCChannel = chn.name
      }
      this._channels[chn.name] = chn
    }
  }

  get headers () {
    return Object.keys(this._headers)
  }

  checkHeaders () {
    const headers = Object.keys(this._headers)
    headers.forEach((headerKey) => {
      const header = this._headers[headerKey]
      if (header.type === 'automatic') {
        const val = header.storage.getItem(header.key)
        if (val) {
          header.value = val
        }
      }
    })
  }

  getHeader (name) {
    if (!this._headers[name]) {
      throw new Error(`No registered header with name ${name}`)
    }
    return { key: this._headers[name].key, value: this._headers[name].value }
  }

  setHeader (name, value) {
    if (!this._headers[name]) {
      throw new Error(`No registered header with name ${name}`)
    }
    this._headers[name].value = value
    if (this._headers[name].type === 'automatic') {
      this._headers[name].storage.setItem(this._headers[name].key, value)
    }
  }

  async get (URI, options = {}) {
    this.checkDefaultHTTPChannel()
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const resp = await axios.get(url, options.axios || {})
      await channel.headerHandler(resp.headers)
      return resp
    } catch (err) {
      await channel.headerHandler(err.response.headers)
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }
  checkDefaultHTTPChannel () {
    if (!this._deafultHTTPChannel) {
      throw new Error('[Comlink] No default HTTP channel')
    }
  }
  async post (URI, data, options = {}) {
    this.checkDefaultHTTPChannel()
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const resp = await axios.post(url, data, options.axios || {})
      await channel.headerHandler(resp.headers)
      return resp
    } catch (err) {
      await channel.headerHandler(err.response.headers)
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async put (URI, data, options = {}) {
    this.checkDefaultHTTPChannel()
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const resp = await axios.put(url, data, options.axios || {})
      await channel.headerHandler(resp.headers)
      return resp
    } catch (err) {
      await channel.headerHandler(err.response.headers)
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async delete (URI, options = {}) {
    this.checkDefaultHTTPChannel()
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const resp = await axios.delete(url, options.axios || {})
      await channel.headerHandler(resp.headers)
      return resp
    } catch (err) {
      await channel.headerHandler(err.response.headers)
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  subscribeToEvent (event, callback, options = {}) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    if(!channel.listeners[event]) {
      channel.listeners[event] = []
    }
    channel.listeners[event].push(callback)
  }

  unsubscribeFromEvent (event, callback, options = {}) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    if(!channel.listeners[event]) {
      return
    }
    channel.listeners[event] = channel.listeners[event].filter(fn => fn !== callback)
  }

  sendMessage () {
    throw new Error('Not implemented yet!')
  }

  async _rpc (type = 'request', path, data, options, _dialect) {
    const channel = this._channels[options.channel || this._deafultRPCChannel]
    const dialect = this._dialects[_dialect || this._defaultDialect]
    const rpcConfig = channel.rpc

    if (!rpcConfig.dialects.includes(dialect.name)) {
      throw new Error(`The channel ${channel.name} not supports the ${dialect.name} dialect`)
    }

    const channelDialectConfig = rpcConfig[dialect.name] || {}
    const idGenerator = channelDialectConfig.idGenerator || rpcConfig.idGenerator || generateUUID

    const ID = idGenerator()

    let message = {
      id: ID
    }
    const sendMeta = typeof dialect.sendMeta === 'undefined' ? true : dialect.sendMeta
    if (sendMeta) {
      message['_dialect'] = dialect.name
      message['_type'] = type
    }

    const router = dialect.router(path)
    const parameter = dialect.parameter(data)
    const optioner = dialect.optioner(options)

    message = Object.assign({}, message, dialect.interface, router, parameter, optioner)
    if (channel.connection === null) {
      await channel.connect()
    }
    channel.connection.send(JSON.stringify(message))

    const answerPromise = new Promise((resolve, reject) => {
      channel.answers[ID] = { resolve, reject }
    })

    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(`[Comlink] Maximum retries exceeded for message: ${ID}`)
      }, rpcConfig.retryInterval * rpcConfig.maxRetries)
    })

    return Promise.race([answerPromise, timeoutPromise])
  }


  async _rpcHTTP (type = 'request', path, data, options, _dialect) {
    const channel = this._channels[options.channel || this._deafultRPCChannel]
    const dialect = this._dialects[_dialect || this._defaultDialect]
    const rpcConfig = channel.rpc

    if (!dialect.type || dialect.type !== 'http') {
      throw new Error('ComlinkDialect is not supported on HTTPChannel yet!')
    }
    if (dialect.type === 'http' && type !== 'request') {
      throw new Error('HTTPDialect only supports request now!')
    }

    if (!rpcConfig.dialects.includes(dialect.name)) {
      throw new Error(`The channel ${channel.name} not supports the ${dialect.name} dialect`)
    }

    let requestObject = await dialect.handler(path, data, options)
    try {
      let response = await axios(requestObject)
      return response.data
    } catch (err) {
      throw new Error(err.response.data.message)
    }
  }
  async _rpcMethod (type = 'request', path, data, options, _dialect) {
    const channel = this._channels[options.channel || this._deafultRPCChannel]
    const dialect = this._dialects[_dialect || this._defaultDialect]
    const rpcConfig = channel.rpc

    if (!rpcConfig.dialects.includes(dialect.name)) {
      throw new Error(`The channel ${channel.name} not supports the ${dialect.name} dialect`)
    }
    return dialect.handler(path, data, options)
  }
  async request (path, data, options = {}, _dialect) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      if (channel.type === 'http') {
        return await this._rpcHTTP('request', path, data, options, _dialect)
      } else if(channel.type === 'method') {
        return await this._rpcMethod('request', path, data, options, _dialect)
      } else {
        return await this._rpc('request', path, data, options, _dialect)
      }
    } catch (err) {
      await errorHandler(err, options)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async inform (path, data, options = {}, _dialect) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    const loader = getLoader(channel, options)
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      if (channel.type === 'http') {
        return await this._rpc('inform', path, data, options, _dialect)
      } else if(channel.type === 'method') {
        return await this._rpcMethod('inform', path, data, options, _dialect)
      }  else {
        return await this._rpc('inform', path, data, options, _dialect)
      }
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }
}
