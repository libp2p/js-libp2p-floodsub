/* eslint-env mocha */
'use strict'

const expect = require('chai').expect

const utils = require('../src/utils')

describe('utils', () => {
  it('anyMatch', () => {
    [
      [[1, 2, 3], [4, 5, 6], false],
      [[1, 2], [1, 2], true],
      [[1, 2, 3], [4, 5, 1], true],
      [[5, 6, 1], [1, 2, 3], true],
      [[], [], false],
      [[1], [2], false]
    ].forEach((test) => {
      expect(
        utils.anyMatch(new Set(test[0]), new Set(test[1]))
      ).to.be.eql(
        test[2]
      )

      expect(
        utils.anyMatch(new Set(test[0]), test[1])
      ).to.be.eql(
        test[2]
      )
    })
  })

  it('ensureArray', () => {
    expect(utils.ensureArray('hello')).to.be.eql(['hello'])
    expect(utils.ensureArray([1, 2])).to.be.eql([1, 2])
  })
})
