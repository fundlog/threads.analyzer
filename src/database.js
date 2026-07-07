/**
 * Cloudflare D1 데이터베이스 작업
 */

import { urlToHash, getLocalNow, formatDate } from './utils.js';

export async function isDuplicate(db, url) {
  if (!url) return false;
  const hash = await urlToHash(url);
  const result = await db.prepare('SELECT 1 FROM saved_posts WHERE url_hash = ?').bind(hash).first();
  return result !== null;
}

export async function savePost(db, url, author, text, analysis, timezoneOffset) {
  const hash = await urlToHash(url);
  const now = getLocalNow(timezoneOffset);
  const savedAt = formatDate(now, 'datetime');

  await db.prepare(`
    INSERT OR REPLACE INTO saved_posts
    (url_hash, original_url, author, original_text, category, tags, summary, summary_short, insight, insight_short, sentiment, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    hash,
    url || '',
    author || 'Unknown',
    text || '',
    analysis.category || '기타',
    JSON.stringify(analysis.tags || []),
    analysis.summary || '',
    analysis.summary_short || (analysis.summary || '').slice(0, 80),
    analysis.insight || '',
    analysis.insight_short || (analysis.insight || '').slice(0, 80),
    analysis.sentiment || 'neutral',
    savedAt
  ).run();
}

export async function getTodaysPosts(db, timezoneOffset) {
  const now = getLocalNow(timezoneOffset);
  const today = formatDate(now, 'date');
  const result = await db.prepare(
    'SELECT category, summary_short, insight_short, original_url, author, tags FROM saved_posts WHERE saved_at LIKE ? ORDER BY saved_at'
  ).bind(`${today}%`).all();
  return result.results || [];
}

export async function getStats(db, timezoneOffset) {
  const now = getLocalNow(timezoneOffset);
  const today = formatDate(now, 'date');

  const totalResult = await db.prepare('SELECT COUNT(*) as cnt FROM saved_posts').first();
  const total = totalResult?.cnt || 0;

  const catResult = await db.prepare(
    'SELECT category, COUNT(*) as cnt FROM saved_posts GROUP BY category ORDER BY cnt DESC'
  ).all();
  const categories = catResult.results || [];

  const todayResult = await db.prepare(
    'SELECT COUNT(*) as cnt FROM saved_posts WHERE saved_at LIKE ?'
  ).bind(`${today}%`).first();
  const todayCount = todayResult?.cnt || 0;

  const errorResult = await db.prepare(
    'SELECT COUNT(*) as cnt FROM error_log WHERE resolved = 0'
  ).first();
  const errorCount = errorResult?.cnt || 0;

  return { total, categories, todayCount, errorCount };
}

export async function getTodaysPostsForDelete(db, timezoneOffset) {
  const now = getLocalNow(timezoneOffset);
  const today = formatDate(now, 'date');
  const result = await db.prepare(
    'SELECT url_hash, summary_short, original_url, author FROM saved_posts WHERE saved_at LIKE ? ORDER BY saved_at'
  ).bind(`${today}%`).all();
  return result.results || [];
}

export async function deletePostByHash(db, urlHash) {
  await db.prepare('DELETE FROM saved_posts WHERE url_hash = ?').bind(urlHash).run();
}

export async function logError(db, errorType) {
  await db.prepare(
    'INSERT INTO error_log (timestamp, error_type) VALUES (?, ?)'
  ).bind(new Date().toISOString(), errorType).run();
}

export async function getRecentErrors(db) {
  const result = await db.prepare(
    'SELECT timestamp, error_type FROM error_log WHERE resolved = 0 ORDER BY timestamp DESC LIMIT 5'
  ).all();
  return result.results || [];
}

// ============================================================
// 재시도 대기열 (저장 실패한 링크를 모아 cron 에서 자동 재시도)
// 테이블은 첫 사용 시 자동 생성되므로 수동 마이그레이션 불필요.
// ============================================================

async function ensureRetryTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS retry_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_input TEXT UNIQUE,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT
    )`
  ).run();
}

export async function saveFailedLink(db, rawInput, error) {
  try {
    await ensureRetryTable(db);
    // 같은 입력은 UNIQUE 제약으로 중복 저장 안 됨
    await db.prepare(
      'INSERT OR IGNORE INTO retry_queue (raw_input, attempts, last_error, created_at) VALUES (?, 0, ?, ?)'
    ).bind(rawInput, (error || '').slice(0, 200), new Date().toISOString()).run();
  } catch (e) {
    console.error('saveFailedLink failed:', e.message);
  }
}

export async function getRetryQueue(db) {
  try {
    await ensureRetryTable(db);
    const result = await db.prepare('SELECT * FROM retry_queue ORDER BY id LIMIT 10').all();
    return result.results || [];
  } catch (e) {
    console.error('getRetryQueue failed:', e.message);
    return [];
  }
}

export async function removeFromRetryQueue(db, id) {
  await db.prepare('DELETE FROM retry_queue WHERE id = ?').bind(id).run();
}

export async function bumpRetryAttempt(db, id, error) {
  await db.prepare('UPDATE retry_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?')
    .bind((error || '').slice(0, 200), id).run();
}
