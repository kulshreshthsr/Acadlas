import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fineFor, type FinePolicy } from '../school/fees-policy';

const daily: FinePolicy = { mode: 'daily', basis: 'amount', amount: 1000, rate: 0, graceDays: 3, cap: 0 };

describe('late fee policies', () => {
  test('nothing is charged inside the grace period, or with no policy', () => {
    assert.equal(fineFor(daily, '2026-01-01', 500000, '2026-01-04'), 0);
    assert.equal(fineFor({ ...daily, mode: 'none' }, '2026-01-01', 500000, '2026-06-01'), 0);
  });

  test('daily, weekly and monthly repeat; a part of a period counts as a whole one', () => {
    assert.equal(fineFor(daily, '2026-01-01', 500000, '2026-01-10'), 6000);
    assert.equal(fineFor({ ...daily, mode: 'weekly' }, '2026-01-01', 500000, '2026-01-10'), 1000 * 1);
    assert.equal(fineFor({ ...daily, mode: 'weekly' }, '2026-01-01', 500000, '2026-01-12'), 1000 * 2);
    assert.equal(fineFor({ ...daily, mode: 'monthly' }, '2026-01-01', 500000, '2026-02-20'), 1000 * 2);
  });

  test('flat is charged once however late', () => {
    assert.equal(fineFor({ ...daily, mode: 'flat' }, '2026-01-01', 500000, '2026-12-01'), 1000);
  });

  test('a percentage is taken of the instalment, in basis points', () => {
    const monthlyPercent: FinePolicy = { ...daily, mode: 'monthly', basis: 'percent', rate: 150 };
    assert.equal(fineFor(monthlyPercent, '2026-01-01', 500000, '2026-02-20'), 2 * 7500);
  });

  test('the ceiling holds, and nothing owed means no fine', () => {
    assert.equal(fineFor({ ...daily, cap: 4000 }, '2026-01-01', 500000, '2026-01-10'), 4000);
    assert.equal(fineFor(daily, '2026-01-01', 0, '2026-06-01'), 0);
  });
});
