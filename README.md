# Lightlink Contact

공개 문의 폼과 submit-only Cloudflare Worker 중계다. 문의는 Work 요청함에 먼저 저장되고 팀원이 검토해 백로그 티켓으로 만들거나 기존 티켓에 연결한다. Discord 알림은 Work가 소유한다.

## 구성

- `index.html`, `contact.js`, `contact-contract.js`: 문의 폼·첨부·검증·접수 영수증. 문의를 800자로 자르지 않고 1,000자 원문을 보낸다. 선택 이메일과 JPEG·PNG·WebP 최대 10장, 장당 8 MiB를 지원한다.
- `contact-config.js`: 공개 `/submit` endpoint만 설정한다. 기본 빈 값은 접수 준비 상태를 안내하며 기존 Discord 전용 중계로 전송하지 않는다. 비밀값은 넣지 않는다.
- `worker/index.mjs`, `worker/wrangler.jsonc`: 출처·메서드·크기·rate limiter를 확인하고 고정된 Work 접수 API로 스트리밍한다. Work 전용 키는 Worker secret에만 보관한다. 공개 응답에는 접수 번호·시각만 남긴다.

실패하면 폼·선택 파일을 유지한다. 같은 내용·파일의 재시도는 같은 무작위 제출 ID를 사용한다. sessionStorage에는 ID와 SHA-256 지문만 저장한다. 이름·이메일·원문·파일은 저장하지 않는다. 내용이나 파일이 달라지면 새로운 제출 ID를 쓴다. 접수 성공은 Work의 영속 저장이 확인된 뒤에만 표시한다. 자동 이메일 회신이나 회신 기한을 약속하지 않는다.

## 개발 및 검증

Node.js 22.22+ 또는 24 LTS와 pnpm 10.33.0을 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec wrangler deploy --config worker/wrangler.jsonc --dry-run
```

전체 브라우저 검증은 Work 저장소에서 `LIGHTLINK_CONTACT_SOURCE`에 이 체크아웃 절대 경로를 지정하고 실행한다.

```sh
LIGHTLINK_CONTACT_SOURCE=/absolute/path/lightlink-contact \
  pnpm --dir /absolute/path/lightlink-work/web test:e2e \
  --project=chromium contact-inbox.spec.ts contact-public.spec.ts
```

이 검증은 임시 DB·로컬 공개 폼 서버·실제 Worker 코드·로컬 Work를 연결한다. 응답 유실 후 재시도, 1,000자 원문·사진 보존, 요청함 검토·백로그 생성과 390px 모바일 화면을 검사한다. Cloudflare·Discord로 테스트 문의를 보내지 않는다.

## 운영 전환

기존 저장소에는 운영 Worker 구현이 없었다. `f433c8a`의 HTML에서 Discord embed를 외부 Worker에 보내는 것만 확인했다. 이 Worker는 기존 운영 소스를 내보낸 결과가 아니라 새로 관리하는 교체 구현이다. 배포 전 실제 Cloudflare 계정에서 기존 소스·라우트·설정을 내보내고 차이를 검토한다. `lightlink-contact-intake`라는 별도 이름을 사용하므로 기존 Worker를 자동 덮어쓰지 않는다.

1. Work의 `docs/contact-intake.md`에 따라 DB·파일 bundle을 검증하고 `CONTACT_INTAKE_TOKENS_FILE`을 설정한 서버를 먼저 준비한다. 일반 사용자·MCP 토큰을 접수 키로 재사용하지 않는다.
2. `worker/wrangler.jsonc`의 허용 출처와 계정 내 고유한 rate-limit namespace를 확인한다. 기본 제한은 IP 해시당 위치별 분당 5회이며 엄격한 전역 quota가 아니다.
3. `wrangler secret put CONTACT_INTAKE_TOKEN --config worker/wrangler.jsonc`로 전용 키를 저장한다. 로컬 개발용 `.dev.vars`도 config와 같은 `worker` 디렉터리에 두고 커밋하지 않는다. 서버에 전달하는 목적지는 소스의 `https://work.lightlink.kr/api/v1/integrations/contact/requests`로 고정되어 있다.
4. Worker를 배포한 후 실제 Worker URL의 `/submit`을 `contact-config.js`에 설정한다. 전체 크기 제한은 80 MiB + 128 KiB이며 Worker는 multipart를 메모리로 다시 조립하지 않는다. 실제 계정·프록시의 요청 제한도 확인한다.
5. 스테이징에서 텍스트·첨부·유실 후 재시도·요청함·백로그 전환을 확인하고 정적 프런트를 게시한다. 기존 Discord 전송과 새 경로를 동시에 켜지 않는다. Work의 선택 outbox 알림만 사용한다.

키 회전은 Work 파일에 새 키 추가 → Worker secret 교체 → 확인 → 기존 키 제거 순서다. 실패 시 접수 원장·첨부·연결 이력을 보존하고 공개 endpoint를 빈 값으로 되돌려 새 접수를 중단할 수 있다. 이전 Discord 전용 경로로 되돌리면 Work 접수가 중단되는 영향을 명시한다. 구현 검증을 운영 배포 완료로 해석하지 않는다.

Cloudflare 근거: [rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [본문 제한](https://developers.cloudflare.com/workers/platform/limits/), [Wrangler 설정](https://developers.cloudflare.com/workers/wrangler/configuration/).
