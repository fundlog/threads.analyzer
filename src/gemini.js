/**
 * Gemini AI API 통합
 */

import { logError } from './database.js';

// 무료 티어는 모델마다 할당량(quota) 버킷이 따로라, 한 모델이 한도에 걸려도
// 다음 모델은 즉시 사용 가능. 품질 높은 순 → 가벼운 순으로 폴백한다.
const DEFAULT_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

// 한 모델이 응답을 안 주고 매달리면 워커가 무한 대기 → 강제 종료되어
// 성공/실패 메시지조차 못 보냄. 모델당 timeout 을 둬서 빨리 다음으로 넘긴다.
const MODEL_TIMEOUT_MS = 12000;

export async function callGemini(apiKey, prompt, imageBase64, imageMime, gatewayEndpoint, models) {
  const list = (models && models.length) ? models : DEFAULT_MODELS;
  const base = gatewayEndpoint || 'https://generativelanguage.googleapis.com';

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: imageMime || 'image/jpeg',
        data: imageBase64,
      },
    });
  }

  const payload = { contents: [{ parts }] };

  let lastReason = '';
  for (const model of list) {
    const url = `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      const data = await res.json();

      // 한도 초과(quota/rate limit) → 다음 모델로 즉시 전환
      if (res.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED') {
        lastReason = data.error?.message || 'quota exceeded';
        console.warn(`Gemini ${model} 한도초과 → 다음 모델:`, lastReason);
        continue;
      }

      // 빈 응답 / 차단 → 다음 모델로 전환
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        lastReason = data.error?.message || data.promptFeedback?.blockReason || JSON.stringify(data).slice(0, 200);
        console.warn(`Gemini ${model} 빈 응답 → 다음 모델:`, lastReason);
        continue;
      }

      console.log(`Gemini ${model} 분석 성공`);
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      lastReason = e.message;
      console.warn(`Gemini ${model} 호출 실패 → 다음 모델:`, e.message);
      continue;
    }
  }

  throw new Error(`Gemini 응답 없음 (모든 모델 실패): ${lastReason}`);
}

export async function downloadImageBase64(imageUrl) {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const contentType = res.headers.get('Content-Type') || 'image/jpeg';
    return { base64, contentType };
  } catch (e) {
    console.log('Image download failed:', e.message);
    return { base64: null, contentType: null };
  }
}

export async function analyzePost(apiKey, postData, gatewayEndpoint, models) {
  const imageUrl = postData.image_url || '';
  const hasText = !!(postData.text || '').trim();
  const hasImage = !!imageUrl;

  let imageBase64 = null;
  let imageMime = 'image/jpeg';
  if (hasImage) {
    const result = await downloadImageBase64(imageUrl);
    if (result.base64) {
      imageBase64 = result.base64;
      imageMime = result.contentType;
      console.log('Image downloaded for analysis');
    }
  }

  let context;
  if (hasText && imageBase64) {
    context = `작성자: ${postData.author || 'Unknown'}\n텍스트: ${postData.text || ''}\n\n이미지도 첨부되어 있습니다. 텍스트와 이미지를 모두 분석해주세요.`;
  } else if (imageBase64) {
    context = `작성자: ${postData.author || 'Unknown'}\n\n이 게시물은 이미지만 있습니다. 이미지 내용을 분석해주세요.`;
  } else {
    context = `작성자: ${postData.author || 'Unknown'}\n내용: ${postData.text || '내용 없음'}`;
  }

  const prompt = `다음 Threads 게시물을 분석해주세요.

${context}

다음 형식으로 정확히 응답해주세요 (JSON만, 다른 텍스트 없이):
{
    "category": "글의 주제에 가장 맞는 카테고리를 하나 선택하세요. 예시: AI, 마케팅, 자기계발, 비즈니스, 기술, 디자인, 라이프스타일, 금융/투자, 건강/운동, 육아/교육, 요리/음식, 부동산, 커리어, 생산성, 심리학, 과학, 정치/경제, 여행, 문화/예술, 유머, 인간관계 등. 이 목록에 없어도 적절한 카테고리를 직접 만들어도 됩니다. 한국어로 짧게 (2-4글자).",
    "tags": ["구체적인 태그 3-5개. 글의 핵심 키워드를 한국어로"],
    "summary": "원문의 핵심 포인트를 빠짐없이 나열하세요. '이런 내용이다'가 아니라 실제 내용을 적으세요. 예를 들어 '4가지 요소를 설명'이 아니라 '1.대장주여부 2.테마 3.상승추세 4.거래대금'처럼 구체적으로. 이미지가 있으면 이미지 내용도 설명. (한국어, 2-4문장)",
    "summary_short": "위 summary의 핵심만 완전한 한 문장으로 요약. 문장이 잘리면 안 됩니다. (한국어, 1문장)",
    "insight": "이 글의 핵심 교훈과 실제 적용법을 구체적으로 설명하세요. 원문에서 언급된 수치, 방법론, 사례를 반드시 포함하세요. (한국어, 3-4문장)",
    "insight_short": "위 insight의 핵심만 완전한 한 문장으로 요약. 문장이 잘리면 안 됩니다. (한국어, 1문장)",
    "sentiment": "positive/negative/neutral/informative 중 하나"
}`;

  const result = await callGemini(apiKey, prompt, imageBase64, imageMime, gatewayEndpoint, models);
  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      category: '기타',
      tags: [],
      summary: '분석 결과 파싱 실패',
      insight: (result || '').slice(0, 200),
      sentiment: 'neutral',
    };
  }
}
