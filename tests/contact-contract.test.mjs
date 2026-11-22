import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionID, validateSubmission, MAX_IMAGE_BYTES } from '../contact-contract.js';

const input = { category: 'bug', name: 'private name', email: 'private@example.com', message: '원문'.repeat(500) };
const file = () => new File(['proof'], 'proof.png', { type: 'image/png' });

test('one thousand characters and optional email are accepted without truncation', () => {
  assert.equal(validateSubmission(input, [file()]), '');
  assert.equal(validateSubmission({ ...input, email: '' }, []), '');
  assert.notEqual(validateSubmission({ ...input, message: 'a'.repeat(1001) }, []), '');
  assert.notEqual(validateSubmission({ ...input, email: 'not an email' }, []), '');
});
test('image formats, count and size match the Work contract', () => {
  assert.notEqual(validateSubmission(input, [new File(['gif'], 'proof.gif', { type: 'image/gif' })]), '');
  assert.notEqual(validateSubmission(input, Array.from({ length: 11 }, file)), '');
  assert.notEqual(validateSubmission(input, [{ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }]), '');
});
test('identical body and file bytes retain the submission ID, including after reload', async () => {
  const storage = new Map();
  const adapter = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const first = await submissionID(input, [file()], adapter);
  const retry = await submissionID({ ...input }, [file()], adapter);
  assert.equal(first.id, retry.id);
  const raw = JSON.stringify([...storage.values()]);
  for (const privateValue of [input.name, input.email, input.message, 'proof.png']) assert.ok(!raw.includes(privateValue));
  const edited = await submissionID({ ...input, message: 'edited' }, [file()], adapter);
  assert.notEqual(first.id, edited.id);
});
test('storage being unavailable keeps submission usable', async () => {
  const adapter = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.match((await submissionID(input, [], adapter)).id, /^[a-zA-Z0-9_-]{16,120}$/);
});
