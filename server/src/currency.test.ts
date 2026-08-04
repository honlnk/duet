/**
 * currency.ts 单元测试：货币选举 + 跨币种换算
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickDisplayCurrency,
  convertCurrency,
  DEFAULT_DISPLAY_CURRENCY,
} from './utils/currency.js'

/** 测试用汇率表（各货币对 USD 的比率） */
const RATES = { USD: 1, CNY: 7.1, EUR: 0.92 }

/* ----------------------- pickDisplayCurrency ----------------------- */

test('pickDisplayCurrency：多数货币胜出（2 USD vs 1 CNY → USD）', () => {
  assert.equal(pickDisplayCurrency(['CNY', 'USD', 'USD']), 'USD')
})

test('pickDisplayCurrency：多数货币胜出（2 CNY vs 1 USD → CNY）', () => {
  assert.equal(pickDisplayCurrency(['CNY', 'CNY', 'USD']), 'CNY')
})

test('pickDisplayCurrency：平票时用 CNY 兜底（CNY vs USD vs EUR）', () => {
  assert.equal(pickDisplayCurrency(['CNY', 'USD', 'EUR']), DEFAULT_DISPLAY_CURRENCY)
})

test('pickDisplayCurrency：2 人平票也用 CNY（CNY vs USD）', () => {
  assert.equal(pickDisplayCurrency(['CNY', 'USD']), DEFAULT_DISPLAY_CURRENCY)
})

test('pickDisplayCurrency：空数组返回 CNY', () => {
  assert.equal(pickDisplayCurrency([]), DEFAULT_DISPLAY_CURRENCY)
})

test('pickDisplayCurrency：单一货币直接返回', () => {
  assert.equal(pickDisplayCurrency(['EUR']), 'EUR')
})

/* ----------------------- convertCurrency ----------------------- */

test('convertCurrency：同币种返回原值', () => {
  assert.equal(convertCurrency(1.5, RATES, 'USD', 'USD'), 1.5)
})

test('convertCurrency：USD → CNY（× 7.1）', () => {
  assert.equal(convertCurrency(1, RATES, 'USD', 'CNY'), 7.1)
})

test('convertCurrency：CNY → USD（÷ 7.1）', () => {
  assert.equal(convertCurrency(7.1, RATES, 'CNY', 'USD'), 1)
})

test('convertCurrency：CNY → EUR（先折 USD 再折 EUR）', () => {
  // 7.1 CNY = 1 USD = 0.92 EUR
  assert.equal(convertCurrency(7.1, RATES, 'CNY', 'EUR'), 0.92)
})

test('convertCurrency：汇率表缺失货币时用兜底汇率（7:1）', () => {
  // 只给 USD，CNY 缺失 → 用 FALLBACK 7
  assert.equal(convertCurrency(1, { USD: 1 }, 'USD', 'CNY'), 7)
})

test('convertCurrency：两个未知货币退化为 USD 中转兜底', () => {
  // GBP 和 JPY 都不在汇率表，兜底都视为 USD(rate=1)，结果 = 原值
  assert.equal(convertCurrency(2, { USD: 1 }, 'GBP', 'JPY'), 2)
})
