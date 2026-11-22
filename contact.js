import { MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_TYPES, validateSubmission, submissionID } from './contact-contract.js';

const $ = (id) => document.getElementById(id);
const selectedFiles = [];
let busy = false;
let attempt = null;
let previews = [];
let toastTimer;
const categories = { bug: '버그 / 오류 신고', feature: '기능 제안', account: '계정 관련', etc: '기타 문의' };

function toast(message, error = true) {
  $('toastIcon').textContent = error ? '❌' : '✅';
  $('toastMsg').textContent = message;
  $('toast').className = `toast ${error ? 'error' : 'success'} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, 6000);
}
function renderPreviews() {
  for (const url of previews) URL.revokeObjectURL(url);
  previews = [];
  $('previewGrid').replaceChildren();
  $('previewSection').style.display = selectedFiles.length ? 'block' : 'none';
  $('uploadArea').style.display = selectedFiles.length ? 'none' : 'block';
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div'); item.className = 'preview-item';
    const image = document.createElement('img'); image.src = URL.createObjectURL(file); previews.push(image.src); image.alt = file.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-btn'; remove.textContent = '✕'; remove.setAttribute('aria-label', `${file.name} 첨부 제거`); remove.disabled = busy;
    remove.addEventListener('click', () => { selectedFiles.splice(index, 1); renderPreviews(); });
    item.append(image, remove); $('previewGrid').append(item);
  });
  if (selectedFiles.length && selectedFiles.length < MAX_IMAGES) {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'add-more'; add.textContent = '+ 사진 추가'; add.disabled = busy;
    add.addEventListener('click', () => $('imageInput').click()); $('previewGrid').append(add);
  }
  $('imageCount').textContent = `${selectedFiles.length} / ${MAX_IMAGES}장`;
}
$('uploadArea').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', (event) => {
  for (const file of event.target.files) {
    if (selectedFiles.length >= MAX_IMAGES) { toast('최대 10장까지 첨부할 수 있습니다.'); break; }
    if (!IMAGE_TYPES.has(file.type)) { toast('JPEG·PNG·WebP 스크린샷만 첨부할 수 있습니다.'); continue; }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) { toast('스크린샷은 장당 8MB까지 첨부할 수 있습니다.'); continue; }
    selectedFiles.push(file);
  }
  event.target.value = ''; renderPreviews();
});
$('category').addEventListener('change', () => { $('message').placeholder = $('category').value === 'account' ? '소속 교구와 속회 등 확인에 필요한 정보와 문의 내용을 적어주세요.' : '겪고 계신 상황이나 문의 내용을 자세히 적어주세요.'; });
$('message').addEventListener('input', () => { const length = [...$('message').value].length; $('charCount').textContent = `${length} / 1000`; $('charCount').className = length > 900 ? 'char-count warn' : 'char-count'; });

function setBusy(value) {
  busy = value; $('submitBtn').classList.toggle('loading', value); $('submitBtn').disabled = value;
  for (const input of $('formView').querySelectorAll('input, select, textarea, button')) input.disabled = value;
  $('formView').setAttribute('aria-busy', String(value));
}
$('formView').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  const input = { category: $('category').value, name: $('name').value.trim(), email: $('email').value.trim(), message: $('message').value };
  const error = validateSubmission(input, selectedFiles);
  if (error || !$('email').checkValidity()) { toast(error || '이메일 주소를 확인해주세요.'); return; }
  const endpoint = window.LIGHTLINK_CONTACT_ENDPOINT;
  if (!endpoint) { toast('문의 접수를 준비하고 있습니다. 잠시 후 다시 시도해주세요.'); return; }
  setBusy(true);
  try {
    let storage;
    try { storage = sessionStorage; } catch { /* Private browsing may disable storage. */ }
    const memoryStorage = { getItem: () => attempt ? JSON.stringify(attempt) : storage?.getItem('lightlink:contact-attempt'), setItem: (_key, value) => { attempt = JSON.parse(value); storage?.setItem('lightlink:contact-attempt', value); } };
    attempt = await submissionID(input, selectedFiles, memoryStorage);
    const payload = { source: 'contact', submission_id: attempt.id, ...input };
    let body; let headers;
    if (selectedFiles.length) { body = new FormData(); body.append('request', JSON.stringify(payload)); for (const file of selectedFiles) body.append('files', file, file.name); }
    else { body = JSON.stringify(payload); headers = { 'Content-Type': 'application/json' }; }
    const result = await fetch(endpoint, { method: 'POST', headers, body, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(150_000) });
    const receipt = await result.json().catch(() => null);
    if (result.status !== 201 || typeof receipt?.id !== 'string' || !/^[a-f0-9]{32}$/.test(receipt.id)) {
      throw new Error(typeof receipt?.message === 'string' ? receipt.message : '접수를 확인할 수 없습니다. 같은 내용으로 다시 시도해주세요.');
    }
    clearTimeout(toastTimer); $('toast').className = 'toast'; $('toastIcon').textContent = ''; $('toastMsg').textContent = '';
    try { sessionStorage.removeItem('lightlink:contact-attempt'); } catch { /* Optional storage. */ }
    attempt = null;
    $('formView').style.display = 'none'; $('successView').style.display = 'flex';
    $('successSub').textContent = `${categories[input.category]} 문의가 접수되었습니다. 검토 후 필요한 작업으로 연결하겠습니다.`;
    $('receiptNumber').textContent = `접수 번호 ${receipt.id}`;
    $('successTitle').focus();
  } catch (error) { toast(error instanceof Error && error.name !== 'TypeError' && error.name !== 'TimeoutError' ? error.message : '접수 확인이 지연되고 있습니다. 입력 내용을 유지한 채 다시 시도해주세요.'); }
  finally { setBusy(false); }
});
$('resetButton').addEventListener('click', () => {
  $('formView').reset(); selectedFiles.length = 0; attempt = null;
  try { sessionStorage.removeItem('lightlink:contact-attempt'); } catch { /* Optional storage. */ }
  $('charCount').textContent = '0 / 1000'; $('charCount').className = 'char-count';
  $('message').placeholder = '겪고 계신 상황이나 문의 내용을 자세히 적어주세요.';
  $('formView').style.display = 'block'; $('successView').style.display = 'none'; renderPreviews(); $('category').focus();
});
window.addEventListener('beforeunload', (event) => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
