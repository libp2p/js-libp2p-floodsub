/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const expect = require('chai').expect
const parallel = require('async/parallel')
const series = require('async/series')
const _times = require('lodash.times')

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

    before((done) => {
      series([
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb),
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb)
      ], (err, nodes) => {
        if (err) {
          return done(err)
        }
        nodeA = nodes[0]
        nodeB = nodes[1]
        done()
      })
    })

    after((done) => {
      parallel([
        (cb) => nodeA.stop(cb),
        (cb) => nodeB.stop(cb)
      ], done)
    })

    it('Mount the pubsub protocol', (done) => {
      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      setTimeout(() => {
        expect(fsA.peers.size).to.be.eql(0)
        expect(fsA.subscriptions.size).to.eql(0)
        expect(fsB.peers.size).to.be.eql(0)
        expect(fsB.subscriptions.size).to.eql(0)
        done()
      }, 50)
    })

    it('start both FloodSubs', (done) => {
      parallel([
        (cb) => fsA.start(cb),
        (cb) => fsB.start(cb)
      ], done)
    })

    it('Dial from nodeA to nodeB', (done) => {
      series([
        (cb) => nodeA.dialByPeerInfo(nodeB.peerInfo, cb),
        (cb) => setTimeout(() => {
          expect(fsA.peers.size).to.equal(1)
          expect(fsB.peers.size).to.equal(1)
          cb()
        }, 250)
      ], done)
    })

    it('Subscribe to a topic:Z in nodeA', (done) => {
      fsA.subscribe('Z')
      setTimeout(() => {
        expectSet(fsA.subscriptions, ['Z'])
        expect(fsB.peers.size).to.equal(1)
        expectSet(first(fsB.peers).topics, ['Z'])
        done()
      }, 100)
    })

    it('Publish to a topic:Z in nodeA', (done) => {
      fsB.once('Z', shouldNotHappen)

      function shouldNotHappen (msg) { expect.fail() }

      fsA.once('Z', (msg) => {
        expect(msg.data.toString()).to.equal('hey')
        fsB.removeListener('Z', shouldNotHappen)
        done()
      })

      fsB.once('Z', shouldNotHappen)

      fsA.publish('Z', new Buffer('hey'))
    })

    it('Publish to a topic:Z in nodeB', (done) => {
      fsB.once('Z', shouldNotHappen)

      fsA.once('Z', (msg) => {
        fsA.once('Z', shouldNotHappen)
        expect(msg.data.toString()).to.equal('banana')
        setTimeout(() => {
          fsA.removeListener('Z', shouldNotHappen)
          fsB.removeListener('Z', shouldNotHappen)
          done()
        }, 100)
      })

      fsB.once('Z', shouldNotHappen)

      fsB.publish('Z', new Buffer('banana'))
    })

    it('Publish 10 msg to a topic:Z in nodeB', (done) => {
      let counter = 0

      fsB.once('Z', shouldNotHappen)

      fsA.on('Z', receivedMsg)

      function receivedMsg (msg) {
        expect(msg.data.toString()).to.equal('banana')
        expect(msg.from).to.be.eql(fsB.libp2p.peerInfo.id.toB58String())
        expect(Buffer.isBuffer(msg.seqno)).to.be.true
        expect(msg.topicCIDs).to.be.eql(['Z'])

        if (++counter === 10) {
          fsA.removeListener('Z', receivedMsg)
          done()
        }
      }

      _times(10, () => {
        fsB.publish('Z', new Buffer('banana'))
      })
    })

    it('Unsubscribe from topic:Z in nodeA', (done) => {
      fsA.unsubscribe('Z')
      expect(fsA.subscriptions.size).to.equal(0)

      setTimeout(() => {
        expect(fsB.peers.size).to.equal(1)
        expectSet(first(fsB.peers).topics, [])
        done()
      }, 100)
    })

    it('Publish to a topic:Z in nodeA nodeB', (done) => {
      fsA.once('Z', shouldNotHappen)
      fsB.once('Z', shouldNotHappen)

      setTimeout(() => {
        fsA.removeListener('Z', shouldNotHappen)
        fsB.removeListener('Z', shouldNotHappen)
        done()
      }, 100)

      fsB.publish('Z', new Buffer('banana'))
      fsA.publish('Z', new Buffer('banana'))
    })

    it('Last value cache', (done) => {
      fsA.subscribe('P')
      fsA.once('P', (msg) => {
        expect(msg.data.toString()).to.eql('hello')

        // we subscribe after the first submission
        fsB.once('P', (msg2) => {
          expect(msg2.data.toString()).to.eql('hello')

          fsA.unsubscribe('P')
          fsB.unsubscribe('P')
          done()
        })

        fsB.subscribe('P')
      })

      fsB.publish('P', new Buffer('hello'))
    })

    it('stop both FloodSubs', (done) => {
      parallel([
        (cb) => fsA.stop(cb),
        (cb) => fsB.stop(cb)
      ], done)
    })
  })

  describe('nodes send state on connection', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before((done) => {
      series([
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb),
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb)
      ], (cb, nodes) => {
        nodeA = nodes[0]
        nodeB = nodes[1]

        fsA = new FloodSub(nodeA)
        fsB = new FloodSub(nodeB)

        parallel([
          (cb) => fsA.start(cb),
          (cb) => fsB.start(cb)
        ], next)

        function next () {
          fsA.subscribe('Za')
          fsB.subscribe('Zb')

          expect(fsA.peers.size).to.equal(0)
          expectSet(fsA.subscriptions, ['Za'])
          expect(fsB.peers.size).to.equal(0)
          expectSet(fsB.subscriptions, ['Zb'])
          done()
        }
      })
    })

    after((done) => {
      parallel([
        (cb) => nodeA.stop(cb),
        (cb) => nodeB.stop(cb)
      ], done)
    })

    it('existing subscriptions are sent upon peer connection', (done) => {
      nodeA.dialByPeerInfo(nodeB.peerInfo, (err) => {
        expect(err).to.not.exist
        setTimeout(() => {
          expect(fsA.peers.size).to.equal(1)
          expect(fsB.peers.size).to.equal(1)

          expectSet(fsA.subscriptions, ['Za'])
          expect(fsB.peers.size).to.equal(1)
          expectSet(first(fsB.peers).topics, ['Za'])

          expectSet(fsB.subscriptions, ['Zb'])
          expect(fsA.peers.size).to.equal(1)
          expectSet(first(fsA.peers).topics, ['Zb'])

          done()
        }, 250)
      })
    })

    it('stop both FloodSubs', (done) => {
      parallel([
        (cb) => fsA.stop(cb),
        (cb) => fsB.stop(cb)
      ], done)
    })
  })

  describe('nodes handle connection errors', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before((done) => {
      series([
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb),
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb)
      ], (cb, nodes) => {
        nodeA = nodes[0]
        nodeB = nodes[1]

        fsA = new FloodSub(nodeA)
        fsB = new FloodSub(nodeB)

        parallel([
          (cb) => fsA.start(cb),
          (cb) => fsB.start(cb)
        ], next)

        function next () {
          fsA.subscribe('Za')
          fsB.subscribe('Zb')

          expect(fsA.peers.size).to.equal(0)
          expectSet(fsA.subscriptions, ['Za'])
          expect(fsB.peers.size).to.equal(0)
          expectSet(fsB.subscriptions, ['Zb'])
          done()
        }
      })
    })

    after((done) => {
      parallel([
        (cb) => nodeA.stop(cb),
        (cb) => nodeB.stop(cb)
      ], done)
    })

    it('peer is removed from the state when connection ends', (done) => {
      nodeA.dialByPeerInfo(nodeB.peerInfo, (err) => {
        expect(err).to.not.exist
        setTimeout(() => {
          expect(fsA.peers.size).to.equal(1)
          expect(fsB.peers.size).to.equal(1)

          fsA.stop(() => {
            setTimeout(() => {
              expect(fsB.peers.size).to.equal(0)
              done()
            }, 250)
          })
        }, 250)
      })
    })
  })

  describe('dial the pubsub protocol on mount', () => {
    let nodeA
    let nodeB
    let fsA
    let fsB

    before((done) => {
      series([
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb),
        (cb) => createNode('/ip4/127.0.0.1/tcp/0', cb)
      ], (cb, nodes) => {
        nodeA = nodes[0]
        nodeB = nodes[1]
        nodeA.dialByPeerInfo(nodeB.peerInfo, () => setTimeout(done, 1000))
      })
    })

    after((done) => {
      parallel([
        (cb) => nodeA.stop(cb),
        (cb) => nodeB.stop(cb)
      ], done)
    })

    it('dial on floodsub on mount', (done) => {
      fsA = new FloodSub(nodeA)
      fsB = new FloodSub(nodeB)

      parallel([
        (cb) => fsA.start(cb),
        (cb) => fsB.start(cb)
      ], next)

      function next () {
        expect(fsA.peers.size).to.equal(1)
        expect(fsB.peers.size).to.equal(1)
        done()
      }
    })

    it('stop both FloodSubs', (done) => {
      parallel([
        (cb) => fsA.stop(cb),
        (cb) => fsB.stop(cb)
      ], done)
    })
  })
})

function shouldNotHappen (msg) {
  expect.fail()
}
