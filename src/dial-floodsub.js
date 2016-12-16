'use strict'

const lp = require('pull-length-prefixed')
const pull = require('pull-stream')
const Pushable = require('pull-pushable')

const config = require('./config')
const pb = require('./message')

const log = config.log
const multicodec = config.multicodec

module.exports = (libp2p, peers, subscriptions) => {
  return (peerInfo) => {
    const idB58Str = peerInfo.id.toB58String()
    log('dialing %s', idB58Str)

    // If already have a PubSub conn, ignore
    let peer = peers[idB58Str]
    if (peer && peer.conn) {
      return
    }

    libp2p.dialByPeerInfo(peerInfo, multicodec, gotConn)

    function gotConn (err, conn) {
      if (err) {
        return log.err(err)
      }

      // If already had a dial to me, just add the conn
      if (peer) {
        peer.conn = conn
      } else {
        peer = {
          conn: conn,
          peerInfo: peerInfo,
          topics: new Set(),
          stream: null
        }
      }

      peer.stream = new Pushable()

      peers[idB58Str] = peer

      pull(
        peer.stream,
        lp.encode(),
        conn
      )

      // Immediately send my own subscriptions to the newly established conn
      if (subscriptions.size > 0) {
        const subs = []
        for (let topic of subscriptions) {
          subs.push({
            subscribe: true,
            topicCID: topic
          })
        }

        const rpc = pb.rpc.RPC.encode({
          subscriptions: subs
        })

        if (peer && peer.stream) {
          peer.stream.push(rpc)
        }
      }
    }
  }
}
