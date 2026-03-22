/**
 * 데일리 리포트 생성
 */

import { getLocalNow, formatDate } from './utils.js';

export function generateReportHtml(posts, timezoneOffset, title = '오늘의 Threads 인사이트') {
  if (!posts || posts.length === 0) {
    return '📭 저장된 글이 없습니다.';
  }

  const now = getLocalNow(timezoneOffset);
  const dateStr = formatDate(now, 'korean-date');

  // 카테고리별 분류
  const byCategory = {};
  for (const post of posts) {
    const cat = post.category || '기타';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({
      summary: post.summary_short || '',
      insight: post.insight_short || '',
      url: post.original_url || '',
      author: post.author || 'Unknown',
      tags: post.tags || '[]',
    });
  }

  let report = `📊 ${title} (${dateStr})\n저장한 글: ${posts.length}건\n\n`;

  // 텍스트 바 차트
  report += '📈 카테고리 분포\n';
  const maxCount = Math.max(...Object.values(byCategory).map(items => items.length));
  const sorted = Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length);

  for (const [cat, items] of sorted) {
    const barLen = Math.round((items.length / maxCount) * 8);
    const bar = '█'.repeat(barLen) + '░'.repeat(8 - barLen);
    const paddedCat = cat + ' '.repeat(Math.max(0, 8 - cat.length));
    report += `${paddedCat} ${bar} ${items.length}건\n`;
  }
  report += '\n';

  // 카테고리별 상세
  let num = 1;
  for (const [cat, items] of Object.entries(byCategory)) {
    report += `📂 ${cat} (${items.length}건)\n`;
    for (const item of items) {
      report += `\n  ${num}. ${item.summary}\n`;
      if (item.insight) {
        report += `     💡 ${item.insight}\n`;
      }
      if (item.url) {
        report += `     🔗 <a href="${item.url}">링크</a>\n`;
      }
      num++;
    }
    report += '\n';
  }

  report += '📁 상세 내용은 Google Drive .md 파일에서 확인하세요!';

  return report;
}
