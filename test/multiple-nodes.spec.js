/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 8] */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect

const pDefer = require('p-defer')
const DuplexPair = require('it-pair/duplex')

const FloodSub = require('../src')
const { multicodec } = require('../src')
const { createPeerInfo, first, expectSet } = require('./utils')

async function spawnPubSubNode (peerInfo, reg) {
  const ps = new FloodSub(peerInfo, reg, { emitSelf: true })

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
      let peerInfoA, peerInfoB, peerInfoC

      const registrarRecordA = {}
      const registrarRecordB = {}
      const registrarRecordC = {}

      const registrar = (registrarRecord) => ({
        register: (multicodec, handlers) => {
          registrarRecord[multicodec] = handlers
        },
        unregister: (multicodec) => {
          delete registrarRecord[multicodec]
        }
      })

      before(async () => {
        [peerInfoA, peerInfoB, peerInfoC] = await Promise.all([
          createPeerInfo(),
          createPeerInfo(),
          createPeerInfo()
        ]);

        [psA, psB, psC] = await Promise.all([
          spawnPubSubNode(peerInfoA, registrar(registrarRecordA)),
          spawnPubSubNode(peerInfoB, registrar(registrarRecordB)),
          spawnPubSubNode(peerInfoC, registrar(registrarRecordC))
        ])
      })

      // connect nodes
      before(() => {
        const onConnectA = registrarRecordA[multicodec].onConnect
        const onConnectB = registrarRecordB[multicodec].onConnect
        const onConnectC = registrarRecordC[multicodec].onConnect

        // Notice peers of connection
        const [d0, d1] = DuplexPair()
        onConnectA(peerInfoB, d0)
        onConnectB(peerInfoA, d1)

        const [d2, d3] = DuplexPair()
        onConnectB(peerInfoC, d2)
        onConnectC(peerInfoB, d3)
      })

      after(() => Promise.all([
        psA.stop(),
        psB.stop(),
        psC.stop()
      ]))

      it('subscribe to the topic on node a', () => {
        const defer = pDefer()

        psA.subscribe('Z')
        expectSet(psA.subscriptions, ['Z'])

        psB.once('floodsub:subscription-change', () => {
          expect(psB.peers.size).to.equal(2)
          const aPeerId = psA.peerInfo.id.toB58String()
          const topics = psB.peers.get(aPeerId).topics
          expectSet(topics, ['Z'])

          expect(psC.peers.size).to.equal(1)
          expectSet(first(psC.peers).topics, [])

          defer.resolve()
        })

        return defer.promise
      })

      it('subscribe to the topic on node b', async () => {
        psB.subscribe('Z')
        expectSet(psB.subscriptions, ['Z'])

        await Promise.all([
          new Promise((resolve) => psA.once('floodsub:subscription-change', resolve)),
          new Promise((resolve) => psC.once('floodsub:subscription-change', resolve))
        ])

        expect(psA.peers.size).to.equal(1)
        expectSet(first(psA.peers).topics, ['Z'])

        expect(psC.peers.size).to.equal(1)
        expectSet(first(psC.peers).topics, ['Z'])
      })

      it('subscribe to the topic on node c', () => {
        const defer = pDefer()

        psC.subscribe('Z')
        expectSet(psC.subscriptions, ['Z'])

        psB.once('floodsub:subscription-change', () => {
          expect(psA.peers.size).to.equal(1)
          expectSet(first(psA.peers).topics, ['Z'])

          expect(psB.peers.size).to.equal(2)
          psB.peers.forEach((peer) => {
            expectSet(peer.topics, ['Z'])
          })

          defer.resolve()
        })

        return defer.promise
      })

      it('publish on node a', () => {
        const defer = pDefer()

        let counter = 0

        psA.on('Z', incMsg)
        psB.on('Z', incMsg)
        psC.on('Z', incMsg)

        psA.publish('Z', Buffer.from('hey'))

        function incMsg (msg) {
          expect(msg.data.toString()).to.equal('hey')
          check()
        }

        function check () {
          if (++counter === 3) {
            psA.removeListener('Z', incMsg)
            psB.removeListener('Z', incMsg)
            psC.removeListener('Z', incMsg)
            defer.resolve()
          }
        }

        return defer.promise
      })

      it('publish array on node a', () => {
        const defer = pDefer()
        let counter = 0

        psA.on('Z', incMsg)
        psB.on('Z', incMsg)
        psC.on('Z', incMsg)

        psA.publish('Z', [Buffer.from('hey'), Buffer.from('hey')])

        function incMsg (msg) {
          expect(msg.data.toString()).to.equal('hey')
          check()
        }

        function check () {
          if (++counter === 6) {
            psA.removeListener('Z', incMsg)
            psB.removeListener('Z', incMsg)
            psC.removeListener('Z', incMsg)
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

        it('publish on node b', () => {
          const defer = pDefer()
          let counter = 0

          psA.on('Z', incMsg)
          psB.on('Z', incMsg)
          psC.on('Z', incMsg)

          psB.publish('Z', Buffer.from('hey'))

          function incMsg (msg) {
            expect(msg.data.toString()).to.equal('hey')
            check()
          }

          function check () {
            if (++counter === 3) {
              psA.removeListener('Z', incMsg)
              psB.removeListener('Z', incMsg)
              psC.removeListener('Z', incMsg)
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
      let peerInfoA, peerInfoB, peerInfoC, peerInfoD, peerInfoE

      const registrarRecordA = {}
      const registrarRecordB = {}
      const registrarRecordC = {}
      const registrarRecordD = {}
      const registrarRecordE = {}

      const registrar = (registrarRecord) => ({
        register: (multicodec, handlers) => {
          registrarRecord[multicodec] = handlers
        },
        unregister: (multicodec) => {
          delete registrarRecord[multicodec]
        }
      })

      before(async () => {
        [peerInfoA, peerInfoB, peerInfoC, peerInfoD, peerInfoE] = await Promise.all([
          createPeerInfo(),
          createPeerInfo(),
          createPeerInfo(),
          createPeerInfo(),
          createPeerInfo()
        ]);

        [psA, psB, psC, psD, psE] = await Promise.all([
          spawnPubSubNode(peerInfoA, registrar(registrarRecordA)),
          spawnPubSubNode(peerInfoB, registrar(registrarRecordB)),
          spawnPubSubNode(peerInfoC, registrar(registrarRecordC)),
          spawnPubSubNode(peerInfoD, registrar(registrarRecordD)),
          spawnPubSubNode(peerInfoE, registrar(registrarRecordE))
        ])
      })

      // connect nodes
      before(() => {
        const onConnectA = registrarRecordA[multicodec].onConnect
        const onConnectB = registrarRecordB[multicodec].onConnect
        const onConnectC = registrarRecordC[multicodec].onConnect
        const onConnectD = registrarRecordD[multicodec].onConnect
        const onConnectE = registrarRecordE[multicodec].onConnect

        // Notice peers of connection
        const [d0, d1] = DuplexPair() // A <-> B
        onConnectA(peerInfoB, d0)
        onConnectB(peerInfoA, d1)

        const [d2, d3] = DuplexPair() // B <-> C
        onConnectB(peerInfoC, d2)
        onConnectC(peerInfoB, d3)

        const [d4, d5] = DuplexPair() // C <-> D
        onConnectC(peerInfoD, d4)
        onConnectD(peerInfoC, d5)

        const [d6, d7] = DuplexPair() // C <-> D
        onConnectD(peerInfoE, d6)
        onConnectE(peerInfoD, d7)
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

        psC.publish('Z', Buffer.from('hey from c'))

        function incMsg (msg) {
          expect(msg.data.toString()).to.equal('hey from c')
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
