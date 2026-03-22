/**
 * Telegram Bot API 헬퍼
 */

export async function sendMessage(token, chatId, text, parseMode) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  if (text.length > 4000) {
    const chunks = [];
    let remaining = text;
    while (remaining) {
      if (remaining.length <= 4000) {
        chunks.push(remaining);
        break;
      }
      let split = remaining.lastIndexOf('\n', 4000);
      if (split === -1) split = 4000;
      chunks.push(remaining.slice(0, split));
      remaining = remaining.slice(split).replace(/^\n+/, '');
    }
    for (const chunk of chunks) {
      const body = { chat_id: chatId, text: chunk };
      if (parseMode) body.parse_mode = parseMode;
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        console.error('Telegram send failed:', e.message);
      }
    }
    return;
  }

  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error('Telegram send failed:', e.message);
    return null;
  }
}

export async function setWebhook(token, webhookUrl) {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });
  return await res.json();
}
