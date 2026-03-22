/**
 * Threads AI Bot — Cloudflare Worker
 * fetch 핸들러: Telegram webhook + iOS 단축어 엔드포인트
 * scheduled 핸들러: 매시간 실행, REPORT_HOUR에 데일리 리포트 전송
 */

import { sendMessage, setWebhook } from './telegram.js';
import { processAndSave } from './analyze.js';
import { getTodaysPosts, getStats, getRecentErrors, logError, getTodaysPostsForDelete, deletePostByHash } from './database.js';
import { generateReportHtml } from './report.js';
import { getLocalNow, jsonResponse, CORS_HEADERS } from './utils.js';

// ============================================================
// Telegram 명령어 핸들러
// ============================================================

async function handleStart(env, chatId, userId) {
  const ownerId = parseInt(env.OWNER_ID || '0');

  if (ownerId === 0) {
    await sendMessage(env.TELEGRAM_TOKEN, chatId,
      `🔧 셋업 모드\n\n🆔 당신의 텔레그램 ID: ${userId}\n\n` +
      `Workers Secrets에 등록하세요:\n  wrangler secret put OWNER_ID\n  → ${userId} 입력`
    );
    return;
  }

  if (userId !== ownerId) return;

  const reportHour = parseInt(env.REPORT_HOUR || '21');
  await sendMessage(env.TELEGRAM_TOKEN, chatId,
    '👋 Threads 분석 봇입니다.\n\n' +
    `🆔 텔레그램 ID: ${userId}\n\n` +
    '📌 사용법:\n' +
    '- iOS 단축어로 Threads 공유 (1탭!)\n' +
    '- 또는 여기에 직접 링크/텍스트 보내기\n\n' +
    '📋 명령어:\n' +
    '/report - 오늘 리포트 보기\n' +
    '/stats - 저장 통계\n' +
    '/delete - 오늘 저장한 글 삭제\n' +
    '/errors - 최근 에러\n\n' +
    `⏰ 매일 ${reportHour}시에 자동 리포트`
  );
}

async function handleReport(env, chatId, userId) {
  if (userId !== parseInt(env.OWNER_ID || '0')) return;
  const posts = await getTodaysPosts(env.DB, env.TIMEZONE_OFFSET);
  const report = generateReportHtml(posts, env.TIMEZONE_OFFSET);
  await sendMessage(env.TELEGRAM_TOKEN, chatId, report, 'HTML');
}

async function handleStats(env, chatId, userId) {
  if (userId !== parseInt(env.OWNER_ID || '0')) return;
  const { total, categories, todayCount, errorCount } = await getStats(env.DB, env.TIMEZONE_OFFSET);
  const catText = categories.length > 0
    ? categories.map(c => `  ${c.category}: ${c.cnt}건`).join('\n')
    : '  아직 없음';
  await sendMessage(env.TELEGRAM_TOKEN, chatId,
    `📊 저장 통계\n\n총 저장: ${total}건\n오늘: ${todayCount}건\n미해결 에러: ${errorCount}건\n\n📂 카테고리별:\n${catText}`
  );
}

async function handleErrors(env, chatId, userId) {
  if (userId !== parseInt(env.OWNER_ID || '0')) return;
  const errors = await getRecentErrors(env.DB);
  if (errors.length === 0) {
    await sendMessage(env.TELEGRAM_TOKEN, chatId, '✅ 미해결 에러가 없습니다!');
    return;
  }
  const errorText = errors.map(e => `- ${e.timestamp.slice(0, 16)} | ${e.error_type}`).join('\n');
  await sendMessage(env.TELEGRAM_TOKEN, chatId, `⚠️ 최근 에러 (${errors.length}건)\n\n${errorText}`);
}

async function handleDelete(env, chatId, userId, arg) {
  if (userId !== parseInt(env.OWNER_ID || '0')) return;

  try {
    const posts = await getTodaysPostsForDelete(env.DB, env.TIMEZONE_OFFSET);

    if (posts.length === 0) {
      await sendMessage(env.TELEGRAM_TOKEN, chatId, '📭 오늘 저장한 글이 없습니다.');
      return;
    }

    // /delete 번호(들) — 바로 삭제 (예: /delete 1 3 5)
    if (arg) {
      const nums = arg.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
      if (nums.length === 0 || nums.some(n => n < 1 || n > posts.length)) {
        await sendMessage(env.TELEGRAM_TOKEN, chatId, `❌ 1~${posts.length} 사이 번호를 입력하세요.\n예: /delete 1 3`);
        return;
      }
      const deleted = [];
      for (const num of [...new Set(nums)].sort((a, b) => b - a)) {
        const post = posts[num - 1];
        await deletePostByHash(env.DB, post.url_hash);
        deleted.push(`${num}. ${post.summary_short}`);
      }
      await sendMessage(env.TELEGRAM_TOKEN, chatId, `🗑️ 삭제 완료 (${deleted.length}건):\n${deleted.join('\n')}`);
      return;
    }

    // /delete만 — 목록 보여주기
    const list = posts.map((p, i) =>
      `${i + 1}. ${p.summary_short}\n   👤 ${p.author}`
    ).join('\n\n');

    await sendMessage(env.TELEGRAM_TOKEN, chatId,
      `📋 오늘 저장한 글 (${posts.length}건)\n\n${list}\n\n🗑️ 삭제하려면: /delete 번호\n여러 개: /delete 1 3 5`
    );
  } catch (e) {
    await sendMessage(env.TELEGRAM_TOKEN, chatId, `❌ 삭제 실패: ${e.message}`);
  }
}

async function handleMessage(env, chatId, userId, text) {
  const ownerId = parseInt(env.OWNER_ID || '0');

  if (ownerId === 0) {
    await sendMessage(env.TELEGRAM_TOKEN, chatId, '🔧 셋업 모드입니다. /start 를 입력하세요.');
    return;
  }
  if (userId !== ownerId) return;

  const threadsPattern = /https?:\/\/(?:www\.)?threads\.(?:net|com)\/[^\s]+/;
  const match = text.match(threadsPattern);

  if (!match && text.trim().length < 20) {
    await sendMessage(env.TELEGRAM_TOKEN, chatId,
      '🔗 사용법:\n1. Threads 링크 보내기\n2. 글 내용 직접 보내기\n3. /report 로 리포트 보기'
    );
    return;
  }

  await sendMessage(env.TELEGRAM_TOKEN, chatId, '🔄 저장 중...');

  try {
    const result = await processAndSave(env, text);
    const messages = {
      duplicate: '📌 이미 저장한 글입니다!',
      no_content: '⚠️ 분석할 내용이 없습니다.',
      ok_drive: '✅ 저장 완료! /report 로 확인',
      ok_drive_fail: '✅ 분석 완료! (⚠️ Drive 저장 실패) /report 로 확인',
    };
    await sendMessage(env.TELEGRAM_TOKEN, chatId, messages[result] || '✅ 완료');
  } catch (e) {
    await logError(env.DB, `msg_${e.constructor.name}`);
    console.error('Processing failed:', e.message);
    await sendMessage(env.TELEGRAM_TOKEN, chatId, `❌ 저장 실패: ${e.message}`);
  }
}

// ============================================================
// Telegram 웹훅 처리
// ============================================================

async function handleTelegramUpdate(env, update) {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();

  if (text === '/start') return handleStart(env, chatId, userId);
  if (text === '/report') return handleReport(env, chatId, userId);
  if (text === '/stats') return handleStats(env, chatId, userId);
  if (text === '/errors') return handleErrors(env, chatId, userId);
  if (text === '/delete' || text.startsWith('/delete ')) {
    const arg = text.replace('/delete', '').trim();
    return handleDelete(env, chatId, userId, arg);
  }

  // 일반 메시지
  return handleMessage(env, chatId, userId, text);
}

// ============================================================
// iOS 단축어 /analyze 엔드포인트
// ============================================================

async function handleAnalyze(env, request) {
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  if (env.WEBHOOK_SECRET && data.secret !== env.WEBHOOK_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 403);
  }

  const text = data.text || '';
  if (!text) {
    return jsonResponse({ error: 'no text' }, 400);
  }

  const ownerId = parseInt(env.OWNER_ID || '0');

  try {
    const result = await processAndSave(env, text);
    const messages = {
      duplicate: '📌 이미 저장한 글입니다.',
      no_content: '⚠️ 분석할 내용이 없습니다.',
      ok_drive: '✅ 저장 완료! /report 로 확인',
      ok_drive_fail: '✅ 분석 완료! (⚠️ Drive 저장 실패 — 텔레그램에만 저장됨) /report 로 확인',
    };

    if (ownerId) {
      await sendMessage(env.TELEGRAM_TOKEN, ownerId, messages[result] || '✅ 완료');
    }

    return jsonResponse({ status: result });
  } catch (e) {
    await logError(env.DB, `webhook_${e.constructor.name}`);
    console.error('Webhook failed:', e.message);
    if (ownerId) {
      await sendMessage(env.TELEGRAM_TOKEN, ownerId, `❌ 저장 실패: ${e.message}`);
    }
    return jsonResponse({ status: 'error' }, 500);
  }
}

// ============================================================
// Worker 엔트리 포인트
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET / — health check
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ status: 'running' });
    }

    // GET /setup-webhook — 텔레그램 웹훅 설정
    if (request.method === 'GET' && url.pathname === '/setup-webhook') {
      const secret = url.searchParams.get('secret');
      if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
        return jsonResponse({ error: 'unauthorized' }, 403);
      }
      const webhookUrl = `${url.origin}/webhook`;
      const result = await setWebhook(env.TELEGRAM_TOKEN, webhookUrl);
      return jsonResponse({ webhook: webhookUrl, result });
    }

    // POST /webhook — Telegram 업데이트
    if (request.method === 'POST' && url.pathname === '/webhook') {
      try {
        const update = await request.json();
        await handleTelegramUpdate(env, update);
      } catch (e) {
        console.error('Telegram webhook error:', e.message);
      }
      return jsonResponse({ ok: true });
    }

    // POST /analyze — iOS 단축어
    if (request.method === 'POST' && url.pathname === '/analyze') {
      return handleAnalyze(env, request);
    }

    return jsonResponse({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    const reportHour = parseInt(env.REPORT_HOUR || '21');
    const now = getLocalNow(env.TIMEZONE_OFFSET);
    const currentHour = now.getUTCHours();

    if (currentHour !== reportHour) return;

    const ownerId = parseInt(env.OWNER_ID || '0');
    if (!ownerId) return;

    const posts = await getTodaysPosts(env.DB, env.TIMEZONE_OFFSET);
    if (!posts || posts.length === 0) return;

    const report = generateReportHtml(posts, env.TIMEZONE_OFFSET, '오늘의 Threads 인사이트');
    await sendMessage(env.TELEGRAM_TOKEN, ownerId, report, 'HTML');

    if (env.CHANNEL_THREADS) {
      await sendMessage(env.TELEGRAM_TOKEN, env.CHANNEL_THREADS, report, 'HTML');
    }

    console.log(`Daily report sent. ${posts.length} posts.`);
  },
};
