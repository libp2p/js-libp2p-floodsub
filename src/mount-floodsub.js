'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')

const pb = require('./message')
const utils = require('./utils')
const config = require('./config')

const log = config.log
const multicodec = config.multicodec

module.exports = mountFloodSub

function mountFloodSub (libp2p, peers, cache, subscriptions, ee) {
  // Note: we don't use the incomming conn to send, just to receive
  libp2p.handle(multicodec, incomingConnection)

  function incomingConnection (protocol, conn) {
    conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incomming conn', err)
        return pull(
          pull.empty(),
          conn
        )
      }

      // populate
      const idB58Str = peerInfo.id.toB58String()

      if (!peers.has(idB58Str)) {
        peers.set(idB58Str, {
          peerInfo: peerInfo,
          topics: new Set(),
          conn: null,
          stream: null
        })
      }

      // process the messages
      pull(
        conn,
        lp.decode(),
        pull.map((data) => pb.rpc.RPC.decode(data)),
        pull.collect((err, res) => {
          if (err) {
            // TODO: remove peer from peers
            return log.err(err)
          }

          if (!res || !res.length) {
            return
          }

          const rpc = res[0]
          const subs = rpc.subscriptions
          const msgs = rpc.msgs

          if (subs && subs.length) {
            handleSubscriptions(rpc.subscriptions, idB58Str)
          }

          if (msgs && msgs.length) {
            handleMessages(rpc.msgs)
          }
        })
      )
    })

    function handleSubscriptions (subs, idB58Str) {
      const peer = peers.get(idB58Str)
      if (!peer) {
        return log.error('peer not found %s', idB58Str)
      }

      subs.forEach((subopt) => {
        if (subopt.subscribe) {
          peer.topics.push(subopt.topicCID)
        } else {
          peer.topics.delete(subopt)
        }
      })
    }

    function handleMessages (msgs) {
      msgs.forEach((msg) => {
        const seqno = utils.msgId(msg.from, msg.seqno.toString())
        // 1. check if I've seen the message, if yes, ignore
        if (cache.has(seqno)) {
          return
        }

        cache.put(seqno)

        // 2. emit to self
        msg.topicCIDs.forEach((topic) => {
          if (subscriptions.has(topic)) {
            ee.emit(topic, msg.data)
          }
        })

        // 3. propagate msg to others
        for (let peer of peers.values()) {
          if (utils.matchAny(peer.topics, msg.topicCIDs)) {
            const rpc = pb.rpc.RPC.encode({
              msgs: [msg]
            })

            peer.stream.push(rpc)
          }
        }
      })
    }
  }
}
