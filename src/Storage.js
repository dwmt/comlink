import Cookies from 'js-cookie'

function Storage () {}
Storage.prototype.getItem = function (key) { console.error('getItem not implemented') }
Storage.prototype.setItem = function (key, value, options) { console.error('setItem not implemented') }
Storage.prototype.removeItem = function (key, options) { console.error('removeItem not implemented') }
Storage.prototype.clear = function () { console.error('clear not implemented') }

function CookieStorage () {
  this._cookie = Cookies
}
CookieStorage.prototype = Storage.prototype

CookieStorage.prototype.getItem = function (key) {
  return this._cookie.get(key)
}

CookieStorage.prototype.setItem = function (key, value, options) {
  return this._cookie.set(key, value, options)
}

CookieStorage.prototype.removeItem = function (key, options) {
  return this._cookie.remove(key, options)
}

const LocalStorage = typeof window !== 'undefined' ? window.localStorage : Storage
const SessionStorage = typeof window !== 'undefined' ? window.sessionStorage : Storage

export default {
  LocalStorage,
  SessionStorage,
  CookieStorage: new CookieStorage()
}
