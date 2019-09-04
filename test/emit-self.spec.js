/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
chai.use(require('chai-spies'))
const expect = chai.expect

const FloodSub = require('../src')

const {
  createNode
} = require('./utils')

const shouldNotHappen = (_) => expect.fail()

describe('emit self', () => {
  const topic = 'Z'

  describe('enabled', () => {
    let nodeA
    let fsA

    before(async () => {
      nodeA = await createNode()
      await nodeA.start()
    })

    before(() => {
      fsA = new FloodSub(nodeA, { emitSelf: true })
      return fsA.start()
    })

    before(() => {
      fsA.subscribe(topic)
    })

    after(() => {
      fsA.stop()
      return nodeA.stop()
    })

    it('should emit to self on publish', () => {
      const promise = new Promise((resolve) => fsA.once(topic, resolve))

      fsA.publish(topic, Buffer.from('hey'))

      return promise
    })
  })

  describe('disabled', () => {
    let nodeA
    let fsA

    before(async () => {
      nodeA = await createNode()
      await nodeA.start()
    })

    before(() => {
      fsA = new FloodSub(nodeA, { emitSelf: false })
      return fsA.start()
    })

    before(() => {
      fsA.subscribe(topic)
    })

    after(() => {
      fsA.stop()
      return nodeA.stop()
    })

    it('should emit to self on publish', () => {
      fsA.once(topic, (m) => shouldNotHappen)

      fsA.publish(topic, Buffer.from('hey'))

      // Wait 1 second to guarantee that self is not noticed
      return new Promise((resolve) => setTimeout(() => resolve(), 1000))
    })
  })
})
