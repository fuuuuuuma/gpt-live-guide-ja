// AI商談エンジンをZoom / Google Meetの実会議に接続するためのリレーサーバー
//
// 役割は3つだけ:
//   1. Recall.aiにボット参加をリクエストする（ボットの「顔」= ai-meeting.html を会議に映す）
//   2. Recall.aiからのリアルタイム文字起こしWebhookを受け取り、セッションごとに保存する
//   3. 商談終了後、保存した文字起こしをOpenAIに渡して議事録・見積もりドラフトを生成する
//
// 詳しいセットアップ手順は ../kit/zoom-meet-integration-guide.md を参照してください。

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));

const RECALL_API_KEY = process.env.RECALL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MEETING_PAGE_URL = process.env.AI_MEETING_PAGE_URL; // 例: https://fuuuuuuma.github.io/gpt-live-guide-ja/ai-meeting.html
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;         // 例: https://your-server.example.com（このサーバー自身の外部URL）

// デモ用の簡易ストア（プロセスのメモリ上に保持）。
// 本番運用では、複数インスタンス間で共有できるデータベース（Vercel KV / Upstash Redis 等）に置き換えてください。
const sessions = new Map(); // sessionId -> { knowhow, company, transcript: [{role, text}], botId }

function requireEnv(res, ...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) {
    res.status(500).json({ error: `サーバーの環境変数が未設定です: ${missing.join(', ')}` });
    return false;
  }
  return true;
}

// --- 1. ボットを会議に参加させる -------------------------------------------------
// POST /api/create-bot  body: { meetingUrl, knowhow, company }
app.post('/api/create-bot', async (req, res) => {
  if (!requireEnv(res, 'RECALL_API_KEY', 'AI_MEETING_PAGE_URL', 'PUBLIC_BASE_URL')) return;
  const { meetingUrl, knowhow, company } = req.body || {};
  if (!meetingUrl) return res.status(400).json({ error: 'meetingUrl は必須です（Zoom/Google MeetのURL）' });

  const sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  sessions.set(sessionId, { knowhow: knowhow || '', company: company || '', transcript: [], botId: null });

  const facePage = new URL(AI_MEETING_PAGE_URL);
  facePage.searchParams.set('session', sessionId);
  facePage.searchParams.set('server', PUBLIC_BASE_URL);
  facePage.searchParams.set('auto', '1');

  const webhookUrl = new URL('/api/recall-webhook', PUBLIC_BASE_URL);
  webhookUrl.searchParams.set('session', sessionId);

  try {
    const r = await fetch('https://api.recall.ai/api/v1/bot/', {
      method: 'POST',
      headers: { Authorization: RECALL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: company ? `${company} AI商談担当` : 'AI商談担当',
        output_media: {
          camera: { kind: 'webpage', config: { url: facePage.toString() } }
        },
        recording_config: {
          transcript: {
            provider: { recallai_streaming: { mode: 'prioritize_low_latency', language_code: 'ja' } }
          },
          realtime_endpoints: [
            { type: 'webhook', url: webhookUrl.toString(), events: ['transcript.data'] }
          ]
        }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    sessions.get(sessionId).botId = data.id;
    res.json({ sessionId, botId: data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 2. Recall.aiからのリアルタイム文字起こしWebhookを受け取る ------------------------
// POST /api/recall-webhook?session=xxx
app.post('/api/recall-webhook', (req, res) => {
  // 2xxを即座に返す（Recall.ai公式の要件）。重い処理はしない。
  res.sendStatus(200);
  const sessionId = req.query.session;
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = req.body || {};
  if (payload.event !== 'transcript.data') return;
  const words = payload.data && payload.data.data && payload.data.data.words;
  const participant = payload.data && payload.data.data && payload.data.data.participant;
  if (!Array.isArray(words) || !words.length) return;
  const text = words.map(w => w.text).join(' ').trim();
  if (!text) return;
  const role = participant && participant.name ? participant.name : '参加者';
  session.transcript.push({ role, text });

  // 本番で署名検証を行う場合はここに追加する（Recall.aiのワークスペース検証シークレットを使用）。
  // このデモでは省略しています。
});

// --- セッション情報の取得（ai-meeting.htmlが自身のノウハウ・会社名を読み込むのに使う） ------
app.get('/api/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'セッションが見つかりません' });
  res.json({ knowhow: session.knowhow, company: session.company });
});

// --- 3. OpenAI Realtime API用の短命トークンを発行する -------------------------------
// GET /api/realtime-token?session=xxx
// 通常のAPIキーをブラウザに渡さず、短命なclient_secretだけを渡す（OpenAI公式が推奨する方式）
app.get('/api/realtime-token', async (req, res) => {
  if (!requireEnv(res, 'OPENAI_API_KEY')) return;
  if (!sessions.has(req.query.session)) return res.status(404).json({ error: 'セッションが見つかりません' });
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: { type: 'realtime', model: 'gpt-realtime', audio: { output: { voice: 'marin' } } }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json({ value: data.value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 4. 商談終了後、議事録・見積もりドラフトを生成する -------------------------------
// POST /api/generate-minutes  body: { sessionId }
app.post('/api/generate-minutes', async (req, res) => {
  if (!requireEnv(res, 'OPENAI_API_KEY')) return;
  const session = sessions.get(req.body && req.body.sessionId);
  if (!session) return res.status(404).json({ error: 'セッションが見つかりません' });
  if (!session.transcript.length) return res.status(400).json({ error: 'まだ会話の記録がありません' });

  const log = session.transcript.map(t => `${t.role}: ${t.text}`).join('\n');
  const instructions =
    'あなたは商談の記録係です。渡される会話ログ（実際の会議の参加者ごとの発言）をもとに、日本語のMarkdownで次の2つを出力してください。\n' +
    '1. 「## 議事録」— 商談日は「本商談」、参加者は発言者名のまま、話し合った内容の要約（箇条書き）、決定事項、次のアクションを整理する。\n' +
    '2. 「## 見積もりドラフト」— 商談で言及された内容をもとに、項目と想定金額を表形式で示す。金額に関する情報が会話に無ければ「要ヒアリング」と書く。' +
    '末尾に必ず「※この見積もりはAIによる自動生成のドラフトです。金額・内容は必ず人間が確認してください」という一文を入れる。';

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5', instructions, input: log })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    let text = data.output_text;
    if (!text && Array.isArray(data.output)) {
      const msg = data.output.find(it => it.type === 'message');
      const oc = msg && Array.isArray(msg.content) && msg.content.find(c => c.type === 'output_text');
      text = oc && oc.text;
    }
    if (!text) return res.status(502).json({ error: '生成結果を読み取れませんでした' });
    res.json({ minutes: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI meeting relay server listening on :${PORT}`));
