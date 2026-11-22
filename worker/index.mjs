// Submit-only edge relay. The Work credential never reaches the browser and
// arbitrary client headers/URLs are never forwarded. Work validates the entire
// structured submission and image bytes before committing a receipt.
export const MAX_BODY_BYTES = 10 * 8 * 1024 * 1024 + 128 * 1024;

function response(origin, status, value, extra = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin', ...extra };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(value === null ? null : JSON.stringify(value), { status, headers });
}

export async function relay(request, env, transport = fetch) {
  const url = new URL(request.url);
  const allowed = env.CONTACT_ALLOWED_ORIGIN;
  if (!allowed || !env.CONTACT_INTAKE_TOKEN || env.CONTACT_INTAKE_TOKEN.length < 32 || env.CONTACT_INTAKE_TOKEN.startsWith('lw_mcp_') || !env.CONTACT_RATE_LIMITER?.limit) {
    return response(null, 503, { code: 'not_configured', message: '문의 접수를 준비하고 있습니다. 잠시 후 다시 시도해주세요.' });
  }
  if (request.headers.get('Origin') !== allowed) return response(null, 403, { code: 'origin_forbidden', message: '허용되지 않은 요청 출처입니다.' });
  if (url.pathname !== '/submit' || url.search) return response(allowed, 404, { code: 'not_found', message: '문의 접수 경로를 확인해주세요.' });
  if (request.method === 'OPTIONS') return response(allowed, 204, null, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
  if (request.method !== 'POST') return response(allowed, 405, { code: 'method_not_allowed', message: '문의 제출만 지원합니다.' }, { Allow: 'POST, OPTIONS' });
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return response(allowed, 400, { code: 'invalid_request', message: '접수 요청을 확인해주세요.' });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  let permitted;
  try { permitted = await env.CONTACT_RATE_LIMITER.limit({ key }); }
  catch { return response(allowed, 503, { code: 'unavailable', message: '잠시 후 다시 시도해주세요.' }); }
  if (!permitted.success) return response(allowed, 429, { code: 'rate_limited', message: '문의 요청이 많습니다. 1분 후 다시 시도해주세요.' }, { 'Retry-After': '60' });
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json(?:;|$)/i.test(contentType) && !/^multipart\/form-data;.*boundary=/i.test(contentType)) return response(allowed, 415, { code: 'unsupported_media_type', message: '문의 전송 형식을 확인해주세요.' });
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return response(allowed, 413, { code: 'request_too_large', message: '스크린샷 크기를 확인해주세요.' });
  if (!request.body) return response(allowed, 400, { code: 'empty_request', message: '문의 내용을 입력해주세요.' });
  let size = 0;
  let tooLarge = false;
  const body = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { size += chunk.byteLength; if (size > MAX_BODY_BYTES) { tooLarge = true; throw new RangeError('Contact request too large'); } controller.enqueue(chunk); },
  }));
  try {
    const upstream = await transport('https://work.lightlink.kr/api/v1/integrations/contact/requests', {
      method: 'POST', headers: { 'Content-Type': contentType, Authorization: `Bearer ${env.CONTACT_INTAKE_TOKEN}` }, body, duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(120_000),
    });
    if (upstream.status === 201) {
      const receipt = await upstream.json();
      if (!/^[a-f0-9]{32}$/.test(receipt.id) || typeof receipt.received_at !== 'string' || Number.isNaN(Date.parse(receipt.received_at))) throw new Error('Invalid receipt');
      return response(allowed, 201, { id: receipt.id, received_at: receipt.received_at });
    }
    const messages = {
      400: '문의 전송 형식을 확인해주세요.',
      409: '같은 접수 번호의 내용이 변경되었습니다. 입력 내용을 확인해주세요.',
      413: '스크린샷은 최대 10장, 장당 8MB까지 첨부할 수 있습니다.',
      415: 'JPEG·PNG·WebP 스크린샷만 첨부할 수 있습니다.',
      422: '문의 내용·이메일·스크린샷 형식과 크기를 확인해주세요.',
      429: '문의 요청이 많습니다. 잠시 후 같은 내용으로 다시 시도해주세요.',
    };
    await upstream.body?.cancel();
    const status = messages[upstream.status] ? upstream.status : 503;
    return response(allowed, status, { code: `contact_${status}`, message: messages[status] ?? '접수 확인이 지연되고 있습니다. 입력 내용을 유지한 채 다시 시도해주세요.' }, status === 429 ? { 'Retry-After': '60' } : {});
  } catch {
    return response(allowed, tooLarge ? 413 : 503, { code: tooLarge ? 'request_too_large' : 'unavailable', message: tooLarge ? '스크린샷 크기를 확인해주세요.' : '접수 확인이 지연되고 있습니다. 같은 내용으로 다시 시도해주세요.' });
  }
}

export default { fetch: (request, env) => relay(request, env) };
