'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const values = require('lodash.values')

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

      if (!peers[idB58Str]) {
        peers[idB58Str] = {
          peerInfo: peerInfo,
          topics: new Set(),
          conn: null,
          stream: null
        }
      }

      // process the messages
      pull(
        conn,
        lp.decode(),
        pull.map((data) => pb.rpc.RPC.decode(data)),
        pull.drain((rpc) => {
          log('handling', rpc)
          if (!rpc) {
            return
          }

          const subs = rpc.subscriptions
          const msgs = rpc.msgs

          if (subs && subs.length) {
            handleSubscriptions(rpc.subscriptions, idB58Str)
          }

          if (msgs && msgs.length) {
            handleMessages(rpc.msgs)
          }
        }, (err) => {
          if (err) {
            log.err(err)
          }
          // TODO: delete peer
        })
      )
    })

    function handleSubscriptions (subs, id) {
      const peer = peers[id]

      subs.forEach((subopt) => {
        if (subopt.subscribe) {
          peer.topics.add(subopt.topicCID)
        } else {
          peer.topics.delete(subopt.topicCID)
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
        for (let peer of values(peers)) {
          if (peer.stream &&
              utils.anyMatch(peer.topics, msg.topicCIDs)) {
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
