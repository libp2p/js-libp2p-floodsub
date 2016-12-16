'use strict'

const EventEmitter = require('events').EventEmitter
const TimeCache = require('time-cache')
const values = require('lodash.values')

const utils = require('./utils')
const pb = require('./message')
const config = require('./config')
const dialOnFloodSub = require('./dial-floodsub.js')
const mountFloodSub = require('./mount-floodsub.js')

const log = config.log
const ensureArray = utils.ensureArray

class PubSubGossip extends EventEmitter {
  constructor (libp2pNode, dagService) {
    super()

    this.dag = dagService
    this.libp2p = libp2pNode
    this.cache = new TimeCache()

    // Map of peerIdBase58Str: { conn, topics, peerInfo }
    this.peers = {}

    // List of our subscriptions
    this.subscriptions = new Set()

    const dial = dialOnFloodSub(
      this.libp2p, this.peers, this.subscriptions
    )
    mountFloodSub(
      this.libp2p, this.peers, this.cache, this.subscriptions, this
    )

    // Speed up any new peer that comes in my way
    this.libp2p.swarm.on('peer-mux-established', dial)

    // Dial already connected peers
    values(
      libp2pNode.peerBook.getAll()
    ).forEach(dial)
  }

  publish (topics, messages) {
    log('publish', topics, messages)

    topics = ensureArray(topics)
    messages = ensureArray(messages)

    // emit to self if I'm interested
    topics.forEach((topic) => {
      if (this.subscriptions.has(topic)) {
        messages.forEach((message) => {
          this.emit(topic, message)
        })
      }
    })

    const from = this.libp2p.peerInfo.id.toB58String()

    // send to all the other peers
    for (let peer of values(this.peers)) {
      log(peer.topics, topics)

      if (utils.anyMatch(peer.topics, topics)) {
        const msgs = messages.map((message) => {
          const seqno = utils.randomSeqno()
          this.cache.put(utils.msgId(from, seqno))

          return {
            from: from,
            data: message,
            seqno: new Buffer(seqno),
            topicCIDs: topics
          }
        })

        const rpc = pb.rpc.RPC.encode({
          msgs: msgs
        })

        peer.stream.push(rpc)
        log('publish msgs on topics', topics, peer.peerInfo.id.toB58String())
      }
    }
  }

  subscribe (topics) {
    topics = ensureArray(topics)

    topics.forEach((topic) => {
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.add(topic)
      }
    })

    for (let peer of values(this.peers)) {
      const subopts = topics.map((topic) => {
        return {
          subscribe: true,
          topicCID: topic
        }
      })

      const rpc = pb.rpc.RPC.encode({
        subscriptions: subopts
      })

      peer.stream.push(rpc)
    }
  }

  unsubscribe (topics) {
    topics = ensureArray(topics)

    topics.forEach((topic) => {
      this.subscriptions.delete(topic)
    })

    for (let peer of values(this.peers)) {
      const subopts = topics.map((topic) => {
        return {
          subscribe: false,
          topicCID: topic
        }
      })
      const rpc = pb.rpc.RPC.encode({
        subscriptions: subopts
      })

      peer.stream.push(rpc)
    }
  }

  // TODO: remove usage in tests
  getPeerSet () {
    return this.peers
  }

  // TODO: remove usage in tests
  getSubscriptions () {
    return Array.from(this.subscriptions)
  }
}

module.exports = PubSubGossip
