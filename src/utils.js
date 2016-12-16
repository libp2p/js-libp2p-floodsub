'use strict'

const sha1 = require('git-sha1')

exports = module.exports

exports.randomSeqno = () => {
  return sha1((~~(Math.random() * 1e9)).toString(36) + Date.now())
}

exports.msgId = (from, seqno) => {
  return from + seqno
}
/**
 * Check if any member of the first set is also a member
 * of the second set.
 *
 * @param {Set} a
 * @param {Set} b
 * @returns {boolean}
 */
exports.anyMatch = (a, b) => {
  for (let val of a) {
    if (b.has(val)) {
      return true
    }
  }

  return false
}

/**
 * Make everything an array.
 *
 * @param {any} maybeArray
 * @returns {Array}
 */
exports.ensureArray = (maybeArray) => {
  if (!Array.isArray(maybeArray)) {
    return [maybeArray]
  }

  return maybeArray
}
