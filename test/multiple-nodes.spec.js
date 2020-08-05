/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 8] */
'use strict'

const { expect } = require('aegir/utils/chai')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const pDefer = require('p-defer')

const FloodSub = require('../src')
const { expectSet } = require('./utils')
const { createPeers } = require('./utils/create-peer')

async function spawnPubSubNode (peer) {
  const ps = new FloodSub(peer, { emitSelf: true })

  await ps.start()
  return ps
}

describe('multiple nodes (more than 2)', () => {
  describe('every peer subscribes to the topic', () => {
    describe('line', () => {
      // line
      // ◉────◉────◉
      // a    b    c
      let psA, psB, psC
      let peerA, peerB, peerC

      beforeEach(async () => {
        [peerA, peerB, peerC] = await createPeers({ number: 3 })

        ;[psA, psB, psC] = await Promise.all([
          spawnPubSubNode(peerA),
          spawnPubSubNode(peerB),
          spawnPubSubNode(peerC)
        ])
      })

      // connect nodes
      beforeEach(async () => {
        await peerA.dialProtocol(peerB.peerId, FloodSub.multicodec)
        await peerB.dialProtocol(peerC.peerId, FloodSub.multicodec)
      })

      after(() => Promise.all([
        psA.stop(),
        psB.stop(),
        psC.stop()
      ]))

      it('subscribe to the topic on node a', () => {
        const topic = 'Z'
        const defer = pDefer()

        psA.subscribe(topic)
        expectSet(psA.subscriptions, [topic])

        psB.once('floodsub:subscription-change', () => {
          expect(psB.peers.size).to.equal(2)

          const aPeerId = psA.peerId.toB58String()
          expectSet(psB.topics.get(topic), [aPeerId])

          expect(psC.peers.size).to.equal(1)
          expect(psC.topics.get(topic)).to.not.exist()

          defer.resolve()
        })

        return defer.promise
      })

      it('subscribe to the topic on node b', async () => {
        const topic = 'Z'
        psB.subscribe(topic)
        expectSet(psB.subscriptions, [topic])

        await Promise.all([
          new Promise((resolve) => psA.once('floodsub:subscription-change', resolve)),
          new Promise((resolve) => psC.once('floodsub:subscription-change', resolve))
        ])

        expect(psA.peers.size).to.equal(1)
        expectSet(psA.topics.get(topic), [psB.peerId.toB58String()])

        expect(psC.peers.size).to.equal(1)
        expectSet(psC.topics.get(topic), [psB.peerId.toB58String()])
      })

      it('subscribe to the topic on node c', () => {
        const topic = 'Z'
        const defer = pDefer()

        psC.subscribe(topic)
        expectSet(psC.subscriptions, [topic])

        psB.once('floodsub:subscription-change', () => {
          expect(psA.peers.size).to.equal(1)
          expect(psB.peers.size).to.equal(2)
          expectSet(psB.topics.get(topic), [psC.peerId.toB58String()])

          defer.resolve()
        })

        return defer.promise
      })

      it('publish on node a', async () => {
        const topic = 'Z'
        const defer = pDefer()

        psA.subscribe(topic)
        psB.subscribe(topic)
        psC.subscribe(topic)

        // await subscription change
        await Promise.all([
          new Promise(resolve => psA.once('floodsub:subscription-change', () => resolve())),
          new Promise(resolve => psB.once('floodsub:subscription-change', () => resolve())),
          new Promise(resolve => psC.once('floodsub:subscription-change', () => resolve()))
        ])

        let counter = 0

        psA.on(topic, incMsg)
        psB.on(topic, incMsg)
        psC.on(topic, incMsg)

        psA.publish(topic, uint8ArrayFromString('hey'))

        function incMsg (msg) {
          expect(uint8ArrayToString(msg.data)).to.equal('hey')
          check()
        }

        function check () {
          if (++counter === 3) {
            psA.removeListener(topic, incMsg)
            psB.removeListener(topic, incMsg)
            psC.removeListener(topic, incMsg)
            defer.resolve()
          }
        }

        return defer.promise
      })

      // since the topology is the same, just the publish
      // gets sent by other peer, we reused the same peers
      describe('1 level tree', () => {
        // 1 level tree
        //     ┌◉┐
        //     │b│
        //   ◉─┘ └─◉
        //   a     c

        it('publish on node b', async () => {
          const topic = 'Z'
          const defer = pDefer()
          let counter = 0

          psA.subscribe(topic)
          psB.subscribe(topic)
          psC.subscribe(topic)

          // await subscription change
          await Promise.all([
            new Promise(resolve => psA.once('floodsub:subscription-change', () => resolve())),
            new Promise(resolve => psB.once('floodsub:subscription-change', () => resolve())),
            new Promise(resolve => psC.once('floodsub:subscription-change', () => resolve()))
          ])

          psA.on(topic, incMsg)
          psB.on(topic, incMsg)
          psC.on(topic, incMsg)

          psB.publish(topic, uint8ArrayFromString('hey'))

          function incMsg (msg) {
            expect(uint8ArrayToString(msg.data)).to.equal('hey')
            check()
          }

          function check () {
            if (++counter === 3) {
              psA.removeListener(topic, incMsg)
              psB.removeListener(topic, incMsg)
              psC.removeListener(topic, incMsg)
              defer.resolve()
            }
          }

          return defer.promise
        })
      })
    })

    describe('2 level tree', () => {
      // 2 levels tree
      //      ┌◉┐
      //      │c│
      //   ┌◉─┘ └─◉┐
      //   │b     d│
      // ◉─┘       └─◉
      // a
      let psA, psB, psC, psD, psE
      let peerA, peerB, peerC, peerD, peerE

      before(async () => {
        [peerA, peerB, peerC, peerD, peerE] = await createPeers({ number: 5 })
        ;[psA, psB, psC, psD, psE] = await Promise.all([
          spawnPubSubNode(peerA),
          spawnPubSubNode(peerB),
          spawnPubSubNode(peerC),
          spawnPubSubNode(peerD),
          spawnPubSubNode(peerE)
        ])
      })

      // connect nodes
      before(async () => {
        await peerA.dialProtocol(peerB.peerId, FloodSub.multicodec)
        await peerB.dialProtocol(peerC.peerId, FloodSub.multicodec)
        await peerC.dialProtocol(peerD.peerId, FloodSub.multicodec)
        await peerD.dialProtocol(peerE.peerId, FloodSub.multicodec)
      })

      after(() => Promise.all([
        psA.stop(),
        psB.stop(),
        psC.stop(),
        psD.stop(),
        psE.stop()
      ]))

      it('subscribes', () => {
        psA.subscribe('Z')
        expectSet(psA.subscriptions, ['Z'])
        psB.subscribe('Z')
        expectSet(psB.subscriptions, ['Z'])
        psC.subscribe('Z')
        expectSet(psC.subscriptions, ['Z'])
        psD.subscribe('Z')
        expectSet(psD.subscriptions, ['Z'])
        psE.subscribe('Z')
        expectSet(psE.subscriptions, ['Z'])
      })

      it('publishes from c', function () {
        this.timeout(30 * 1000)
        const defer = pDefer()
        let counter = 0

        psA.on('Z', incMsg)
        psB.on('Z', incMsg)
        psC.on('Z', incMsg)
        psD.on('Z', incMsg)
        psE.on('Z', incMsg)

        psC.publish('Z', uint8ArrayFromString('hey from c'))

        function incMsg (msg) {
          expect(uint8ArrayToString(msg.data)).to.equal('hey from c')
          check()
        }

        function check () {
          if (++counter === 5) {
            psA.removeListener('Z', incMsg)
            psB.removeListener('Z', incMsg)
            psC.removeListener('Z', incMsg)
            psD.removeListener('Z', incMsg)
            psE.removeListener('Z', incMsg)
            defer.resolve()
          }
        }

        return defer.promise
      })
    })
  })

  describe('only some nodes subscribe the networks', () => {
    describe('line', () => {
      // line
      // ◉────◎────◉
      // a    b    c

      before(() => { })
      after(() => { })
    })

    describe('1 level tree', () => {
      // 1 level tree
      //     ┌◉┐
      //     │b│
      //   ◎─┘ └─◉
      //   a     c

      before(() => { })
      after(() => { })
    })

    describe('2 level tree', () => {
      // 2 levels tree
      //      ┌◉┐
      //      │c│
      //   ┌◎─┘ └─◉┐
      //   │b     d│
      // ◉─┘       └─◎
      // a           e

      before(() => { })
      after(() => { })
    })
  })
})
