# Threads AI Analyzer

Threads 글을 AI로 자동 분석하고 텔레그램으로 리포트를 받는 봇입니다.

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/index.js` | 메인 서버 (텔레그램 명령어, iOS 단축어 엔드포인트, 스케줄러) |
| `src/gemini.js` | Gemini AI 분석 (프롬프트, 이미지 처리) |
| `src/analyze.js` | 콘텐츠 추출 파이프라인 (URL → 텍스트 → AI → 저장) |
| `src/database.js` | D1 데이터베이스 (저장, 조회, 삭제, 통계) |
| `src/report.js` | 데일리 리포트 생성 (카테고리별 바 차트 포함) |
| `src/drive.js` | Google Drive .md 파일 업로드 |
| `src/telegram.js` | 텔레그램 메시지 전송 (자동 분할) |
| `src/utils.js` | URL 정규화, 해싱, 날짜 포맷, HTML 파싱 |
| `wrangler.toml` | Cloudflare Workers 설정 |
| `package.json` | 프로젝트 설정 및 스크립트 |

## 커스터마이징 가이드

### 카테고리 추가/수정
`src/gemini.js` 84-97줄 — AI에게 제안하는 카테고리 목록:

```
AI, 마케팅, 자기계발, 비즈니스, 기술, 디자인, 금융/투자, 건강/운동,
육아/교육, 요리/음식, 부동산, 커리어, 생산성, 심리학, 과학, 정치/경제,
여행, 문화/예술, 유머, 인간관계
```

원하는 카테고리를 추가하거나 삭제하면 AI가 참고합니다.
AI가 목록에 없는 카테고리도 자유롭게 만들 수 있습니다.

### AI 분석 방식 변경
`src/gemini.js` 84-97줄 — Gemini에게 보내는 프롬프트

분석 필드:
| 필드 | 설명 |
|------|------|
| `category` | 카테고리 (2-4자, 한국어) |
| `tags` | 키워드 3-5개 |
| `summary` | 요약 (2-4문장, 구체적 내용 포함) |
| `summary_short` | 한 줄 요약 |
| `insight` | 인사이트 (3-4문장, 숫자/방법/사례 포함) |
| `insight_short` | 한 줄 인사이트 |
| `sentiment` | positive / negative / neutral / informative |

더 자세한 분석을 원하면 프롬프트에 지시를 추가하세요.
예: "투자 관련 글은 종목명과 수익률을 반드시 포함해줘"

### .md 파일 형식 변경
`src/drive.js` — Google Drive에 저장되는 마크다운 파일

| 수정 위치 | 설명 |
|-----------|------|
| 51-64줄 | 각 포스트의 마크다운 형식 (메타데이터, 필드, 이모지) |
| 135-141줄 | 파일 헤더 (YAML frontmatter, 제목) |

현재 파일 구조:
- **날짜별 파일**: `2026-03-23.md` (기본값)
- **카테고리별로 바꾸려면**: `saveToDrive()` 함수에서 파일명을 `{category}.md`로 변경
- **하나로 합치려면**: 파일명을 `all_posts.md`로 고정

### 데일리 리포트 수정
`src/report.js` 29-61줄 — 매일 받는 텔레그램 리포트

리포트 내용:
- 📊 제목 + 날짜 + 저장 건수
- 📈 카테고리별 바 차트 (█░ 시각화)
- 📂 카테고리별 글 목록 (요약 + 인사이트 + 링크)

### 텔레그램 메시지 수정
`src/index.js` — 봇 응답 메시지

| 수정 위치 | 설명 |
|-----------|------|
| 31-42줄 | /start 환영 메시지 |
| 139-144줄 | 저장 완료/실패 시 응답 메시지 |
| 203-207줄 | iOS 단축어 응답 메시지 |

### 콘텐츠 추출 방식
`src/analyze.js` — Threads URL에서 텍스트 추출

추출 순서:
1. iOS 공유 시트 HTML 파싱
2. oEmbed API (threads.net/api/oembed)
3. 메타 태그 (og:description)
4. 원본 텍스트 폴백 (최소 20자)

## 환경변수

### 필수
| 변수 | 설명 |
|------|------|
| `TELEGRAM_TOKEN` | BotFather에서 발급받은 봇 토큰 |
| `GEMINI_API_KEY` | Google Gemini API 키 |
| `WEBHOOK_SECRET` | /analyze 엔드포인트 보안용 비밀 문자열 |
| `OWNER_ID` | 본인 텔레그램 ID (봇에 /start 보내면 확인 가능) |
| `REPORT_HOUR` | 리포트 받을 시간 (24시간, 기본: 21) |
| `TIMEZONE_OFFSET` | UTC 시차 (한국: 9, 미동부: -5) |

### 선택 (Google Drive 연동)
| 변수 | 설명 |
|------|------|
| `GDRIVE_FOLDER_ID` | .md 파일 저장할 Drive 폴더 ID |
| `GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 시크릿 |
| `GOOGLE_REFRESH_TOKEN` | OAuth 리프레시 토큰 |

### 선택 (채널 브로드캐스트)
| 변수 | 설명 |
|------|------|
| `CHANNEL_THREADS` | 리포트를 추가 전송할 텔레그램 채널 ID |

## 데이터베이스 (Cloudflare D1)

`saved_posts` 테이블:

| 필드 | 설명 |
|------|------|
| `url_hash` | URL 해시 (중복 검사용) |
| `original_url` | 원본 Threads URL |
| `author` | 작성자 |
| `original_text` | 원본 글 |
| `category` | AI가 분류한 카테고리 |
| `tags` | 키워드 태그 (JSON) |
| `summary` | 요약 (2-4문장) |
| `summary_short` | 요약 (한 줄) |
| `insight` | 인사이트 (3-4문장) |
| `insight_short` | 인사이트 (한 줄) |
| `sentiment` | 감정 분석 결과 |
| `saved_at` | 저장 시간 |

## 봇 명령어

| 명령어 | 기능 |
|--------|------|
| `/start` | 봇 시작 + 텔레그램 ID 확인 |
| `/report` | 오늘의 리포트 즉시 받기 |
| `/stats` | 전체 저장 통계 확인 |
| `/delete` | 오늘 저장한 글 목록 보기 / 삭제 |
| `/errors` | 최근 에러 확인 |

## 작동 흐름

```
입력 방식
├─ 텔레그램: /start, /report, /stats, /delete, /errors, 또는 텍스트/링크 전송
├─ iOS 단축어: POST /analyze (JSON)
└─ 웹훅 설정: GET /setup-webhook?secret=X

글 저장 과정
├─ 텍스트/URL 수신
├─ 콘텐츠 추출 (oEmbed → 메타태그 → 원본 텍스트)
├─ 중복 확인
├─ Gemini AI 분석 (카테고리, 태그, 요약, 인사이트)
├─ D1 데이터베이스 저장
├─ Google Drive .md 파일 업로드
└─ 텔레그램으로 결과 전송

데일리 리포트 (매시간 체크)
├─ REPORT_HOUR 시간인지 확인
├─ 오늘 저장한 글 조회
├─ HTML 리포트 생성 (카테고리별 바 차트)
└─ 텔레그램으로 전송
```
