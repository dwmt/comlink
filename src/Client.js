import axios from 'axios'
const WebSocket = require('isomorphic-ws')

const Loader = require('@dwmt/loader/lib/Loader')

function generateUUID () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0
    var v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
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
    name: options.name,
    protocol: options.ssl ? 'https://' : 'http://',
    uri: options.uri,
    default: options.default || false,
    rpc: options.rpc || undefined,
    onError: options.onError || function (err) { console.error(err) },
    loader: options.loader || new Loader(),
		logger: options.logger,
		connectable: false
  }
}
function wsStrategy (options) {
  const self = this
  const channel = {
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
    connect: function () {
			return new Promise ((resolve, reject) => {
				if (self._channels[options.name].connection !== null) {
					return resolve()
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
					console.log('Connection established')
					resolve()
				})
				ws.addEventListener('close', () => { self._channels[options.name].alive = false })
				ws.addEventListener('error', () => {
					self._channels[options.name].alive = false
					reject()
				})
	
				if (options.rpc) {
					ws.addEventListener('message', function (msg) {
						try {
							const tr = JSON.parse(msg.data)
							console.log(`Socket message on channel ${opts.name}`, tr)
							if (tr.id) {
								self._channels[options.name].answers[tr.id] = tr.result || { error: tr.error }
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
  constructor () {
    this._axios = axios
    this._ws = WebSocket
    this._dialects = {}
    this._channels = {}
    this._headers = {}
    this._deafultHTTPChannel = null
    this._deafultWSChannel = null
    this._deafultRPCChannel = null
    this._defaultDialect = null
  }

  channel (channelName) {
    if (!this._channels[channelName]) {
      throw new Error(`No channel registered with ${channelName}`)
    }

    const channel = {}

    channel.name = this._channels[channelName].name
		channel.alive = this._channels[channelName].alive
    if (this._channels[channelName].connectable) {
      channel.connection = this._channels[channelName].connection
      channel.connect = this._channels[channelName].connect
    }
    return channel
  }

  registerDialect (_dialect) {
    const dialect = Object.assign({}, _dialect)
    dialect.router = dialect.router || function (route) { return { path: route } }
    dialect.parameter = dialect.parameter || function (data) { return { parameters: data } }
    dialect.optioner = dialect.optioner || function () { return {} }
    this._dialects[dialect.name] = dialect
    if (dialect.default || this._defaultDialect === null) {
      this._defaultDialect = dialect.name
    }
  }

  registerHeader (header) {
		this._headers[header.name] = header
  }

  registerChannel (channel) {
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
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const req = await axios.get(url, options.axios || {})
      return req
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async post (URI, data, options = {}) {
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
		const errorHandler = options.onError || channel.onError
		
    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const req = await axios.post(url, data, options.axios || {})
      return req
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async put (URI, data, options = {}) {
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const req = await axios.put(url, data, options.axios || {})
      return req
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async delete (URI, options = {}) {
    const channelName = options.channel || this._deafultHTTPChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      let url = channel.protocol + channel.uri + '/' + URI
      var pat = /^https?:\/\//i
      if (pat.test(URI)) {
        url = URI
      }
      const req = await axios.delete(url, options.axios || {})
      return req
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  subscribe () {
    throw new Error('Not implemented yet!')
  }

  unsubscribe () {
    throw new Error('Not implemented yet!')
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
      id: ID,
      _dialect: dialect.name,
      _type: type
    }

    const router = dialect.router(path)
    const parameter = dialect.parameter(data)
    const optioner = dialect.optioner(options)

    message = Object.assign({}, message, dialect.interface, router, parameter, optioner)
		if (channel.connection === null) {
			await channel.connect()
		}
    channel.connection.send(JSON.stringify(message))

    const answer = await retry(() => new Promise((resolve, reject) => {
      if (!channel.answers[ID]) {
        return reject(new Error(''))
      }
      return resolve(channel.answers[ID])
    }), rpcConfig.retryInterval, rpcConfig.maxRetries)

    if (answer.error) {
      throw new Error(answer.error)
    }

    return answer
  }

  async request (path, data, options, _dialect) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      if (channel.type === 'http') {
        const url = channel.protocol + channel.uri + '/'
        const req = await axios.post(url, options.axios || {})
        return req
      } else {
        return this._rpc('request', path, data, options, _dialect)
      }
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }

  async inform (path, data, options, _dialect) {
    const channelName = options.channel || this._deafultRPCChannel
    const channel = this._channels[channelName]
    const loader = options.loader || channel.loader
    const errorHandler = options.onError || channel.onError

    const loaderID = loader.work()
    try {
      if (channel.type === 'http') {
        const url = channel.protocol + channel.uri + '/'
        const req = await axios.post(url, options.axios || {})
        return req
      } else {
        return this._rpc('inform', path, data, options, _dialect)
      }
    } catch (err) {
      await errorHandler(err)
      throw err
    } finally {
      loader.terminate(loaderID)
    }
  }
}
