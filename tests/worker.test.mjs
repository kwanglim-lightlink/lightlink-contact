import test from 'node:test';
import assert from 'node:assert/strict';
import { relay, MAX_BODY_BYTES } from '../worker/index.mjs';

const origin = 'https://contact.lightlink.kr';
const key = 'submit-only-contact-test-key-'.repeat(2);
const env = () => ({ CONTACT_ALLOWED_ORIGIN: origin, CONTACT_INTAKE_TOKEN: key, CONTACT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
function request(body = '{}', extra = {}) {
  return new Request('https://relay.example/submit', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json', ...extra }, body });
}

test('relay strips credentials and private upstream fields while forwarding the full body', async () => {
  const payload = { message: '원문'.repeat(500), submission_id: crypto.randomUUID() };
  const result = await relay(request(JSON.stringify(payload), { Authorization: 'Bearer attacker', Cookie: 'private=1' }), env(), async (url, init) => {
    assert.equal(url, 'https://work.lightlink.kr/api/v1/integrations/contact/requests');
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.headers.Origin, undefined);
    assert.deepEqual(await new Response(init.body).json(), payload);
    return Response.json({ id: 'a'.repeat(32), received_at: '2026-11-22T10:00:00.000Z', internal: 'must not return' }, { status: 201 });
  });
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
  assert.deepEqual(await result.json(), { id: 'a'.repeat(32), received_at: '2026-11-22T10:00:00.000Z' });
});

test('configuration, origin, size, type and method fail before contacting Work', async () => {
  let called = false;
  const upstream = async () => { called = true; throw new Error('unexpected'); };
  assert.equal((await relay(request(), {}, upstream)).status, 503);
  assert.equal((await relay(request('{}', { Origin: 'https://attacker.example' }), env(), upstream)).status, 403);
  assert.equal((await relay(request('{}', { 'Content-Length': String(MAX_BODY_BYTES + 1) }), env(), upstream)).status, 413);
  assert.equal((await relay(request('{}', { 'Content-Type': 'text/plain' }), env(), upstream)).status, 415);
  assert.equal((await relay(new Request('https://relay.example/submit', { headers: { Origin: origin } }), env(), upstream)).status, 405);
  assert.equal(called, false);
});

test('rate limiter receives a digest instead of an IP and blocks excess submissions', async () => {
  const configuration = env();
  configuration.CONTACT_RATE_LIMITER.limit = async ({ key }) => { assert.match(key, /^[a-f0-9]{64}$/); assert.ok(!key.includes('192.0.2.1')); return { success: false }; };
  const result = await relay(request(), configuration, () => { throw new Error('unexpected'); });
  assert.equal(result.status, 429); assert.equal(result.headers.get('Retry-After'), '60');
});

test('allowed preflight exposes only the public content-type header', async () => {
  const result = await relay(new Request('https://relay.example/submit', { method: 'OPTIONS', headers: { Origin: origin } }), env());
  assert.equal(result.status, 204); assert.equal(result.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  assert.equal(result.headers.get('Access-Control-Allow-Credentials'), null);
});

test('multipart bytes stream through unchanged and receipt failures remain retryable', async () => {
  const form = new FormData(); form.append('request', JSON.stringify({ submission_id: 'stable-submission-id' })); form.append('files', new File(['image bytes'], 'proof.png', { type: 'image/png' }));
  const req = new Request('https://relay.example/submit', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.1' }, body: form });
  const result = await relay(req, env(), async (_url, init) => {
    const received = await new Response(init.body, { headers: init.headers }).formData();
    assert.equal(received.get('files').name, 'proof.png'); assert.equal(await received.get('files').text(), 'image bytes');
    return Response.json({ token: key, email: 'private@example.com' }, { status: 500 });
  });
  assert.equal(result.status, 503); const text = await result.text(); assert.ok(!text.includes(key)); assert.ok(!text.includes('private@example.com'));
});

test('network response loss does not report a successful receipt', async () => {
  const result = await relay(request(), env(), async (_url, init) => { await new Response(init.body).text(); throw new TypeError('lost response'); });
  assert.equal(result.status, 503);
});
