/**
 * Google Drive 업로드 (fetch 기반 OAuth)
 */

import { getLocalNow, formatDate } from './utils.js';

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed');
  return data.access_token;
}

async function findDailyFile(accessToken, folderId, filename) {
  const query = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const files = data.files || [];
  return files.length > 0 ? files[0].id : null;
}

async function getFileContent(accessToken, fileId) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return await res.text();
  } catch {
    return '';
  }
}

function countPostsInFile(content) {
  const matches = content.match(/^## \d+\./gm);
  return matches ? matches.length : 0;
}

function formatDriveEntry(num, postData, analysis, tagsObsidian, now) {
  return `## ${num}. ${analysis.summary || '제목 없음'}
- **작성자:** ${postData.author || 'Unknown'}
- **카테고리:** ${analysis.category || '기타'}
- **태그:** ${tagsObsidian}
- **시간:** ${formatDate(now, 'time')}
- **링크:** ${postData.url || 'N/A'}

**요약:** ${analysis.summary || ''}

**인사이트:** ${analysis.insight || ''}

---
`;
}

async function createFile(accessToken, folderId, filename, content) {
  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: 'text/plain',
  };

  const boundary = '-------314159265358979323846';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
}

async function updateFile(accessToken, fileId, content) {
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'text/plain; charset=UTF-8',
    },
    body: content,
  });
}

export async function saveToDrive(env, postData, analysis) {
  const folderId = env.GDRIVE_FOLDER_ID;
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken || !clientId || !folderId) {
    console.log('Drive not configured, skipping upload.');
    return false;
  }

  try {
    const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
    const now = getLocalNow(env.TIMEZONE_OFFSET);
    const tags = analysis.tags || [];
    const tagsObsidian = tags.map(t => `#${t}`).join(' ');
    const filename = `${formatDate(now, 'date')}.md`;

    const fileId = await findDailyFile(accessToken, folderId, filename);

    if (fileId) {
      const existing = await getFileContent(accessToken, fileId);
      const postNum = countPostsInFile(existing) + 1;
      const newEntry = formatDriveEntry(postNum, postData, analysis, tagsObsidian, now);
      const updated = existing + '\n' + newEntry;
      await updateFile(accessToken, fileId, updated);
    } else {
      const postNum = 1;
      const dateStr = formatDate(now, 'date');
      const koreanDate = formatDate(now, 'korean-date');
      const header = `---
date: ${dateStr}
tags: [threads, daily]
---

# Threads 인사이트 (${koreanDate})

`;
      const entry = formatDriveEntry(postNum, postData, analysis, tagsObsidian, now);
      const content = header + entry;
      await createFile(accessToken, folderId, filename, content);
    }

    console.log(`Saved to Drive: ${filename}`);
    return true;
  } catch (e) {
    console.error('Drive save failed:', e.message);
    return false;
  }
}
