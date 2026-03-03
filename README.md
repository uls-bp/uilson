# UILSON — AI業務アシスタント

Gmail・Google Calendar・（将来Slack）を統合した AI 業務アシスタントプラットフォーム。

## デプロイ手順

### 必要なもの（すべて無料で取得可能）

1. **GitHubアカウント** → https://github.com
2. **Vercelアカウント** → https://vercel.com （GitHubで登録）
3. **Anthropic APIキー** → https://console.anthropic.com
4. **Google Cloud Client ID** → https://console.cloud.google.com

---

### ステップ1: GitHubにリポジトリを作成

1. https://github.com/new を開く
2. Repository name: `uilson-app`
3. 「Create repository」をクリック
4. 「uploading an existing file」をクリック
5. このフォルダの全ファイルをドラッグ＆ドロップ
6. 「Commit changes」をクリック

### ステップ2: Anthropic APIキーを取得

1. https://console.anthropic.com にログイン
2. 「API Keys」→「Create Key」
3. キーをコピーして保管（`sk-ant-...` で始まるもの）

### ステップ3: Google OAuth Client IDを取得

1. https://console.cloud.google.com にログイン
2. 新しいプロジェクトを作成（名前: UILSON）
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」
4. アプリの種類: 「ウェブアプリケーション」
5. 承認済みJavaScriptオリジン: `http://localhost:5173` と Vercelのドメイン（後で追加）
6. 「作成」→ Client IDをコピー
7. 「APIとサービス」→「ライブラリ」で以下を有効化:
   - Gmail API
   - Google Calendar API

### ステップ4: Vercelにデプロイ

1. https://vercel.com にログイン（GitHubアカウントで）
2. 「Add New Project」→ GitHubの `uilson-app` を選択
3. 「Environment Variables」に以下を追加:
   - `ANTHROPIC_API_KEY` = ステップ2のキー
   - `VITE_GOOGLE_CLIENT_ID` = ステップ3のClient ID
4. 「Deploy」をクリック
5. URLが発行される（例: `uilson-app.vercel.app`）

### ステップ5: Google OAuthにVercelドメインを追加

1. Google Cloud Console → 認証情報 → 作成したOAuth Client
2. 承認済みJavaScriptオリジンに `https://uilson-app.vercel.app` を追加
3. 保存

---

## 完了！

`https://uilson-app.vercel.app` にアクセスすると UILSON が使えます。
Googleアカウントを接続すれば、Gmail・Calendarのデータを元にAIが応答します。