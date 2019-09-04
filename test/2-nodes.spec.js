/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
chai.use(require('chai-spies'))
const expect = chai.expect
const times = require('lodash/times')

const FloodSub = require('../src')
const utils = require('./utils')
const first = utils.first
const createNode = utils.createNode
const expectSet = utils.expectSet

describe('basics between 2 nodes', () => {
  describe('fresh nodes', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])
    })

    after(() => {
      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('Mount the pubsub protocol', () => {
      fsA = new FloodSub(nodeA, { emitSelf: true })
      fsB = new FloodSub(nodeB, { emitSelf: true })

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(fsA.peers.size).to.be.eql(0)
          expect(fsA.subscriptions.size).to.eql(0)
          expect(fsB.peers.size).to.be.eql(0)
          expect(fsB.subscriptions.size).to.eql(0)
          resolve()
        }, 50)
      })
    })

    it('start both FloodSubs', () => {
      return Promise.all([
        fsA.start(),
        fsB.start()
      ])
    })

    it('Dial from nodeA to nodeB', async () => {
      await nodeA.dial(nodeB.peerInfo)

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(fsA.peers.size).to.equal(1)
          expect(fsB.peers.size).to.equal(1)
          resolve()
        }, 1000)
      })
    })

    it('Subscribe to a topic:Z in nodeA', () => {
      return new Promise((resolve) => {
        fsA.subscribe('Z')
        fsB.once('floodsub:subscription-change', (changedPeerInfo, changedTopics, changedSubs) => {
          expectSet(fsA.subscriptions, ['Z'])
          expect(fsB.peers.size).to.equal(1)
          expectSet(first(fsB.peers).topics, ['Z'])
          expect(changedPeerInfo.id.toB58String()).to.equal(first(fsB.peers).info.id.toB58String())
          expectSet(changedTopics, ['Z'])
          expect(changedSubs).to.be.eql([{ topicID: 'Z', subscribe: true }])
          resolve()
        })
      })
    })

    it('Publish to a topic:Z in nodeA', () => {
      return new Promise((resolve) => {
        fsA.once('Z', (msg) => {
          expect(msg.data.toString()).to.equal('hey')
          fsB.removeListener('Z', shouldNotHappen)
          resolve()
        })

        fsB.once('Z', shouldNotHappen)

        fsA.publish('Z', Buffer.from('hey'))
      })
    })

    it('Publish to a topic:Z in nodeB', () => {
      return new Promise((resolve) => {
        fsA.once('Z', (msg) => {
          fsA.once('Z', shouldNotHappen)
          expect(msg.data.toString()).to.equal('banana')

          setTimeout(() => {
            fsA.removeListener('Z', shouldNotHappen)
            fsB.removeListener('Z', shouldNotHappen)
            resolve()
          }, 100)
        })

        fsB.once('Z', shouldNotHappen)

        fsB.publish('Z', Buffer.from('banana'))
      })
    })

    it('Publish 10 msg to a topic:Z in nodeB', () => {
      let counter = 0

      fsB.once('Z', shouldNotHappen)

      return new Promise((resolve) => {
        fsA.on('Z', receivedMsg)

        function receivedMsg (msg) {
          expect(msg.data.toString()).to.equal('banana')
          expect(msg.from).to.be.eql(fsB.libp2p.peerInfo.id.toB58String())
          expect(Buffer.isBuffer(msg.seqno)).to.be.true()
          expect(msg.topicIDs).to.be.eql(['Z'])

          if (++counter === 10) {
            fsA.removeListener('Z', receivedMsg)
            fsB.removeListener('Z', shouldNotHappen)
            resolve()
          }
        }
        times(10, () => fsB.publish('Z', Buffer.from('banana')))
      })
    })

    it('Publish 10 msg to a topic:Z in nodeB as array', () => {
      let counter = 0

      fsB.once('Z', shouldNotHappen)

      return new Promise((resolve) => {
        fsA.on('Z', receivedMsg)

        function receivedMsg (msg) {
          expect(msg.data.toString()).to.equal('banana')
          expect(msg.from).to.be.eql(fsB.libp2p.peerInfo.id.toB58String())
          expect(Buffer.isBuffer(msg.seqno)).to.be.true()
          expect(msg.topicIDs).to.be.eql(['Z'])

          if (++counter === 10) {
            fsA.removeListener('Z', receivedMsg)
            fsB.removeListener('Z', shouldNotHappen)
            resolve()
          }
        }

        const msgs = []
        times(10, () => msgs.push(Buffer.from('banana')))
        fsB.publish('Z', msgs)
      })
    })

    it('Unsubscribe from topic:Z in nodeA', () => {
      fsA.unsubscribe('Z')
      expect(fsA.subscriptions.size).to.equal(0)

      return new Promise((resolve) => {
        fsB.once('floodsub:subscription-change', (changedPeerInfo, changedTopics, changedSubs) => {
          expect(fsB.peers.size).to.equal(1)
          expectSet(first(fsB.peers).topics, [])
          expect(changedPeerInfo.id.toB58String()).to.equal(first(fsB.peers).info.id.toB58String())
          expectSet(changedTopics, [])
          expect(changedSubs).to.be.eql([{ topicID: 'Z', subscribe: false }])
          resolve()
        })
      })
    })

    it('Publish to a topic:Z in nodeA nodeB', () => {
      fsA.once('Z', shouldNotHappen)
      fsB.once('Z', shouldNotHappen)

      return new Promise((resolve) => {
        setTimeout(() => {
          fsA.removeListener('Z', shouldNotHappen)
          fsB.removeListener('Z', shouldNotHappen)
          resolve()
        }, 100)

        fsB.publish('Z', Buffer.from('banana'))
        fsA.publish('Z', Buffer.from('banana'))
      })
    })

    it('stop both FloodSubs', () => {
      fsA.stop()
      fsB.stop()
    })
  })

  describe('nodes send state on connection', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      await Promise.all([
        fsA.start(),
        fsB.start()
      ])

      fsA.subscribe('Za')
      fsB.subscribe('Zb')

      expect(fsA.peers.size).to.equal(0)
      expectSet(fsA.subscriptions, ['Za'])
      expect(fsB.peers.size).to.equal(0)
      expectSet(fsB.subscriptions, ['Zb'])
    })

    after(() => {
      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('existing subscriptions are sent upon peer connection', async () => {
      await Promise.all([
        nodeA.dial(nodeB.peerInfo),
        new Promise((resolve) => fsA.once('floodsub:subscription-change', resolve)),
        new Promise((resolve) => fsB.once('floodsub:subscription-change', resolve))
      ])

      expect(fsA.peers.size).to.equal(1)
      expect(fsB.peers.size).to.equal(1)

      expectSet(fsA.subscriptions, ['Za'])
      expect(fsB.peers.size).to.equal(1)
      expectSet(first(fsB.peers).topics, ['Za'])

      expectSet(fsB.subscriptions, ['Zb'])
      expect(fsA.peers.size).to.equal(1)
      expectSet(first(fsA.peers).topics, ['Zb'])
    })

    it('stop both FloodSubs', () => {
      fsA.stop()
      fsB.stop()
    })
  })

  describe('nodes handle connection errors', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      await Promise.all([
        fsA.start(),
        fsB.start()
      ])

      fsA.subscribe('Za')
      fsB.subscribe('Zb')

      expect(fsA.peers.size).to.equal(0)
      expectSet(fsA.subscriptions, ['Za'])
      expect(fsB.peers.size).to.equal(0)
      expectSet(fsB.subscriptions, ['Zb'])
    })

    it('peer is removed from the state when connection ends', async () => {
      await nodeA.dial(nodeB.peerInfo)

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(first(fsA.peers)._references).to.equal(2)
          expect(first(fsB.peers)._references).to.equal(2)

          fsA.stop()
          setTimeout(() => {
            expect(first(fsB.peers)._references).to.equal(1)
            resolve()
          }, 1000)
        }, 1000)
      })
    })

    it('stop one node', () => {
      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('nodes don\'t have peers in it', () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(fsA.peers.size).to.equal(0)
          expect(fsB.peers.size).to.equal(0)
          resolve()
        }, 1000)
      })
    })
  })

  describe('dial the pubsub protocol on mount', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      await nodeA.dial(nodeB.peerInfo)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    })

    after(() => {
      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('dial on floodsub on mount', async () => {
      fsA = new FloodSub(nodeA, { emitSelf: true })
      fsB = new FloodSub(nodeB, { emitSelf: true })

      await Promise.all([
        fsA.start(),
        fsB.start()
      ])

      expect(fsA.peers.size).to.equal(1)
      expect(fsB.peers.size).to.equal(1)
    })

    it('stop both FloodSubs', () => {
      fsA.stop()
      fsB.stop()
    })
  })

  describe('prevent concurrent dials', () => {
    let sandbox
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      sandbox = chai.spy.sandbox()

      // Put node B in node A's peer book
      nodeA.peerBook.put(nodeB.peerInfo)

      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      await fsB.start()
    })

    after(() => {
      sandbox.restore()

      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('does not dial twice to same peer', async () => {
      sandbox.on(fsA, ['_onDial'])
      // When node A starts, it will dial all peers in its peer book, which
      // is just peer B
      await fsA.start()

      // Simulate a connection coming in from peer B at the same time. This
      // causes floodsub to dial peer B
      nodeA.emit('peer:connect', nodeB.peerInfo)

      return new Promise((resolve) => {
        // Check that only one dial was made
        setTimeout(() => {
          expect(fsA._onDial).to.have.been.called.once()
          resolve()
        }, 1000)
      })
    })
  })

  describe('allow dials even after error', () => {
    let sandbox
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      sandbox = chai.spy.sandbox()

      // Put node B in node A's peer book
      nodeA.peerBook.put(nodeB.peerInfo)

      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      await fsB.start()
    })

    after(() => {
      sandbox.restore()

      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('can dial again after error', async () => {
      let firstTime = true
      const dialProtocol = fsA.libp2p.dialProtocol.bind(fsA.libp2p)

      sandbox.on(fsA.libp2p, 'dialProtocol', (peerInfo, multicodec, cb) => {
        // Return an error for the first dial
        if (firstTime) {
          firstTime = false
          return cb(new Error('dial error'))
        }

        // Subsequent dials proceed as normal
        dialProtocol(peerInfo, multicodec, cb)
      })

      // When node A starts, it will dial all peers in its peer book, which
      // is just peer B
      await fsA.start()

      // Simulate a connection coming in from peer B. This causes floodsub
      // to dial peer B
      nodeA.emit('peer:connect', nodeB.peerInfo)

      return new Promise((resolve) => {
        // Check that both dials were made
        setTimeout(() => {
          expect(fsA.libp2p.dialProtocol).to.have.been.called.twice()
          resolve()
        }, 1000)
      })
    })
  })

  describe('prevent processing dial after stop', () => {
    let sandbox
    let nodeA
    let nodeB
    let fsA
    let fsB

    before(async () => {
      [nodeA, nodeB] = await Promise.all([
        createNode(),
        createNode()
      ])

      sandbox = chai.spy.sandbox()

      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      await Promise.all([
        fsA.start(),
        fsB.start()
      ])
    })

    after(() => {
      sandbox.restore()

      return Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ])
    })

    it('does not process dial after stop', () => {
      sandbox.on(fsA, ['_onDial'])

      // Simulate a connection coming in from peer B at the same time. This
      // causes floodsub to dial peer B
      nodeA.emit('peer:connect', nodeB.peerInfo)

      // Stop floodsub before the dial can complete
      fsA.stop()

      return new Promise((resolve) => {
        // Check that the dial was not processed
        setTimeout(() => {
          expect(fsA._onDial).to.not.have.been.called()
          resolve()
        }, 1000)
      })
    })
  })
})

function shouldNotHappen (msg) {
  expect.fail()
}
