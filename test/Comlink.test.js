const chai = require('chai')
const expect = chai.expect

const Comlink = require('../src/Comlink')

describe('Comlink tests', () => {
  it('should be exists', () => {
    expect(Comlink).to.be.exist
  })
})
