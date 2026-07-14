# AI商談エンジン — Zoom/Google Meet連携リレーサーバー

`ai-meeting.html`をZoom・Google Meetの実会議に接続するための最小サーバー（Node.js／Express）。詳しいセットアップ手順は [../kit/zoom-meet-integration-guide.md](../kit/zoom-meet-integration-guide.md) を参照してください。

## クイックスタート

```bash
npm install
RECALL_API_KEY=... OPENAI_API_KEY=... AI_MEETING_PAGE_URL=https://fuuuuuuma.github.io/gpt-live-guide-ja/ai-meeting.html PUBLIC_BASE_URL=https://your-server.example.com node index.js
```

## エンドポイント

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/create-bot` | 会議URLを受け取り、Recall.aiにボット参加をリクエストする |
| POST | `/api/recall-webhook` | Recall.aiからのリアルタイム文字起こしを受け取る |
| GET | `/api/session/:id` | ボット用ページが自社ノウハウ・会社名を読み込む |
| GET | `/api/realtime-token` | OpenAIの短命なclient_secretを発行する |
| POST | `/api/generate-minutes` | 蓄積した文字起こしから議事録・見積もりを生成する |
| GET | `/api/health` | ヘルスチェック |

環境変数が未設定のエンドポイントは、クラッシュせず`{"error": "..."}`を返します。

## 注意

デモ用の最小構成です。文字起こしはメモリ上に保持しており、サーバー再起動で消えます。本番運用時のデータ永続化・Webhook署名検証については、統合ガイドの「本番化のヒント」を参照してください。
