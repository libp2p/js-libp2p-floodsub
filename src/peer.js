'use strict'

/**
 * The known state of a connected peer.
 */
class Peer {
  constructor (info, conn, topics) {
    this.info = info
    this.conn = conn
    this.topics = this.topics || new Set()
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

  write (msg) {
    if (!this.isWritable) {
      const id = this.info.id.toB58String()
      throw new Error('No writable connection to ' + id)
    }

    return this.stream.push(msg)
  }
}

module.exports = Peer
