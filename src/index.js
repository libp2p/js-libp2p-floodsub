'use strict'

const EventEmitter = require('events').EventEmitter
const TimeCache = require('time-cache')
const values = require('lodash.values')
const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const Pushable = require('pull-pushable')

const Peer = require('./peer')
const utils = require('./utils')
const pb = require('./message')
const config = require('./config')

const log = config.log
const multicodec = config.multicodec
const ensureArray = utils.ensureArray

/**
 * PubSubGossip, also known as pubsub-flood or just dumbsub,
 * this implementation of pubsub focused on delivering an API * for Publish/Subscribe, but with no CastTree Forming
 * (it just floods the network).
 */
class PubSubGossip extends EventEmitter {
  /**
   * @param {Object} libp2p
   * @param {Object} dagService
   * @returns {PubSubGossip}
   */
  constructor (libp2p, dagService) {
    super()

    this.dag = dagService
    this.libp2p = libp2p
    this.cache = new TimeCache()

    // Map of peerIdBase58Str: { conn, topics, peerInfo }
    this.peers = new Map()

    // List of our subscriptions
    this.subscriptions = new Set()

    const onConnection = this._onConnection.bind(this)
    this.libp2p.handle(multicodec, onConnection)

    // Speed up any new peer that comes in my way
    this.libp2p.swarm.on('peer-mux-established', (p) => {
      this._dialPeer(p)
    })

    // Dial already connected peers
    values(this.libp2p.peerBook.getAll()).forEach((p) => {
      this._dialPeer(p)
    })
  }

  _dialPeer (peerInfo) {
    const idB58Str = peerInfo.id.toB58String()
    log('dialing %s', idB58Str)

    // If already have a PubSub conn, ignore
    const peer = this.peers.get(idB58Str)
    if (peer && peer.isConnected) {
      return
    }

    this.libp2p.dialByPeerInfo(peerInfo, multicodec, (err, conn) => {
      if (err) {
        return log.err(err)
      }

      this._onDial(peerInfo, conn)
    })
  }

  _onDial (peerInfo, conn) {
    const idB58Str = peerInfo.id.toB58String()

    // If already had a dial to me, just add the conn
    let peer = this.peers.get(idB58Str)
    if (peer) {
      peer.conn = conn
    } else {
      this.peers.set(idB58Str, new Peer(peerInfo, conn))
      peer = this.peers.get(idB58Str)
    }

    peer.stream = new Pushable()

    pull(
      peer.stream,
      lp.encode(),
      conn
    )

    // Immediately send my own subscriptions to the newly established conn
    if (this.subscriptions.size > 0 && peer.stream) {
      this._sendSubscriptions(peer)
    }
  }

  _sendSubscriptions (peer) {
    const subs = []
    this.subscriptions.forEach((topic) => {
      subs.push({
        subscribe: true,
        topicCID: topic
      })
    })

    peer.write(pb.rpc.RPC.encode({
      subscriptions: subs
    }))
  }

  _onConnection (protocol, conn) {
    conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incomming conn', err)
        return pull(pull.empty(), conn)
      }

      const idB58Str = peerInfo.id.toB58String()

      if (!this.peers.has(idB58Str)) {
        log('new peer', idB58Str)
        this.peers.set(idB58Str, new Peer(peerInfo))
      }

      this._processConnection(idB58Str, conn)
    })
  }

  _processConnection (idB58Str, conn) {
    pull(
      conn,
      lp.decode(),
      pull.map((data) => pb.rpc.RPC.decode(data)),
      pull.drain(
        (rpc) => this._onRpc(idB58Str, rpc),
        (err) => this._onConnectionEnd(err)
      )
    )
  }

  _onRpc (idB58Str, rpc) {
    log('handling', rpc)
    if (!rpc) {
      return
    }

    const subs = rpc.subscriptions
    const msgs = rpc.msgs

    if (subs && subs.length) {
      this._handleRpcSubscriptions(rpc.subscriptions, idB58Str)
    }

    if (msgs && msgs.length) {
      this._handleRpcMessages(rpc.msgs)
    }
  }

  _handleRpcSubscriptions (subscriptions, idB58Str) {
    const peer = this.peers.get(idB58Str)
    subscriptions.forEach((subopt) => {
      if (subopt.subscribe) {
        peer.topics.add(subopt.topicCID)
      } else {
        peer.topics.delete(subopt.topicCID)
      }
    })
  }

  _handleRpcMessages (msgs) {
    msgs.forEach((msg) => {
      const seqno = utils.msgId(msg.from, msg.seqno.toString())
      // 1. check if I've seen the message, if yes, ignore
      if (this.cache.has(seqno)) {
        return
      }

      this.cache.put(seqno)

      // 2. emit to self
      msg.topicCIDs.forEach((topic) => {
        if (this.subscriptions.has(topic)) {
          this.emit(topic, msg.data)
        }
      })

      // 3. propagate msg to others
      this.peers.forEach((peer) => {
        if (peer.isWritable &&
            utils.anyMatch(peer.topics, msg.topicCIDs)) {
          peer.write(pb.rpc.RPC.encode({
            msgs: [msg]
          }))
        }
      })
    })
  }

  _onConnectionEnd (idB58Str, err) {
    // socket hang up, means the one side canceled
    if (err && err.message !== 'socket hang up') {
      log.err(err)
    }

    this.peers.delete(idB58Str)
  }

  publish (topics, messages) {
    log('publish', topics, messages)

    topics = ensureArray(topics)
    messages = ensureArray(messages)

    // Emit to self if I'm interested
    topics
      .filter((topic) => this.subscriptions.has(topic))
      .forEach((topic) => {
        messages.forEach((message) => {
          this.emit(topic, message)
        })
      })

    const from = this.libp2p.peerInfo.id.toB58String()

    const buildMessage = (msg) => {
      const seqno = utils.randomSeqno()
      this.cache.put(utils.msgId(from, seqno))

      return {
        from: from,
        data: msg,
        seqno: new Buffer(seqno),
        topicCIDs: topics
      }
    }

    // send to all the other peers
    this.peers.forEach((peer) => {
      if (!utils.anyMatch(peer.topics, topics)) {
        return
      }

      peer.write(pb.rpc.RPC.encode({
        msgs: messages.map(buildMessage)
      }))

      log('publish msgs on topics', topics, peer.info.id.toB58String())
    })
  }

  /**
   * Subscribe to the given topic(s).
   *
   * @param {Array<string>|string} topics
   * @returns {undefined}
   */
  subscribe (topics) {
    topics = ensureArray(topics)

    topics.forEach((topic) => {
      this.subscriptions.add(topic)
    })

    const buildSubscription = (topic) => {
      return {
        subscribe: true,
        topicCID: topic
      }
    }

    this.peers.forEach((peer) => {
      peer.write(pb.rpc.RPC.encode({
        subscriptions: topics.map(buildSubscription)
      }))
    })
  }

  /**
   * Unsubscribe from the given topic(s).
   *
   * @param {Array<string>|string} topics
   * @returns {undefined}
   */
  unsubscribe (topics) {
    topics = ensureArray(topics)

    topics.forEach((topic) => {
      this.subscriptions.delete(topic)
    })

    const buildUnsubscription = (topic) => {
      return {
        subscribe: false,
        topicCID: topic
      }
    }

    this.peers.forEach((peer) => {
      peer.write(pb.rpc.RPC.encode({
        subscriptions: topics.map(buildUnsubscription)
      }))
    })
  }
}

module.exports = PubSubGossip
