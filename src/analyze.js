/**
 * 글 분석 파이프라인 (process_and_save 포팅)
 */

import { parseHtmlInput, decodeHtmlEntities } from './utils.js';
import { isDuplicate, savePost, logError } from './database.js';
import { analyzePost } from './gemini.js';
import { saveToDrive } from './drive.js';

async function fetchWithRetry(url, maxRetries = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      return await res.text();
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
    }
  }
}

async function fetchOembed(url) {
  try {
    const oembedTarget = url.replace('threads.com', 'threads.net');
    const oembedUrl = `https://www.threads.net/api/oembed/?url=${encodeURIComponent(oembedTarget)}`;
    const data = await fetchWithRetry(oembedUrl);
    const result = JSON.parse(data);
    const html = result.html || '';
    const author = result.author_name || 'Unknown';
    const thumbnail = result.thumbnail_url || '';
    let text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = html.match(/src=["']([^"']*(?:jpg|jpeg|png|webp)[^"']*)/);
    const imageUrl = thumbnail || (imgMatch ? imgMatch[1] : '');
    if (text || imageUrl) {
      return { author, text, url, image_url: imageUrl, method: 'oembed' };
    }
  } catch (e) {
    console.log('oEmbed failed:', e.message);
  }
  return null;
}

async function fetchMetaTags(url) {
  try {
    const html = await fetchWithRetry(url);
    const ogDesc = html.match(/<meta property="og:description" content="([^"]*)"/);
    const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/);
    const ogImage = html.match(/<meta property="og:image" content="([^"]*)"/);
    let text = ogDesc ? ogDesc[1] : '';
    let author = ogTitle ? ogTitle[1] : 'Unknown';
    const imageUrl = ogImage ? ogImage[1] : '';
    text = decodeHtmlEntities(text);
    author = decodeHtmlEntities(author);
    if (text || imageUrl) {
      return { author, text, url, image_url: imageUrl, method: 'meta_tags' };
    }
  } catch (e) {
    console.log('Meta tags failed:', e.message);
  }
  return null;
}

async function fetchThreadsPost(url) {
  let result = await fetchOembed(url);
  if (result && (result.text || result.image_url)) return result;
  result = await fetchMetaTags(url);
  if (result && (result.text || result.image_url)) return result;
  return { author: 'Unknown', text: '', url, image_url: '', method: 'failed' };
}

export async function processAndSave(env, rawInput) {
  const isHtml = rawInput.includes('<') && (rawInput.includes('>') || rawInput.toLowerCase().includes('meta'));

  let url, text, imageUrl, author;

  if (isHtml) {
    const parsed = parseHtmlInput(rawInput);
    url = parsed.url;
    text = parsed.text;
    imageUrl = parsed.image_url;
    author = parsed.author;
  } else {
    const threadsPattern = /https?:\/\/(?:www\.)?threads\.(?:net|com)\/[^\s]+/;
    const match = rawInput.match(threadsPattern);
    url = match ? match[0] : '';
    text = url ? rawInput.replace(url, '').trim() : rawInput.trim();
    imageUrl = '';
    author = 'Unknown';
  }

  // 중복 체크
  if (url && await isDuplicate(env.DB, url)) {
    return 'duplicate';
  }

  let postData = null;

  // 1. HTML에서 추출한 데이터 사용
  if (text || imageUrl) {
    postData = { author, text, url, image_url: imageUrl, method: 'html_parse' };
  }

  // 2. 텍스트도 이미지도 없으면 서버에서 시도
  if (!postData && url) {
    postData = await fetchThreadsPost(url);
  }

  // 3. 서버 fetch도 실패하면 원본 텍스트 사용
  if (!postData || (!postData.text && !postData.image_url)) {
    let cleanText = rawInput;
    if (url) cleanText = rawInput.replace(url, '').trim();
    cleanText = cleanText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanText.length >= 20) {
      postData = { author: 'Unknown', text: cleanText, url, image_url: '', method: 'fallback' };
    }
  }

  if (!postData || (!postData.text && !postData.image_url)) {
    return 'no_content';
  }

  // AI 분석
  const analysis = await analyzePost(env.GEMINI_API_KEY, postData);

  // DB 저장
  await savePost(env.DB, url, postData.author || 'Unknown', postData.text || '', analysis, env.TIMEZONE_OFFSET);

  // Google Drive 저장
  const driveSaved = await saveToDrive(env, postData, analysis);

  console.log(`Post saved. Category: ${analysis.category || '기타'}, Drive: ${driveSaved}, Method: ${postData.method || 'unknown'}`);

  return driveSaved ? 'ok_drive' : 'ok_drive_fail';
}
