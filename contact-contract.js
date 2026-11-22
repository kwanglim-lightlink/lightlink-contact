export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateSubmission({ category, name, email, message }, files) {
  if (!['bug', 'feature', 'account', 'etc'].includes(category)) return '문의 유형을 선택해주세요.';
  if (!name.trim() || [...name.trim()].length > 30) return '이름을 30자 이내로 입력해주세요.';
  if (!message.trim() || [...message].length > 1000) return '문의 내용을 1,000자 이내로 입력해주세요.';
  if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) return '이메일 주소를 확인해주세요.';
  if (files.length > MAX_IMAGES) return '스크린샷은 최대 10장까지 첨부할 수 있습니다.';
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) return 'JPEG·PNG·WebP 스크린샷만 첨부할 수 있습니다.';
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return '스크린샷은 장당 8MB까지 첨부할 수 있습니다.';
  }
  return '';
}

async function hexDigest(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Persist only a random submission ID and digest. Names, email, message and
// screenshots are never put in browser storage. Identical retries reuse the ID.
export async function submissionID(input, files, storage) {
  const digests = [];
  for (const file of files) digests.push({ name: file.name, type: file.type, size: file.size, digest: await hexDigest(await file.arrayBuffer()) });
  const signature = await hexDigest(new TextEncoder().encode(JSON.stringify({ input, files: digests })));
  let existing;
  try { existing = JSON.parse(storage?.getItem('lightlink:contact-attempt') ?? 'null'); } catch { /* Browser storage is optional. */ }
  if (existing?.signature === signature && /^[a-zA-Z0-9_-]{16,120}$/.test(existing.id)) return { id: existing.id, signature };
  const attempt = { id: crypto.randomUUID(), signature };
  try { storage?.setItem('lightlink:contact-attempt', JSON.stringify(attempt)); } catch { /* Caller also retains the attempt in memory. */ }
  return attempt;
}
