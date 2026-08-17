# RouteMarket Work

[简体中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [ไทย](README.th.md) · **한국어**

RouteMarket Work는 AI 기반 프로젝트와 자동화를 위한 오픈 소스 로컬 우선 데스크톱 워크스페이스입니다. 프로젝트 파일, Agent 대화, 시각적 워크플로, 브라우저 작업, 로컬 도구, MCP 서버, Skill 및 승인 절차를 하나의 Electron 앱에 통합합니다.

> [!IMPORTANT]
> 이 프로젝트는 활발히 개발 중입니다. 계정, 모델, Agent 및 클라우드 실행 기능 일부에는 호환되는 RouteMarket 서비스가 필요합니다. 안정 버전 출시 전까지 인터페이스와 로컬 데이터 형식이 변경될 수 있습니다.

## 주요 기능

- 로컬 폴더를 선택적으로 연결하는 로컬 우선 프로젝트
- 파일, 검색, 패치, 프로세스, 브라우저, MCP 및 Skill 도구를 사용하는 AI 채팅
- 실행 상태와 재사용 가능한 초안을 제공하는 로컬·클라우드 시각적 워크플로
- 격리된 브라우저 프로필 또는 로컬 Chromium 연결을 통한 브라우저 자동화
- MCP, 프로젝트 Skill, 로컬 트리거 및 네이티브 앱 연동
- 권한 검사, 명시적 승인 및 클라우드 전송 전 진단 정보 비식별화

## 빠른 시작

Node.js 22, Corepack, pnpm 10.8.1이 필요합니다.

```bash
corepack enable
corepack pnpm install
corepack pnpm dev:web
```

`dev:web`은 모의 데이터를 사용하는 UI 미리보기입니다. 전체 Electron 통합을 실행하려면 `corepack pnpm dev`를 사용하세요. 기본적으로 `http://localhost:3000`의 호환 RouteMarket Web 서비스와 `http://127.0.0.1:3001`의 API가 필요합니다.

## 보안 및 라이선스

신뢰할 수 있는 작업과 서비스만 승인하세요. 자격 증명, 코드 서명 인증서, 데이터베이스, 로그 또는 `.env` 파일을 커밋하지 마세요. 취약점은 [SECURITY.md](SECURITY.md)에 따라 비공개로 신고해 주세요. 공식 릴리스의 사용 통계와 비활성화 방법은 [TELEMETRY.md](TELEMETRY.md)를 참조하세요.

이 프로젝트는 [Apache License 2.0](LICENSE)으로 배포됩니다. 이 라이선스는 RouteMarket의 이름, 로고 또는 기타 브랜드 자산에 대한 권리를 부여하지 않습니다.
