export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const { messages } = req.body;

    const systemPrompt = `あなたはプレゼンテーション資料の構成を設計するAIアシスタントです。
ユーザーの要望に基づいて、スライド構成をJSON形式で生成してください。

必ず以下のJSON形式で応答してください。JSONのみを返し、他のテキストは含めないでください。

{
  "slides": [
    {
      "id": 1,
      "title": "スライドタイトル",
      "layout": "cover|content|chart|bullets|comparison|closing",
      "layoutLabel": "レイアウト種別（例：表紙, 箇条書き, グラフ, 比較表, まとめ）",
      "heading": "スライドの見出し",
      "sub": "サブタイトルや補足テキスト",
      "body": "本文テキスト（箇条書きの場合は改行区切り）",
      "note": "備考やフッターテキスト（省略可）",
      "bg": "背景色（CSS色コード。coverは#1E2D50等の暗い色、contentは#FFFFFF等）",
      "light": true/false（背景が暗い場合はtrue）,
      "dataSrc": ["データソース名の配列（例：売上DB、顧客リスト）空配列可"]
    }
  ],
  "summary": "プレゼン全体の概要（1文）"
}

ルール:
- スライド数はユーザー指定があればそれに従う。なければ6〜10枚程度
- 最初のスライドはlayout:"cover"にする
- 最後のスライドはlayout:"closing"にする
- coverとclosingのbgは暗い色（#1E2D50, #2B4070等）でlight:true
- contentスライドのbgは明るい色（#FFFFFF, #F5F6FA等）でlight:false
- chartスライドのbgも明るい色
- 日本語で作成する
- 具体的で実用的な内容にする`;

    const claudeMessages = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: claudeMessages
      })
    });

    const data = await resp.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'Claude API error' });
    }

    const text = data.content?.[0]?.text || '';

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json(parsed);
    } catch (parseErr) {
      // If JSON parsing fails, return the raw text for the chat
      return res.status(200).json({
        slides: [],
        summary: '',
        rawText: text
      });
    }
  } catch (err) {
    console.error('generate-slides error:', err);
    return res.status(500).json({ error: err.message });
  }
}
