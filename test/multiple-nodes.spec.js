/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 8] */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect

const isNode = require('detect-node')

const FloodSub = require('../src')
const utils = require('./utils')
const first = utils.first
const createNode = utils.createNode
const expectSet = utils.expectSet

describe('multiple nodes (more than 2)', () => {
  describe('every peer subscribes to the topic', () => {
    describe('line', () => {
      // line
      // ◉────◉────◉
      // a    b    c
      let a
      let b
      let c

      before(async () => {
        [a, b, c] = await Promise.all([
          spawnPubSubNode(),
          spawnPubSubNode(),
          spawnPubSubNode()
        ])
      })

      after(() => {
        // note: setTimeout to avoid the tests finishing
        // before swarm does its dials
        return new Promise((resolve) => {
          setTimeout(async () => {
            await Promise.all([
              a.libp2p.stop(),
              b.libp2p.stop(),
              c.libp2p.stop()
            ])
            resolve()
          }, 1000)
        })
      })

      it('establish the connections', async () => {
        await Promise.all([
          a.libp2p.dial(b.libp2p.peerInfo),
          b.libp2p.dial(c.libp2p.peerInfo)
        ])

        // wait for the pubsub pipes to be established
        return new Promise((resolve) => setTimeout(resolve, 1000))
      })

      it('subscribe to the topic on node a', () => {
        a.ps.subscribe('Z')
        expectSet(a.ps.subscriptions, ['Z'])

        return new Promise((resolve) => {
          b.ps.once('floodsub:subscription-change', () => {
            expect(b.ps.peers.size).to.equal(2)
            const aPeerId = a.libp2p.peerInfo.id.toB58String()
            const topics = b.ps.peers.get(aPeerId).topics
            expectSet(topics, ['Z'])

            expect(c.ps.peers.size).to.equal(1)
            expectSet(first(c.ps.peers).topics, [])

            resolve()
          })
        })
      })

      it('subscribe to the topic on node b', async () => {
        b.ps.subscribe('Z')
        expectSet(b.ps.subscriptions, ['Z'])

        await Promise.all([
          new Promise((resolve) => a.ps.once('floodsub:subscription-change', resolve)),
          new Promise((resolve) => c.ps.once('floodsub:subscription-change', resolve))
        ])

        expect(a.ps.peers.size).to.equal(1)
        expectSet(first(a.ps.peers).topics, ['Z'])

        expect(c.ps.peers.size).to.equal(1)
        expectSet(first(c.ps.peers).topics, ['Z'])
      })

      it('subscribe to the topic on node c', () => {
        c.ps.subscribe('Z')
        expectSet(c.ps.subscriptions, ['Z'])

        return new Promise((resolve) => {
          b.ps.once('floodsub:subscription-change', () => {
            expect(a.ps.peers.size).to.equal(1)
            expectSet(first(a.ps.peers).topics, ['Z'])

            expect(b.ps.peers.size).to.equal(2)
            b.ps.peers.forEach((peer) => {
              expectSet(peer.topics, ['Z'])
            })

            resolve()
          })
        })
      })

      it('publish on node a', () => {
        let counter = 0

        return new Promise((resolve) => {
          a.ps.on('Z', incMsg)
          b.ps.on('Z', incMsg)
          c.ps.on('Z', incMsg)

          a.ps.publish('Z', Buffer.from('hey'))

          function incMsg (msg) {
            expect(msg.data.toString()).to.equal('hey')
            check()
          }

          function check () {
            if (++counter === 3) {
              a.ps.removeListener('Z', incMsg)
              b.ps.removeListener('Z', incMsg)
              c.ps.removeListener('Z', incMsg)
              resolve()
            }
          }
        })
      })

      it('publish array on node a', () => {
        let counter = 0

        return new Promise((resolve) => {
          a.ps.on('Z', incMsg)
          b.ps.on('Z', incMsg)
          c.ps.on('Z', incMsg)

          a.ps.publish('Z', [Buffer.from('hey'), Buffer.from('hey')])

          function incMsg (msg) {
            expect(msg.data.toString()).to.equal('hey')
            check()
          }

          function check () {
            if (++counter === 6) {
              a.ps.removeListener('Z', incMsg)
              b.ps.removeListener('Z', incMsg)
              c.ps.removeListener('Z', incMsg)
              resolve()
            }
          }
        })
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
          let counter = 0

          return new Promise((resolve) => {
            a.ps.on('Z', incMsg)
            b.ps.on('Z', incMsg)
            c.ps.on('Z', incMsg)

            b.ps.publish('Z', Buffer.from('hey'))

            function incMsg (msg) {
              expect(msg.data.toString()).to.equal('hey')
              check()
            }

            function check () {
              if (++counter === 3) {
                a.ps.removeListener('Z', incMsg)
                b.ps.removeListener('Z', incMsg)
                c.ps.removeListener('Z', incMsg)
                resolve()
              }
            }
          })
        })
      })
    })

    if (isNode) {
      // TODO enable for browser
      describe('2 level tree', () => {
        // 2 levels tree
        //      ┌◉┐
        //      │c│
        //   ┌◉─┘ └─◉┐
        //   │b     d│
        // ◉─┘       └─◉
        // a           e

        let a
        let b
        let c
        let d
        let e

        before(async () => {
          [a, b, c, d, e] = await Promise.all([
            spawnPubSubNode(),
            spawnPubSubNode(),
            spawnPubSubNode(),
            spawnPubSubNode(),
            spawnPubSubNode()
          ])
        })

        after(() => {
          // note: setTimeout to avoid the tests finishing
          // before swarm does its dials
          return new Promise((resolve) => {
            setTimeout(async () => {
              await Promise.all([
                a.libp2p.stop(),
                b.libp2p.stop(),
                c.libp2p.stop(),
                d.libp2p.stop(),
                e.libp2p.stop()
              ])

              resolve()
            }, 1000)
          })
        })

        it('establish the connections', async function () {
          this.timeout(30 * 1000)

          await Promise.all([
            a.libp2p.dial(b.libp2p.peerInfo),
            b.libp2p.dial(c.libp2p.peerInfo),
            c.libp2p.dial(d.libp2p.peerInfo),
            d.libp2p.dial(e.libp2p.peerInfo)
          ])

          // wait for the pubsub pipes to be established
          return new Promise((resolve) => setTimeout(resolve, 10000))
        })

        it('subscribes', () => {
          a.ps.subscribe('Z')
          expectSet(a.ps.subscriptions, ['Z'])
          b.ps.subscribe('Z')
          expectSet(b.ps.subscriptions, ['Z'])
          c.ps.subscribe('Z')
          expectSet(c.ps.subscriptions, ['Z'])
          d.ps.subscribe('Z')
          expectSet(d.ps.subscriptions, ['Z'])
          e.ps.subscribe('Z')
          expectSet(e.ps.subscriptions, ['Z'])
        })

        it('publishes from c', function () {
          this.timeout(30 * 1000)
          let counter = 0

          return new Promise((resolve) => {
            a.ps.on('Z', incMsg)
            b.ps.on('Z', incMsg)
            c.ps.on('Z', incMsg)
            d.ps.on('Z', incMsg)
            e.ps.on('Z', incMsg)

            c.ps.publish('Z', Buffer.from('hey from c'))

            function incMsg (msg) {
              expect(msg.data.toString()).to.equal('hey from c')
              check()
            }

            function check () {
              if (++counter === 5) {
                a.ps.removeListener('Z', incMsg)
                b.ps.removeListener('Z', incMsg)
                c.ps.removeListener('Z', incMsg)
                d.ps.removeListener('Z', incMsg)
                e.ps.removeListener('Z', incMsg)
                resolve()
              }
            }
          })
        })
      })
    }
  })

  describe('only some nodes subscribe the networks', () => {
    describe('line', () => {
      // line
      // ◉────◎────◉
      // a    b    c

      before((done) => {})
      after((done) => {})
    })

    describe('1 level tree', () => {
      // 1 level tree
      //     ┌◉┐
      //     │b│
      //   ◎─┘ └─◉
      //   a     c

      before((done) => {})
      after((done) => {})
    })

    describe('2 level tree', () => {
      // 2 levels tree
      //      ┌◉┐
      //      │c│
      //   ┌◎─┘ └─◉┐
      //   │b     d│
      // ◉─┘       └─◎
      // a           e

      before((done) => {})
      after((done) => {})
    })
  })
})

async function spawnPubSubNode () {
  const node = await createNode()
  const ps = new FloodSub(node, { emitSelf: true })

  await ps.start()
  return {
    libp2p: node,
    ps: ps
  }
}
