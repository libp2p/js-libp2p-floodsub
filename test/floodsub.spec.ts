/* eslint-env mocha */

import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { sha256 } from 'multiformats/hashes/sha2'
import { Message, PubSubRPC, StrictNoSign } from '@libp2p/interface-pubsub'
import { PeerStreams } from '@libp2p/pubsub/peer-streams'
import { FloodSub, multicodec } from '../src/index.js'
import { createEd25519PeerId } from '@libp2p/peer-id-factory'
import { mockRegistrar } from '@libp2p/interface-mocks'
import pWaitFor from 'p-wait-for'
import { PeerSet } from '@libp2p/peer-collections'

const topic = 'my-topic'
const message = uint8ArrayFromString('a neat message')

describe('floodsub', () => {
  let floodsub: FloodSub

  before(async () => {
    expect(multicodec).to.exist()

    floodsub = new FloodSub({
      peerId: await createEd25519PeerId(),
      registrar: mockRegistrar()
    }, {
      emitSelf: true,
      globalSignaturePolicy: StrictNoSign
    })
  })

  beforeEach(async () => {
    await floodsub.start()
  })

  afterEach(async () => {
    sinon.restore()
    await floodsub.stop()
  })

  it('checks cache when processing incoming message', async function () {
    const otherPeer = await createEd25519PeerId()
    const sig = await sha256.encode(message)
    const key = uint8ArrayToString(sig, 'base64')
    let callCount = 0

    const peerStream = new PeerStreams({
      id: otherPeer,
      protocol: 'test'
    })
    const rpc: PubSubRPC = {
      subscriptions: [],
      messages: [{
        from: otherPeer.multihash.bytes,
        data: message,
        topic
      }]
    }

    floodsub.subscribe(topic)
    floodsub.addEventListener('message', (evt) => {
      if (evt.detail.topic === topic) {
        callCount++
      }
    })

    // the message should not be in the cache
    expect(floodsub.seenCache.has(key)).to.be.false()

    // receive the message once
    await floodsub.processRpc(peerStream.id, peerStream, rpc)
    await floodsub.queue.onIdle()

    // should have received the message
    expect(callCount).to.equal(1)

    // should be in the cache now
    expect(floodsub.seenCache.has(key)).to.be.true()

    // receive the message multiple times
    await floodsub.processRpc(peerStream.id, peerStream, rpc)
    await floodsub.processRpc(peerStream.id, peerStream, rpc)
    await floodsub.processRpc(peerStream.id, peerStream, rpc)

    // should only have emitted the message once
    expect(callCount).to.equal(1)
  })

  it('forwards normalized messages on publish', async () => {
    const spy = sinon.spy(floodsub, 'send')

    const otherPeer = await createEd25519PeerId()

    floodsub.getSubscribers = () => {
      return [otherPeer]
    }

    expect(floodsub.send).to.have.property('callCount', 0)
    await floodsub.publish(topic, message)

    await pWaitFor(async () => spy.callCount === 1)

    const [to, rpc] = spy.getCall(0).args

    const expected: Message = {
      type: 'unsigned',
      data: message,
      topic
    }

    expect(to).to.eql(otherPeer)
    expect(rpc).to.have.nested.property('messages[0]').that.containSubset(expected)
  })

  it('does not send received message back to original sender', async () => {
    sinon.spy(floodsub, 'sendRpc')

    const sender = await createEd25519PeerId()

    const peerStream = new PeerStreams({
      id: sender,
      protocol: 'test'
    })
    const rpc: PubSubRPC = {
      subscriptions: [],
      messages: [{
        from: sender.multihash.bytes,
        data: message,
        topic
      }]
    }

    // otherPeer is subscribed to the topic
    const peerSet = new PeerSet()
    peerSet.add(sender)
    floodsub.topics.set(topic, peerSet)

    // receive the message
    await floodsub.processRpc(peerStream.id, peerStream, rpc)

    // should not forward back to the sender
    expect(floodsub.sendRpc).to.have.property('called', false)
  })
})
