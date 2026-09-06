import test from 'node:test';
import assert from 'node:assert/strict';
import { answer } from './index.js';

test('answer is stable', () => {
  assert.equal(answer, 42);
});
