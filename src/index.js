'use strict'

const debug = require('debug')
const debugName = 'libp2p:floodsub'
const log = debug(debugName)
log.error = debug(`${debugName}:error`)

const pipe = require('it-pipe')
const TimeCache = require('time-cache')
const PeerId = require('peer-id')
const BaseProtocol = require('libp2p-pubsub')
const { message, utils } = require('libp2p-pubsub')
const { multicodec } = require('./config')

const ensureArray = utils.ensureArray

function validateRegistrar (registrar) {
  if (typeof registrar !== 'object') {
    throw new Error('a registrar object is required')
  }

  if (typeof registrar.handle !== 'function') {
    throw new Error('a handle function must be provided in registrar')
  }

  if (typeof registrar.register !== 'function') {
    throw new Error('a register function must be provided in registrar')
  }

  if (typeof registrar.unregister !== 'function') {
    throw new Error('a unregister function must be provided in registrar')
  }
}

/**
 * FloodSub (aka dumbsub is an implementation of pubsub focused on
 * delivering an API for Publish/Subscribe, but with no CastTree Forming
 * (it just floods the network).
 */
class FloodSub extends BaseProtocol {
  /**
   * @param {PeerId} peerId instance of the peer's PeerId
   * @param {Object} registrar
   * @param {function} registrar.handle
   * @param {function} registrar.register
   * @param {function} registrar.unregister
   * @param {Object} [options]
   * @param {boolean} options.emitSelf if publish should emit to self, if subscribed, defaults to false
   * @constructor
   */
  constructor (peerId, registrar, options = {}) {
    if (!PeerId.isPeerId(peerId)) {
      throw new Error('peerId must be an instance of `peer-id`')
    }

    validateRegistrar(registrar)

    super({
      debugName: debugName,
      multicodecs: multicodec,
      peerId: peerId,
      registrar: registrar,
      ...options
    })

    /**
     * List of our subscriptions
     * @type {Set<string>}
     */
    this.subscriptions = new Set()

    /**
     * Cache of seen messages
     *
     * @type {TimeCache}
     */
    this.seenCache = new TimeCache()

    /**
     * Pubsub options
     */
    this._options = {
      emitSelf: false,
      ...options
    }

    this._processRpc = this._processRpc.bind(this)
  }

  /**
   * Peer connected successfully with pubsub protocol.
   * @override
   * @param {PeerId} peerId peer id
   * @param {Connection} conn connection to the peer
   * @returns {Promise<void>}
   */
  async _onPeerConnected (peerId, conn) {
    await super._onPeerConnected(peerId, conn)
    const idB58Str = peerId.toB58String()
    // Immediately send my own subscriptions to the newly established conn
    this._sendSubscriptions(idB58Str, Array.from(this.subscriptions), true)
  }

  /**
   * Overriding the implementation of _processConnection should keep the connection and is
   * responsible for processing each RPC message received by other peers.
   * @override
   * @param {string} idB58Str peer id string in base58
   * @param {DuplexIterableStream} stream inbound stream
   * @param {PeerStreams} peerStreams PubSub peer
   * @returns {void}
   *
   */
  async _processMessages (idB58Str, stream, peerStreams) {
    const onRpcFunc = this._processRpc
    try {
      await pipe(
        stream,
        async function (source) {
          for await (const data of source) {
            const rpc = data instanceof Uint8Array ? data : data.slice()

            onRpcFunc(idB58Str, message.rpc.RPC.decode(rpc))
          }
        }
      )
    } catch (err) {
      this._onPeerDisconnected(peerStreams.id, err)
    }
  }

  /**
   * Called for each RPC call received from the given peer
   * @private
   * @param {string} idB58Str b58 string PeerId of the connected peer
   * @param {rpc.RPC} rpc The pubsub RPC message
   */
  _processRpc (idB58Str, rpc) {
    if (!rpc) {
      return
    }

    log('rpc from', idB58Str)
    const subs = rpc.subscriptions
    const msgs = rpc.msgs

    if (subs && subs.length) {
      subs.forEach(sub => this._processRpcSubOpt(idB58Str, sub))
      this.emit('floodsub:subscription-change', PeerId.createFromB58String(idB58Str), subs)
    }

    if (msgs && msgs.length) {
      msgs.forEach((msg) => this._processRpcMessage(msg))
    }
  }

  /**
   * Handles an subscription change from a peer
   *
   * @param {string} id
   * @param {RPC.SubOpt} subOpt
   */
  _processRpcSubOpt (id, subOpt) {
    const t = subOpt.topicID

    let topicSet = this.topics.get(t)
    if (!topicSet) {
      topicSet = new Set()
      this.topics.set(t, topicSet)
    }

    if (subOpt.subscribe) {
      // subscribe peer to new topic
      topicSet.add(id)
    } else {
      // unsubscribe from existing topic
      topicSet.delete(id)
    }
  }

  /**
   * @private
   * @param {rpc.RPC.Message} message The message to process
   * @returns {void}
   */
  async _processRpcMessage (message) {
    const msg = utils.normalizeInRpcMessage(message)
    const seqno = utils.msgId(msg.from, msg.seqno)

    // 1. check if I've seen the message, if yes, ignore
    if (this.seenCache.has(seqno)) {
      return
    }

    this.seenCache.put(seqno)

    // 2. validate the message (signature verification)
    try {
      await this.validate(message)
    } catch (err) {
      log('Message is not valid, dropping it.', err)
      return
    }

    // 3. if message is valid, emit to self
    this._emitMessages(msg.topicIDs, [msg])

    // 4. if message is valid, propagate msg to others
    this._forwardMessages(msg.topicIDs, [msg])
  }

  _emitMessages (topics, messages) {
    topics.forEach((topic) => {
      if (!this.subscriptions.has(topic)) {
        return
      }

      messages.forEach((message) => {
        this.emit(topic, message)
      })
    })
  }

  _forwardMessages (topics, messages) {
    topics.forEach((topic) => {
      const peers = this.topics.get(topic)
      if (!peers) {
        return
      }
      peers.forEach((id) => {
        log('publish msgs on topics', topics, id)
        this._sendRpc(id, { msgs: messages.map(utils.normalizeOutRpcMessage) })
      })
    })
  }

  /**
   * Unmounts the floodsub protocol and shuts down every connection
   * @override
   * @returns {Promise<void>}
   */
  async stop () {
    await super.stop()

    this.subscriptions = new Set()
  }

  /**
   * Publish messages to the given topics.
   * @override
   * @param {Array<string>|string} topics
   * @param {Buffer} message
   * @returns {Promise<void>}
   */
  async publish (topics, message) {
    if (!this.started) {
      throw new Error('FloodSub is not started')
    }

    topics = ensureArray(topics)
    log('publish', topics, message)

    const from = this.peerId.toB58String()
    const seqno = utils.randomSeqno()
    this.seenCache.put(utils.msgId(from, seqno))

    const msgObject = {
      from,
      data: message,
      seqno,
      topicIDs: topics
    }

    // Emit to self if I'm interested and it is enabled
    this._options.emitSelf && this._emitMessages(topics, [msgObject])

    // Normalize message to send
    const normalizedMessage = await this._buildMessage(msgObject)

    // send to all the other peers
    this._forwardMessages(topics, [normalizedMessage])
  }

  /**
   * Subscribe to the given topic(s).
   * @override
   * @param {Array<string>|string} topics
   * @returns {void}
   */
  subscribe (topics) {
    if (!this.started) {
      throw new Error('FloodSub is not started')
    }

    topics = ensureArray(topics)
    topics.forEach((topic) => this.subscriptions.add(topic))

    this.peers.forEach((_, id) => this._sendSubscriptions(id, topics, true))
  }

  /**
   * Unsubscribe from the given topic(s).
   * @override
   * @param {Array<string>|string} topics
   * @returns {void}
   */
  unsubscribe (topics) {
    if (!this.started) {
      throw new Error('FloodSub is not started')
    }

    topics = ensureArray(topics)

    topics.forEach((topic) => this.subscriptions.delete(topic))

    this.peers.forEach((_, id) => this._sendSubscriptions(id, topics, false))
  }

  /**
   * Get the list of topics which the peer is subscribed to.
   * @override
   * @returns {Array<String>}
   */
  getTopics () {
    if (!this.started) {
      throw new Error('FloodSub is not started')
    }

    return Array.from(this.subscriptions)
  }

  /**
   * Encode an rpc object to a buffer
   * @param {RPC} rpc
   * @returns {Buffer}
   */
  _encodeRpc (rpc) {
    return message.rpc.RPC.encode(rpc)
  }

  /**
   * Send an rpc object to a peer
   * @param {string} id peer id
   * @param {RPC} rpc
   * @returns {void}
   */
  _sendRpc (id, rpc) {
    const peerStreams = this.peers.get(id)
    if (!peerStreams || !peerStreams.isWritable) {
      return
    }
    peerStreams.write(this._encodeRpc(rpc))
  }

  /**
   * Send subscroptions to a peer
   * @param {string} id peer id
   * @param {string[]} topics
   * @param {boolean} subscribe set to false for unsubscriptions
   * @returns {void}
   */
  _sendSubscriptions (id, topics, subscribe) {
    return this._sendRpc(id, {
      subscriptions: topics.map(t => ({ topicID: t, subscribe: subscribe }))
    })
  }
}

module.exports = FloodSub
module.exports.multicodec = multicodec
