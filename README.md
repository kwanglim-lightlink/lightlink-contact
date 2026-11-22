# Lightlink Contact

공개 문의 폼을 GitHub Pages로 운영한다. 브라우저는 Work 공개 접수 API에 직접 제출한다. 문의는 Work 요청함에서 검토해 백로그 티켓으로 만들거나 기존 티켓에 연결한다.

`contact-config.js`에서 공개 접수 URL을 설정한다. 폼은 본문 1,000자, 선택 이메일, JPEG·PNG·WebP 최대 10장(장당 8 MiB)을 지원한다. 제출 실패 시 입력과 파일을 유지하고, 같은 내용·파일의 재시도에는 동일한 제출 ID를 사용한다. 브라우저 저장소에는 제출 ID와 SHA-256 지문만 저장한다.

## 검증과 운영 배포

```sh
npm test
```

Work 저장소에서 `LIGHTLINK_CONTACT_SOURCE`를 이 체크아웃의 절대 경로로 지정하고 `pnpm --dir web test:e2e --project=chromium contact-public.spec.ts`를 실행하면 두 개의 로컬 출처에서 JSON·첨부 접수, 응답 유실 후 재시도, 요청함과 백로그 전환을 검증한다.

1. [Work 운영 전환 절차](https://github.com/kwanglim-lightlink/lightlink-work/blob/main/docs/contact-intake.md#운영-전환복구)에 따라 `CONTACT_PUBLIC_ORIGIN=https://contact.lightlink.kr`을 설정하고 Work를 먼저 배포한다.
2. `contact-config.js`가 `https://work.lightlink.kr/api/v1/public/contact/requests`를 가리키는지 확인하고 GitHub Pages의 `main`에 반영한다.
3. 운영 문의 폼에서 합성 문의를 한 건 보내고, 화면의 접수 번호와 Work 요청함 기록이 일치하는지 확인한다. Discord 알림은 Work에서 선택적으로 설정한다.
