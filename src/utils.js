/**
 * URL 정규화, 해싱, 시간 관리, HTML 파싱 유틸리티
 */

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const removeKeys = [];
    for (const key of params.keys()) {
      if (key.startsWith('utm_') || ['igshid', 'igsh', 'ref', 'xmt', 'slof'].includes(key)) {
        removeKeys.push(key);
      }
    }
    for (const key of removeKeys) {
      params.delete(key);
    }
    const cleanQuery = params.toString();
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${cleanPath}${cleanQuery ? '?' + cleanQuery : ''}`;
  } catch {
    return url;
  }
}

export async function urlToHash(url) {
  if (!url) {
    const data = new TextEncoder().encode(String(Date.now()));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  const normalized = normalizeUrl(url);
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export function getLocalNow(timezoneOffset) {
  const offset = parseInt(timezoneOffset) || -5;
  return new Date(Date.now() + offset * 3600000);
}

export function formatDate(date, format) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');

  if (format === 'date') return `${y}-${m}-${d}`;
  if (format === 'datetime') return `${y}-${m}-${d}T${h}:${min}:${s}`;
  if (format === 'korean-date') return `${m}월 ${d}일`;
  if (format === 'time') return `${h}:${min}`;
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

export function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseHtmlInput(rawInput) {
  // Threads URL 추출
  const threadsPattern = /https?:\/\/(?:www\.)?threads\.(?:net|com)\/[^\s"<>]+/;
  const urlMatch = rawInput.match(threadsPattern);
  const url = urlMatch ? urlMatch[0] : '';

  // og:image 추출
  let ogImage = '';
  const ogMatch = rawInput.match(/og:image["\s]+content=["']([^"']+)/);
  if (ogMatch) {
    ogImage = ogMatch[1];
  }
  if (!ogImage) {
    const cdnMatch = rawInput.match(/(https:\/\/scontent[^"'<>\s]+)/);
    if (cdnMatch) ogImage = cdnMatch[1];
  }

  // og:description 추출
  let ogDesc = '';
  const descMatch = rawInput.match(/og:description["\s]+content=["']([^"']+)/);
  if (descMatch) {
    ogDesc = decodeHtmlEntities(descMatch[1]);
  }

  // og:title에서 작성자 추출
  let author = 'Unknown';
  const titleMatch = rawInput.match(/og:title["\s]+content=["']([^"']+)/);
  if (titleMatch) {
    author = decodeHtmlEntities(titleMatch[1]);
  }

  // HTML 태그 제거
  let plainText = rawInput.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  let text;
  if (ogDesc) {
    text = ogDesc;
  } else if (plainText.length > 50) {
    text = plainText;
    if (url) text = text.replace(url, '').trim();
    text = text.length > 20 ? text : '';
  } else {
    text = '';
  }

  return { url, text, image_url: ogImage, author };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export { CORS_HEADERS };

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
