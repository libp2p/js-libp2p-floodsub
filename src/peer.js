'use strict'

/**
 * The known state of a connected peer.
 */
class Peer {
  constructor (info, conn, topics) {
    /**
     * @type {PeerInfo}
     */
    this.info = info
    /**
     * @type {Connection}
     */
    this.conn = conn
    /**
     * @type {Set}
     */
    this.topics = this.topics || new Set()
    /**
     * @type {Pushable}
     */
    this.stream = null
  }

  /**
   * Is the peer connected currently?
   *
   * @type {boolean}
   */
  get isConnected () {
    return Boolean(this.conn)
  }

  /**
   * Do we have a connection to write on?
   *
   * @type {boolean}
   */
  get isWritable () {
    return Boolean(this.stream)
  }

  /**
   * Send a message to this peer.
   * Throws if there is no `stream` to write to available.
   *
   * @param {Buffer} msg
   * @returns {undefined}
   */
  write (msg) {
    if (!this.isWritable) {
      const id = this.info.id.toB58String()
      throw new Error('No writable connection to ' + id)
    }

    this.stream.push(msg)
  }
}

module.exports = Peer
