# Trouble Painter 서버

실시간 멀티플레이 그림 게임 **Trouble Painter**의 백엔드입니다. 플레이어들이 차례로 공유 캔버스에 획을 더해 그림을 그립니다. 그중 한 명은 마피아이고 제시어를 모릅니다. 그림이 끝나면 모두가 마피아가 누구인지 투표하고, 마피아는 제시어를 맞힐 기회를 얻습니다.

로그인과 몇 가지 조회는 HTTP로, 방 안에서 일어나는 모든 일은 WebSocket으로 처리합니다.

[English](README.md)

## 링크

- [앱 스토어](https://apps.apple.com/app/id6836675233)
- [플레이 스토어](https://play.google.com/store/apps/details?id=kr.co.devstory.troublepainter.prod)
- 블로그: [1편](https://blog.devstory.co.kr/post/trouble-painter-01/), [2편](https://blog.devstory.co.kr/post/trouble-painter-02/)

## 기능

- 짧은 수명의 액세스 토큰과 리프레시 토큰을 쓰는 익명 로그인 (JWT, HS256)
- 방 코드가 있는 비공개 방, 방장이 정하는 규칙, 준비 확인, 강퇴
- 수락 단계가 있는 빠른 시작 매칭과 FCM 푸시 알림
- 게임 흐름: 준비, 그리기 턴, 투표, 정답 입력, 결과. 획은 증분 조각으로 전달합니다.
- 접속 끊김 유예 시간, 재시작 후 SQLite 스냅샷으로 방 복원
- SQLite에 게임 기록을 저장하고 매일 백업
- 루프백에서만 제공하는 Prometheus 메트릭

## 기술 스택

- Node.js(버전은 [.nvmrc](.nvmrc)에 고정)와 TypeScript
- HTTP는 [Fastify](https://fastify.dev), WebSocket은 [ws](https://github.com/websockets/ws)
- 토큰은 [jose](https://github.com/panva/jose), 검증은 [zod](https://zod.dev)
- 스냅샷과 기록은 SQLite(`node:sqlite`)
- FCM은 [firebase-admin](https://github.com/firebase/firebase-admin-node), 로그는 [pino](https://getpino.io), 메트릭은 [prom-client](https://github.com/siimon/prom-client)
- 테스트는 [Vitest](https://vitest.dev)

## 아키텍처

코드는 기능 우선(feature-first)으로 나누고, 각 기능은 포트와 어댑터를 가진 레이어로 구성합니다.

```
src/
  features/
    auth/       로그인과 토큰 재발급
    game/       방, 게임 흐름, 기록
    matching/   빠른 시작 대기열과 푸시
  shared/       WebSocket 게이트웨이, HTTP 도우미, 설정, 로그, 메트릭
  backup/       게임 기록 일일 백업 작업
  app.ts        모든 구성 요소를 연결
  main.ts       진입점
```

각 기능 안에서는 이렇게 나뉩니다.

- `domain/`은 I/O 없는 엔티티와 규칙
- `application/`은 유스케이스와 그들이 의존하는 포트
- `adapters/`는 HTTP와 WebSocket 메시지를 유스케이스로 변환
- `infrastructure/`는 포트의 구현(SQLite, 메모리, FCM, JWT 등)

방은 서버가 실행되는 동안 메모리에 있고, 재시작해도 살아남도록 SQLite에 스냅샷으로 저장합니다.

## HTTP API

| 메서드 | 경로                            | 용도                                   |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/v1/auth/anonymous-signin` | 익명 사용자를 만들고 토큰 발급         |
| POST   | `/api/v1/auth/reissue`          | 리프레시 토큰으로 새 토큰 발급         |
| GET    | `/api/v1/config`                | 소켓을 열기 전에 앱이 필요한 값        |
| POST   | `/api/v1/developer`             | 기기 uuid가 개발자 것인지 확인         |

WebSocket 엔드포인트는 `/ws`입니다. 메시지 타입은 [src/shared/adapters/ws/protocol.ts](src/shared/adapters/ws/protocol.ts)에 정의되어 있습니다.

## 시작하기

필요한 것: `.nvmrc`에 적힌 버전의 Node.js

```sh
npm ci
npm run typecheck
npm test
```

테스트는 자체 설정과 키워드 fixture를 쓰므로 비공개 파일 없이 실행됩니다.

### 로컬 실행

모든 설정은 필수이고 코드에 기본값이 없습니다. 서버는 `.env/<APP_ENV>/server.env`(`dev` 또는 `prod`)에서 설정을 읽으며, 프로세스에 이미 설정된 변수가 우선합니다. 설정 전체 목록과 타입은 [src/shared/infrastructure/config/env.ts](src/shared/infrastructure/config/env.ts)의 스키마가 기준입니다. 동작하는 예시는 [test/support/env.ts](test/support/env.ts)에 있습니다.

`.env/dev/server.env`가 준비되어 있다면:

```sh
make run ENV=dev     # watch 모드: 저장하면 다시 빌드하고, 빌드되면 재시작
```

또는 직접 빌드해서 실행합니다.

```sh
npm run build
npm run start:dev
```

설정 외에 실행 중인 서버에는 다음이 필요합니다.

- 로케일마다 `<locale>.json` 하나씩 들어 있는 키워드 디렉터리 (형식은 [test/fixtures/keywords](test/fixtures/keywords) 참고)
- 푸시를 쓴다면 Firebase 서비스 계정. `PUSH_ENABLED=false`로 두면 푸시를 보내지 않고 로그로만 남깁니다.

## 설정과 비밀 값

`.env/` 디렉터리는 의도적으로 gitignore되어 있습니다. 환경별 설정, 비밀 값, 키워드 데이터, 서비스 계정 키, 배포 스크립트가 들어 있으며, 별도의 비공개 저장소로 관리합니다. 이 저장소에는 비밀 값이 없습니다.

## 배포

배포는 `make deploy-dev`와 `make deploy-prod`로 실행하며, 이 명령은 비공개 `.env/` 안의 스크립트를 호출합니다. [monitoring](monitoring)과 [backup](backup) 디렉터리에는 Prometheus, Grafana, 일일 백업 작업을 위한 systemd 유닛과 설정이 있습니다.

## 라이선스

아직 라이선스를 정하지 않았습니다. 라이선스가 추가되기 전까지는 모든 권리를 보유합니다.
