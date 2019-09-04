'use strict'

const PeerId = require('peer-id')
const PeerInfo = require('peer-info')
const Node = require('./nodejs-bundle')

const waterfall = require('async/waterfall')
const expect = require('chai').expect

exports.first = (map) => map.values().next().value

exports.expectSet = (set, subs) => {
  expect(Array.from(set.values())).to.eql(subs)
}

exports.createNode = () => {
  return new Promise((resolve, reject) => {
    waterfall([
      (cb) => PeerId.create({ bits: 1024 }, cb),
      (id, cb) => PeerInfo.create(id, cb),
      (peerInfo, cb) => {
        cb(null, new Node({ peerInfo }))
      },
      (node, cb) => node.start((err) => cb(err, node))
    ], (err, node) => {
      if (err) {
        return reject(err)
      }

      resolve(node)
    })
  })
}
