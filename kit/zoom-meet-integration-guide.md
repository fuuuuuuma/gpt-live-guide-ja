# 🎁 Zoom / Google Meet 本格連携ガイド — AI商談エンジンを実会議に参加させる

[ai-meeting.html](https://fuuuuuuma.github.io/gpt-live-guide-ja/ai-meeting.html)（AI商談エンジン）を、実際のZoom・Google Meetの会議室にAIとして参加させるための、実際に動くサーバーコードとセットアップ手順です。`node index.js`で起動確認済みの本物のコードを配布しています（架空のサンプルではありません）。

**受け取り方**: このファイルのコードブロックをコピーするか、GitHubの[server/](../server/)フォルダから直接ファイルを取得してください。

## できること・できないこと（正直に）

- ✅ `ai-meeting.html`単体（サーバー無し）: マイクでAIと直接商談の会話ができ、終了時に議事録・見積もりドラフトを生成できます。**今すぐ試せます**
- ✅ この章の構成（サーバーあり）: Zoom・Google Meetの本物の会議室にAIをボットとして参加させ、人間の参加者とAIが実際に声で会話できます。会議終了後、サーバーに蓄積された文字起こしから議事録・見積もりを生成できます
- ❌ 当方がRecall.aiのアカウントを作成したり、サーバーを代わりにデプロイすることはできません。ご自身でアカウント作成・APIキー取得・デプロイを行う必要があります
- ❌ このサーバーコードはデモ用の最小構成です。文字起こしはプロセスのメモリ上に保存するため、**サーバーを再起動すると消えます**。本番運用ではデータベース（Vercel KV・Upstash Redis等）に置き換えてください

## 全体の仕組み

1. あなたが `POST /api/create-bot` を叩き、会議URL（Zoom/Google MeetのURL）を渡す
2. サーバーがRecall.aiにボット参加をリクエストする。このときボットの「顔」として `ai-meeting.html?session=xxx&server=...&auto=1` のURLを指定する
3. ボットが会議に参加すると、そのページが自動的に読み込まれ、サーバーから短命なOpenAIトークンを受け取ってAIとの音声接続を自動開始する（`auto=1`のため）
4. 会議の音声はボットの仮想マイク経由でAIに届き、AIの声はそのままボットの出力として会議室に流れる
5. Recall.aiはリアルタイムの文字起こしをWebhookでサーバーに送り続ける
6. 会議が終わったら `POST /api/generate-minutes` を叩くと、蓄積された文字起こしから議事録・見積もりドラフトが生成される

## セットアップ手順

### 1. Recall.aiのアカウントを作る

1. [recall.ai](https://www.recall.ai/) にアクセスし、アカウントを作成する（無料トライアルあり）
2. ダッシュボードでAPIキーを発行する
3. 料金は1時間あたり0.5ドル（ボットが会議に参加している時間の従量課金）です

### 2. サーバーをデプロイする

`server/`フォルダをRender・Fly.io・自前のVPSなど、Node.jsの常駐プロセスを動かせる環境にデプロイします（Vercelを使う場合は、通常のサーバーレス関数ではなくメモリ保持ができない点に注意し、下記「本番化のヒント」を参照してください）。

```bash
cd server
npm install
node index.js
```

環境変数を設定してください:

| 変数名 | 内容 |
|---|---|
| `RECALL_API_KEY` | Recall.aiのAPIキー |
| `OPENAI_API_KEY` | OpenAIの通常のAPIキー（サーバー側にのみ置く） |
| `AI_MEETING_PAGE_URL` | `https://fuuuuuuma.github.io/gpt-live-guide-ja/ai-meeting.html`（またはご自身でホストしたコピー） |
| `PUBLIC_BASE_URL` | デプロイ後のこのサーバー自身の外部URL（例: `https://your-server.onrender.com`） |
| `PORT` | 任意（既定3000） |

### 3. ボットを会議に参加させる

```bash
curl -X POST https://your-server.example.com/api/create-bot \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://zoom.us/j/xxxxxxxxxx",
    "knowhow": "弊社は中小企業向けにAIコンサルティングを提供しています。...",
    "company": "株式会社◯◯"
  }'
```

レスポンスの`sessionId`を控えておきます。ボットが会議に参加し、AIが自動で会話を始めます。

### 4. 商談終了後、議事録を生成する

```bash
curl -X POST https://your-server.example.com/api/generate-minutes \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "さっき控えたsessionId"}'
```

## 本番化のヒント

- **文字起こしの永続化**: 現状のコードはメモリ上の`Map`に保存しています。複数サーバーインスタンスやサーバーレス環境で使う場合は、Vercel KV・Upstash Redis・PostgreSQL等に置き換えてください
- **Webhookの署名検証**: Recall.aiはワークスペースの検証シークレットを使った署名検証を推奨しています。このデモでは省略しているので、本番では追加してください
- **APIキーの保護**: `RECALL_API_KEY`・`OPENAI_API_KEY`はどちらもサーバー側の環境変数にのみ置き、ブラウザ・ログ・リポジトリに残さないでください
- **会議終了の検知**: このデモは手動で`/api/generate-minutes`を叩く前提です。Recall.aiのボットステータスWebhook（`bot.status_change`等）を使えば、会議終了を検知して自動的に議事録生成を走らせることもできます

## 注意事項

- Recall.aiの利用には料金がかかります（1時間あたり0.5ドル）
- 会議を録音・AIに参加させることについて、参加者への事前の同意・明示が必要な場面が多いです。法的な扱いは国・業種によって異なるため、必ず確認してください
- 生成される見積もりは必ず「ドラフト」として扱い、金額の最終確認は人間が行ってください
