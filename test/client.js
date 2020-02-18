const CL = require('@dwmt/comlink')

const api = new CL.CLient({})

api.registerDialect({
  name: 'CM',
  interface: {
    namespace: '',
    method: '',
    parameters: ''
  }
})

api.registerDialect({
  name: 'pm',
  interface: {
    method: '',
    parameters: ''
  }
})

api.registerDialect({
  name: 'pm',
  interface: {
    pluginName: '',
    method: '',
    parameters: ''
  },
  router (route) {
    const routeParams = route.explode('.')
    return {
      pluginName: routeParams[0],
      method: routeParams[1]
    }
  }
})

api.registerDialect({
  name: 'harcon',
  interface: {
    division: '',
    event: '',
    parameters: ''
  },
  router (route) {
    return {
      event: route
    }
  },
  optioner (options) {
    if (options.division) {
      return {
        division: options.division
      }
    }
    return {}
  }
})

api.registerChannel({
  type: 'http',
  ssl: true,
  uri: 'localhost:7777/api',
  default: true,
  rpc: false,
  name: 'rest'
})

api.registerHeader({
  name: 'jwtToken',
  type: 'automatic',
  storage: Storage.CookieStorage,
  key: 'x-jwt-token',
  inject: false
})

api.registerChannel({
  type: 'ws',
  name: 'socket',
  ssl: true,
  uri: 'localhost:67897',
  default: true,
  auth: true,
  authHeader: 'jwtToken',
  rpc: {
    retryInterval: 800,
    maxRetries: 10,
    dialects: ['CM', 'harcon', 'pm', 'plugin'],
    idGenerator: undefined,
    harcon: {
      idGenerator: undefined,
      division: 'Harconer'
    }
  },
  onError (err) { console.error(err) }
})

api.channel('socket').connect()

api.request(route, data, options, _dialect)

api.request('User.login', { email, password }, { division: 'Harconer', loader: ButtonLoader, errorHandler: false })

api.request('Finance.getTransactions', [{}], { channel: 'socket' }, 'plugin')
