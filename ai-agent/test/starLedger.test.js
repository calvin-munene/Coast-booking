import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StarLedgerConflictError,
  StarLedgerValidationError,
  createStarLedger,
  normalizeStarAmount,
  normalizeTelegramUserId,
} from '../src/starLedger.js';

function tagOf(sql) {
  const text = String(sql).trim();
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return text;
  return text.match(/star-ledger:([a-z-]+)/)?.[1] ?? text;
}

function result(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

class ScriptedPool {
  constructor(steps = []) {
    this.steps = [...steps];
    this.schemaCalls = 0;
    this.releaseCalls = 0;
    this.endCalls = 0;
  }

  async execute(sql, params) {
    const tag = tagOf(sql);
    if (tag === 'schema') {
      this.schemaCalls += 1;
      return result();
    }
    const step = this.steps.shift();
    assert.ok(step, `unexpected query ${tag}`);
    assert.equal(tag, step.tag);
    if (step.params !== undefined) assert.deepEqual(params, step.params);
    if (step.error) throw step.error;
    return step.result ?? result();
  }

  query(sql, params) {
    return this.execute(sql, params);
  }

  async connect() {
    return {
      query: (sql, params) => this.execute(sql, params),
      release: () => {
        this.releaseCalls += 1;
      },
    };
  }

  async end() {
    this.endCalls += 1;
  }

  assertDone() {
    assert.deepEqual(this.steps, []);
  }
}

test('normalizes Telegram BIGINT ids without losing precision', () => {
  assert.equal(normalizeTelegramUserId('9007199254740993'), '9007199254740993');
  assert.equal(normalizeTelegramUserId(6_643_462_826), '6643462826');
  assert.equal(normalizeTelegramUserId(9_223_372_036_854_775_807n), '9223372036854775807');
  assert.throws(() => normalizeTelegramUserId(Number.MAX_SAFE_INTEGER + 1), StarLedgerValidationError);
  assert.throws(() => normalizeTelegramUserId('9223372036854775808'), /BIGINT range/);
  assert.throws(() => normalizeTelegramUserId('0'), /positive integer/);
});

test('accepts only integer Star amounts from 1 through 10000', () => {
  assert.equal(normalizeStarAmount(1), 1);
  assert.equal(normalizeStarAmount('10000'), 10_000);
  assert.equal(normalizeStarAmount(2n), 2);
  for (const invalid of [0, 10_001, -1, 1.5, '1.5', '01x', null, undefined]) {
    assert.throws(() => normalizeStarAmount(invalid), StarLedgerValidationError);
  }
});

test('initializes lazily once and preserves BIGINT balance as a decimal string', async () => {
  const pool = new ScriptedPool([
    {
      tag: 'get-balance',
      params: ['9007199254740993'],
      result: result([{ balance: '9007199254740995' }]),
    },
    {
      tag: 'get-balance',
      params: ['9007199254740993'],
      result: result([{ balance: '9007199254740995' }]),
    },
  ]);
  const ledger = createStarLedger({ pool });

  assert.deepEqual(await ledger.getBalance('9007199254740993'), {
    userId: '9007199254740993',
    balance: '9007199254740995',
  });
  await ledger.getBalance('9007199254740993');

  assert.equal(pool.schemaCalls, 1);
  pool.assertDone();
  await ledger.close();
  assert.equal(pool.endCalls, 0, 'an injected shared pool is not owned by the ledger');
});

test('credits a Telegram payment exactly once and rejects charge-id collisions', async () => {
  const payment = {
    userId: '6643462826',
    amount: 10,
    telegramPaymentChargeId: 'charge-1',
    invoicePayload: 'signed-payload',
  };
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-1'] },
    { tag: 'ensure-account' },
    { tag: 'insert-payment', result: result([{ telegram_payment_charge_id: 'charge-1' }]) },
    { tag: 'credit-account' },
    { tag: 'get-balance-client', result: result([{ balance: '10' }]) },
    { tag: 'COMMIT' },
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-1'] },
    { tag: 'ensure-account' },
    { tag: 'insert-payment', result: result([], 0) },
    {
      tag: 'get-payment',
      result: result([{ user_id: '6643462826', amount: 10, currency: 'XTR' }]),
    },
    { tag: 'get-balance-client', result: result([{ balance: '10' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });

  const first = await ledger.creditPayment(payment);
  const duplicate = await ledger.creditPayment(payment);
  assert.equal(first.credited, true);
  assert.equal(first.balance, '10');
  assert.equal(duplicate.credited, false);
  assert.equal(duplicate.balance, '10');
  assert.equal(pool.releaseCalls, 2);
  pool.assertDone();
});

test('rolls back a conflicting reuse of a Telegram payment charge id', async () => {
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['collision'] },
    { tag: 'ensure-account' },
    { tag: 'insert-payment', result: result([], 0) },
    {
      tag: 'get-payment',
      result: result([{ user_id: '999', amount: 2, currency: 'XTR' }]),
    },
    { tag: 'ROLLBACK' },
  ]);
  const ledger = createStarLedger({ pool });
  await assert.rejects(
    ledger.creditPayment({
      userId: '123',
      amount: 2,
      telegramPaymentChargeId: 'collision',
    }),
    StarLedgerConflictError,
  );
  pool.assertDone();
});

test('records a refund once and never drives the balance below zero', async () => {
  const creditedAt = new Date('2026-07-14T12:00:00.000Z');
  const refundedAt = new Date('2026-07-14T13:00:00.000Z');
  const unrefundedPayment = {
    telegram_payment_charge_id: 'charge-refund',
    user_id: '6643462826',
    amount: 10,
    currency: 'XTR',
    invoice_payload: 'payload',
    credited_at: creditedAt,
    refunded_at: null,
    refunded_amount: null,
  };
  const refundedPayment = {
    ...unrefundedPayment,
    refunded_at: refundedAt,
    refunded_amount: 10,
  };
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-refund'] },
    { tag: 'get-payment-for-refund', result: result([unrefundedPayment]) },
    { tag: 'get-account-for-refund', result: result([{ balance: '3' }]) },
    { tag: 'deduct-refund' },
    {
      tag: 'mark-payment-refunded',
      result: result([{ refunded_at: refundedAt, refunded_amount: 10 }]),
    },
    { tag: 'COMMIT' },
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-refund'] },
    { tag: 'get-payment-for-refund', result: result([refundedPayment]) },
    { tag: 'get-account-for-refund', result: result([{ balance: '0' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });

  const first = await ledger.recordRefund({
    telegramPaymentChargeId: 'charge-refund',
    userId: '6643462826',
    amount: 10,
  });
  assert.equal(first.changed, true);
  assert.equal(first.balance, '0');
  assert.equal(first.deductedAmount, '3');
  assert.equal(first.payment.refundedAmount, 10);

  const duplicate = await ledger.recordRefund({ telegramPaymentChargeId: 'charge-refund' });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.balance, '0');
  assert.equal(duplicate.deductedAmount, '0');
  pool.assertDone();
});

test('an out-of-order refund prevents a later payment delivery from minting credits', async () => {
  const recordedAt = new Date('2026-07-14T13:00:00.000Z');
  const refundedPayment = {
    user_id: '123',
    amount: 5,
    currency: 'XTR',
    refunded_at: recordedAt,
  };
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-out-of-order'] },
    { tag: 'get-payment-for-refund', result: result([], 0) },
    { tag: 'ensure-account' },
    {
      tag: 'insert-refunded-payment',
      params: ['charge-out-of-order', '123', 5],
      result: result([{
        credited_at: recordedAt,
        refunded_at: recordedAt,
        refunded_amount: 5,
      }]),
    },
    { tag: 'get-balance-client', result: result([{ balance: '0' }]) },
    { tag: 'COMMIT' },
    { tag: 'BEGIN' },
    { tag: 'lock-payment-charge', params: ['charge-out-of-order'] },
    { tag: 'ensure-account' },
    { tag: 'insert-payment', result: result([], 0) },
    { tag: 'get-payment', result: result([refundedPayment]) },
    { tag: 'get-balance-client', result: result([{ balance: '0' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });

  const refund = await ledger.recordRefund({
    telegramPaymentChargeId: 'charge-out-of-order',
    userId: '123',
    amount: 5,
  });
  const payment = await ledger.creditPayment({
    telegramPaymentChargeId: 'charge-out-of-order',
    userId: '123',
    amount: 5,
  });

  assert.equal(refund.changed, true);
  assert.equal(refund.pendingPayment, true);
  assert.equal(refund.balance, '0');
  assert.equal(payment.credited, false);
  assert.equal(payment.refunded, true);
  assert.equal(payment.balance, '0');
  pool.assertDone();
});

test('accepts terms idempotently and checks the selected version', async () => {
  const acceptedAt = new Date('2026-07-14T12:00:00.000Z');
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'ensure-account' },
    { tag: 'accept-terms', result: result([{ accepted_at: acceptedAt }]) },
    { tag: 'COMMIT' },
    { tag: 'has-accepted-terms', result: result([{ '?column?': 1 }]) },
    { tag: 'has-accepted-terms', result: result([], 0) },
  ]);
  const ledger = createStarLedger({ pool });

  assert.deepEqual(await ledger.acceptTerms('123', '2026-07'), {
    userId: '123',
    version: '2026-07',
    acceptedAt,
  });
  assert.equal(await ledger.hasAcceptedTerms('123', '2026-07'), true);
  assert.equal(await ledger.hasAcceptedTerms('123', 'old'), false);
  pool.assertDone();
});

test('reserves once, and a duplicate reservation never authorizes inference again', async () => {
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'ensure-account' },
    { tag: 'insert-reservation', result: result([{ reservation_id: 'update-42' }]) },
    { tag: 'debit-account', result: result([{ balance: '4' }]) },
    { tag: 'COMMIT' },
    { tag: 'BEGIN' },
    { tag: 'ensure-account' },
    { tag: 'insert-reservation', result: result([], 0) },
    {
      tag: 'get-reservation-client',
      result: result([{ user_id: '123', cost: 1, status: 'reserved' }]),
    },
    { tag: 'get-balance-client', result: result([{ balance: '4' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });
  const first = await ledger.reservePrompt('123', { reservationId: 'update-42' });
  const duplicate = await ledger.reservePrompt('123', { reservationId: 'update-42' });

  assert.equal(first.reserved, true);
  assert.equal(first.changed, true);
  assert.equal(first.balance, '4');
  assert.equal(duplicate.reserved, false);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.state, 'reserved');
  pool.assertDone();
});

test('does not leave a reservation when balance is insufficient', async () => {
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    { tag: 'ensure-account' },
    { tag: 'insert-reservation', result: result([{ reservation_id: 'no-credit' }]) },
    { tag: 'debit-account', result: result([], 0) },
    { tag: 'delete-reservation' },
    { tag: 'get-balance-client', result: result([{ balance: '0' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });
  const reservation = await ledger.reservePrompt('123', { reservationId: 'no-credit' });
  assert.deepEqual(reservation, {
    reserved: false,
    changed: false,
    reservationId: null,
    userId: '123',
    cost: 1,
    state: null,
    balance: '0',
  });
  pool.assertDone();
});

test('completes and restores prompt reservations idempotently', async () => {
  const pool = new ScriptedPool([
    {
      tag: 'complete-reservation',
      result: result([{ user_id: '123', cost: 1, status: 'completed' }]),
    },
    { tag: 'complete-reservation', result: result([], 0) },
    {
      tag: 'get-reservation',
      result: result([{ user_id: '123', cost: 1, status: 'completed' }]),
    },
    { tag: 'BEGIN' },
    {
      tag: 'get-reservation-client',
      result: result([{ user_id: '456', cost: 1, status: 'reserved' }]),
    },
    { tag: 'restore-reservation' },
    { tag: 'refund-account', result: result([{ balance: '9' }]) },
    { tag: 'COMMIT' },
    { tag: 'BEGIN' },
    {
      tag: 'get-reservation-client',
      result: result([{ user_id: '456', cost: 1, status: 'restored' }]),
    },
    { tag: 'get-balance-client', result: result([{ balance: '9' }]) },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool });

  assert.equal((await ledger.completePrompt('done')).changed, true);
  assert.deepEqual(await ledger.completePrompt('done'), {
    completed: true,
    changed: false,
    reservationId: 'done',
    userId: '123',
    cost: 1,
    state: 'completed',
  });
  const restored = await ledger.restorePrompt('failed');
  assert.equal(restored.changed, true);
  assert.equal(restored.balance, '9');
  const duplicate = await ledger.restorePrompt('failed');
  assert.equal(duplicate.restored, true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.balance, '9');
  pool.assertDone();
});

test('refunds stale reservations atomically and aggregates per-user BIGINT updates', async () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const pool = new ScriptedPool([
    { tag: 'BEGIN' },
    {
      tag: 'restore-stale',
      result: result([
        { user_id: '123', cost: 1 },
        { user_id: '123', cost: 2 },
        { user_id: '456', cost: 1 },
      ]),
    },
    { tag: 'refund-stale-account', params: ['123', '3'] },
    { tag: 'refund-stale-account', params: ['456', '1'] },
    { tag: 'COMMIT' },
  ]);
  const ledger = createStarLedger({ pool, now: () => now });
  assert.deepEqual(
    await ledger.refundStaleReservations({ olderThanMs: 60_000, limit: 50 }),
    { restoredCount: 3, refundedAmount: '4' },
  );
  pool.assertDone();
});

test('returns aggregate counters as BIGINT-safe strings', async () => {
  const pool = new ScriptedPool([
    {
      tag: 'get-stats',
      result: result([{
        total_users: '3',
        total_balance: '9007199254740993',
        payment_count: '5',
        total_stars_purchased: '12',
        terms_acceptance_count: '2',
        reserved_prompts: '1',
        completed_prompts: '8',
        restored_prompts: '4',
        total_stars_spent: '8',
      }]),
    },
  ]);
  const ledger = createStarLedger({ pool });
  assert.deepEqual(await ledger.getStats(), {
    totalUsers: '3',
    totalBalance: '9007199254740993',
    paymentCount: '5',
    totalStarsPurchased: '12',
    termsAcceptanceCount: '2',
    reservedPrompts: '1',
    completedPrompts: '8',
    restoredPrompts: '4',
    totalStarsSpent: '8',
  });
  pool.assertDone();
});
