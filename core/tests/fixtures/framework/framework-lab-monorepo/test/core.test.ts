import assert from 'node:assert/strict'; import { parseConfig } from '../packages/core/src/schema';
describe('core fixture', () => { it('parses config', () => assert.equal(parseConfig({ name: 'x' }).port, 3000)); it.skip('documents an intentionally skipped branch', () => assert.fail()); });
