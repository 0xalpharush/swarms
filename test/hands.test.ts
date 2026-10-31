import assert from 'node:assert/strict'
import test from 'node:test'
import * as Hands from '../src/worker/Hands.ts'

test('a priced hand shows its owner, charges and earnings as the gateway reports them', () => {
  const terms = Hands.terms({
    cap: { operation: null, since: 0, spent: 0.01, usd: 0.015 },
    charges: { count: 2, usd: 0.02 },
    connected: true,
    earned: 0.02,
    name: 'data-room-553b00',
    paid: 0,
    pricing: { describe: 'Q3 data, $0.01 a file', payee: '0x975937feafc6869a260c176854dda8764a78e122' },
    requests: 5,
  })
  assert.deepEqual(terms, {
    charged: '$0.02 for 2 operations',
    earned: '$0.02, $0 paid out',
    price: 'Q3 data, $0.01 a file (paid to 0x9759…e122)',
    requests: 5,
  })
})

test('a free hand on a gateway without pricing shows only its requests', () => {
  assert.deepEqual(Hands.terms({ connected: true, name: 'laptop-1a2b3c', requests: 3 }), { charged: null, earned: null, price: null, requests: 3 })
  assert.deepEqual(Hands.terms(undefined), { charged: null, earned: null, price: null, requests: 0 })
})
