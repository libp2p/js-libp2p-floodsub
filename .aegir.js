'use strict'

const pull = require('pull-stream')
const WebSocketStarRendezvous = require('libp2p-websocket-star-rendezvous')

const Node = require('./test/utils/nodejs-bundle.js')
const {
  getPeerRelay,
  WS_RENDEZVOUS_MULTIADDR
} = require('./test/utils/constants')

let wsRendezvous
let node

const before = async () => {
  [wsRendezvous, node] = await Promise.all([
    WebSocketStarRendezvous.start({
      port: WS_RENDEZVOUS_MULTIADDR.nodeAddress().port,
      refreshPeerListIntervalMS: 1000,
      strictMultiaddr: false,
      cryptoChallenge: true
    }),
    new Promise(async (resolve) => {
      const peerInfo = await getPeerRelay()
      const n = new Node({
        peerInfo,
        config: {
          relay: {
            enabled: true,
            hop: {
              enabled: true,
              active: true
            }
          }
        }
      })

      n.handle('/echo/1.0.0', (_, conn) => pull(conn, conn))
      await n.start()

      resolve(n)
    })
  ])
}

const after = () => {
  return new Promise((resolve) => {
    setTimeout(async () => {
      await Promise.all([
        node.stop(),
        wsRendezvous.stop()
      ])
      resolve()
    }, 2000)
  })
}

module.exports = {
  hooks: {
    pre: before,
    post: after
  }
}
