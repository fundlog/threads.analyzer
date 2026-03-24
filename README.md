# Threads AI Analyzer

Threads 글을 AI로 자동 분석하고 텔레그램으로 리포트를 받는 봇입니다.

## 파일 구조

| 파일 | 역할 |
|------|------|
| `bot.py` | 메인 봇 코드 (분석, 저장, 리포트 전부) |
| `requirements.txt` | Python 라이브러리 목록 |
| `runtime.txt` | Python 버전 지정 |
| `.gitignore` | 민감 파일 업로드 방지 (API키, DB 등) |

## 커스터마이징 가이드

### 카테고리 추가/수정
`bot.py` 457-464줄 — AI에게 제안하는 카테고리 목록:

```
AI, 마케팅, 자기계발, 비즈니스, 기술, 디자인, 금융/투자...
```

원하는 카테고리를 추가하거나 삭제하면 AI가 참고합니다.

### AI 분석 방식 변경
`bot.py` 451-464줄 — Gemini에게 보내는 프롬프트입니다.
- 더 자세한 분석: 프롬프트에 구체적인 지시 추가
- 예: "투자 관련 글은 종목명과 수익률을 반드시 포함해줘"
- 분석 필드: category, tags, summary, insight, sentiment

### .md 파일 형식 변경
`bot.py` 112-183줄 — Google Drive에 저장되는 마크다운 파일 형식
- **현재**: 날짜별 파일 (`2026-03-23.md`)
- **카테고리별**: `save_to_drive()` 함수에서 파일명을 `{category}.md`로 변경
- **하나로 합치기**: 파일명을 `all_posts.md`로 고정

### 데일리 리포트 수정
`bot.py` 480-571줄 — 매일 받는 텔레그램 리포트 형식
- 리포트 시간: 환경변수 `REPORT_HOUR` (기본값: 21시)
- 카테고리별 바 차트, 글 요약, 인사이트 포함

### 텔레그램 메시지 형식
`bot.py` 703-739줄 — 저장 완료 시 받는 메시지 형식

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

## 데이터베이스 (SQLite)

`saved_posts` 테이블에 저장되는 필드:

| 필드 | 설명 |
|------|------|
| `original_text` | 원본 글 |
| `author` | 작성자 |
| `category` | AI가 분류한 카테고리 |
| `tags` | 키워드 태그 (JSON) |
| `summary` | 요약 (2-4문장) |
| `summary_short` | 요약 (한 줄) |
| `insight` | 인사이트 (3-4문장) |
| `insight_short` | 인사이트 (한 줄) |
| `sentiment` | 감정 (positive/negative/neutral/informative) |
| `saved_at` | 저장 시간 |

