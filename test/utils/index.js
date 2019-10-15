'use strict'

const PeerId = require('peer-id')
const PeerInfo = require('peer-info')

const { expect } = require('chai')

exports.first = (map) => map.values().next().value

exports.expectSet = (set, subs) => {
  expect(Array.from(set.values())).to.eql(subs)
}

exports.createPeerInfo = async () => {
  const peerId = await PeerId.create({ bits: 1024 })

  return PeerInfo.create(peerId)
}

exports.mockRegistrar = {
  register: (multicodecs, handlers) => {

  },
  unregister: (multicodecs) => {

  }
}
