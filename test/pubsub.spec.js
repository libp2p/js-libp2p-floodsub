/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const { expect } = require('aegir/utils/chai')
const sinon = require('sinon')
const uint8ArrayFromString = require('uint8arrays/from-string')

const PeerId = require('peer-id')
const PeerStreams = require('libp2p-interfaces/src/pubsub/peer-streams')

const { utils } = require('libp2p-interfaces/src/pubsub')
const Floodsub = require('../src')

const { createPeers } = require('./utils/create-peer')

const defOptions = {
  emitSelf: true
}

// TODO: move to base
describe('pubsub', () => {
  let floodsub
  let peer

  before(async () => {
    expect(Floodsub.multicodec).to.exist()

    ;[peer] = await createPeers()
    floodsub = new Floodsub(peer, defOptions)
  })

  beforeEach(() => {
    return floodsub.start()
  })

  afterEach(async () => {
    sinon.restore()
    await floodsub.stop()
    await peer.stop()
  })

  describe('publish', () => {
    it('should emit non normalized messages', async () => {
      sinon.spy(floodsub, '_emitMessage')
      sinon.spy(utils, 'randomSeqno')

      const topic = 'my-topic'
      const message = uint8ArrayFromString('a neat message')

      await floodsub.publish(topic, message)
      expect(floodsub._emitMessage.callCount).to.eql(1)

      const [messageToEmit] = floodsub._emitMessage.getCall(0).args
      expect(messageToEmit).to.eql({
        receivedFrom: peer.peerId.toB58String(),
        from: peer.peerId.toB58String(),
        data: message,
        seqno: utils.randomSeqno.getCall(0).returnValue,
        topicIDs: [topic]
      })
    })

    it('should forward normalized messages', async () => {
      sinon.spy(floodsub, '_forwardMessage')
      sinon.spy(utils, 'randomSeqno')

      const topic = 'my-topic'
      const message = uint8ArrayFromString('a neat message')

      await floodsub.publish(topic, message)
      expect(floodsub._forwardMessage.callCount).to.eql(1)
      const [messageToEmit] = floodsub._forwardMessage.getCall(0).args

      const expected = await floodsub._buildMessage({
        receivedFrom: peer.peerId.toB58String(),
        from: peer.peerId.toBytes(),
        data: message,
        seqno: utils.randomSeqno.getCall(0).returnValue,
        topicIDs: [topic]
      })

      expect(messageToEmit).to.eql(expected)
    })
  })

  describe('validate', () => {
    it('should drop unsigned messages', async () => {
      sinon.spy(floodsub, '_emitMessage')
      sinon.spy(floodsub, '_forwardMessage')
      sinon.spy(floodsub, 'validate')

      const topic = 'my-topic'
      const peerStream = new PeerStreams({ id: await PeerId.create() })
      const rpc = {
        subscriptions: [],
        msgs: [{
          receivedFrom: peerStream.id.toB58String(),
          from: peerStream.id.toBytes(),
          data: uint8ArrayFromString('an unsigned message'),
          seqno: utils.randomSeqno(),
          topicIDs: [topic]
        }]
      }

      floodsub._processRpc(peerStream.id.toB58String(), peerStream, rpc)

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(floodsub.validate.callCount).to.eql(1)
          expect(floodsub._emitMessage.called).to.eql(false)
          expect(floodsub._forwardMessage.called).to.eql(false)

          resolve()
        }, 50)
      })
    })

    it('should not drop unsigned messages if strict signing is disabled', async () => {
      sinon.spy(floodsub, '_emitMessage')
      sinon.spy(floodsub, '_forwardMessage')
      sinon.spy(floodsub, 'validate')
      sinon.stub(floodsub, 'strictSigning').value(false)

      const topic = 'my-topic'
      const peerStream = new PeerStreams({ id: await PeerId.create() })
      const rpc = {
        subscriptions: [],
        msgs: [{
          from: peerStream.id.toBytes(),
          data: uint8ArrayFromString('an unsigned message'),
          seqno: utils.randomSeqno(),
          topicIDs: [topic]
        }]
      }

      floodsub._processRpc(peerStream.id.toB58String(), peerStream, rpc)

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(floodsub.validate.callCount).to.eql(1)
          expect(floodsub._emitMessage.called).to.eql(true)
          expect(floodsub._forwardMessage.called).to.eql(true)

          resolve()
        }, 50)
      })
    })
  })
})
