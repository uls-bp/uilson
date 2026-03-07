// Default slides shown before AI generation
export const DEFAULT_SLIDES = [
  {
    id: 1,
    title: "表紙",
    layout: "cover",
    layoutLabel: "表紙レイアウト",
    heading: "UILSONで実現する\nAIオーケストレーション",
    sub: "〜 業務を理解し、判断し、実行するAI 〜",
    body: "",
    note: "営業部 部長 山田直樹 | 2026年2月",
    bg: "linear-gradient(135deg,#2B4070,#3C5996)",
    light: true,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }],
    dataSrc: []
  },
  {
    id: 2,
    title: "課題",
    layout: "body",
    layoutLabel: "3カラム",
    heading: "現場が抱える3つの課題",
    sub: "",
    body: "① 情報が分散：Salesforce、Excel、Teams、Notion…判断に必要な情報がバラバラ\n② 属人化：ベテランのノウハウが頭の中だけにある\n③ 手作業の繰り返し：毎月同じレポート作成に2時間",
    note: "",
    bg: "#FFFFFF",
    light: false,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }, { part: "アイコン画像", model: "nanobanana", icon: "🍌" }],
    dataSrc: ["Teams", "SharePoint"]
  },
  {
    id: 3,
    title: "解決策",
    layout: "body",
    layoutLabel: "2カラム（比較）",
    heading: "UILSONとは？",
    sub: "AIが業務を「理解」して「判断」するプラットフォーム",
    body: "RPAとの違い：\n• RPA → 手順通りに自動実行（ロボット）\n• UILSON → 状況を理解して判断（AI + 実行）\n\n「最近やばい案件ある？」と聞くだけで、\nSalesforce・SharePoint・Teams・メールを横断分析",
    note: "",
    bg: "#FFFFFF",
    light: false,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }, { part: "比較図", model: "nanobanana", icon: "🍌" }],
    dataSrc: []
  },
  {
    id: 4,
    title: "デモ",
    layout: "body",
    layoutLabel: "フローチャート",
    heading: "デモ：「やばい案件ある？」",
    sub: "",
    body: "1. 曖昧な質問をAIに投げる\n2. AIが4つのシステムを横断して情報収集\n3. リスクを判断して結果を提示\n4. 対応アクションを個別に選択して実行\n\n→ RPAにはできない「判断」と「提案」",
    note: "※ 実際のデモ画面をお見せします",
    bg: "linear-gradient(135deg,rgba(60,89,150,0.04),rgba(171,205,0,0.06))",
    light: false,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }, { part: "フロー図", model: "nanobanana", icon: "🍌" }],
    dataSrc: ["Salesforce", "Teams", "メール"]
  },
  {
    id: 5,
    title: "学習",
    layout: "body",
    layoutLabel: "ステップ図（横）",
    heading: "暗黙知の学習プロセス",
    sub: "ベテランのノウハウをAIが引き継ぐ",
    body: "① 「この作業を覚えて」とAIに依頼\n② 普段通り作業する（AIがバックグラウンドで観察）\n③ AIが「なぜそうするのか？」を対話で聞き出す\n④ スキルとして登録 → チームに共有\n\n事例：月次レポート作成 2時間 → 3分",
    note: "",
    bg: "#FFFFFF",
    light: false,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }, { part: "ステップ図", model: "nanobanana", icon: "🍌" }],
    dataSrc: []
  },
  {
    id: 6,
    title: "効果",
    layout: "body",
    layoutLabel: "KPIカード × 4",
    heading: "期待される効果",
    sub: "",
    body: "• 月間削減工数：142時間（全社）\n• コスト削減：月額¥2.1M\n• リスク検知：B社の¥3,200万の失注を未然に防止\n• 属人化解消：ベテランのノウハウを85%スキル化",
    note: "",
    bg: "#FFFFFF",
    light: false,
    ai: [{ part: "テキスト", model: "claude", icon: "🟣" }, { part: "KPIグラフ", model: "chatgpt", icon: "🟢" }],
    dataSrc: ["Salesforce", "freee会計", "勤怠"]
  }
];

export const MODEL_COLORS = {
  claude: "#7C3AED",
  chatgpt: "#10A37F",
  gemini: "#4285F4",
  nanobanana: "#F59E0B"
};

export const MODEL_NAMES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  nanobanana: "Nano Banana"
};

export const LAYOUT_ICONS = {
  "表紙レイアウト": "🎨",
  "3カラム": "|||",
  "2カラム（比較）": "⇄",
  "フローチャート": "→",
  "ステップ図（横）": "①②③",
  "KPIカード × 4": "▣▣",
  "コンテンツ": "▦",
  "表紙": "🎨"
};

export const CREATE_CHAT = [
  { role: "user", text: "AIオーケストレーションについて経営層向けのプレゼンを作りたい。UILSONの強みが伝わるように。" },
  { role: "ai", text: "承知しました。ソースに登録された2つの資料を確認しました。\n\n🎨 ULS会社テンプレート → 配色・フォント・ロゴを適用します\n📊 Q3取締役会報告 → 構成パターンを参考にします\n\nいくつか確認させてください。\n1. 聴衆は経営層（ITリテラシー高くない）でよいですか？\n2. プレゼンの長さは何分くらい？\n3. 伝えたいゴールは「導入承認」ですか？" },
  { role: "user", text: "そう、15分くらいで社長と役員に向けて。RPAとの違いを明確にしたい。" },
  { role: "ai", text: "了解です。Q3資料の「課題→提案→効果」の構成をベースに6枚作ります：\n\n① 表紙\n② 課題（情報分散・属人化・手作業）\n③ 解決策（UILSONとは？ RPAとの違い）\n④ デモ（やばい案件ある？の実演）\n⑤ 学習（暗黙知の引き継ぎプロセス）\n⑥ 効果（数字で示す）\n\nこの構成でよければ、コンテンツを生成します。" },
  { role: "user", text: "いいね、それで作って。" },
  { role: "ai", text: "✅ 6枚のスライドを生成しました。\n\nAI割り当て：\n🟣 Claude → テキスト構成・本文\n🍌 Nano Banana → 図解・アイコン画像\n🟢 ChatGPT → KPIグラフ（スライド6）\n\n社内データ参照：\n📊 Salesforce, 💰 freee会計 から実数値を取得済み\n\n修正があればお知らせください。" }
];

export const DEFAULT_SOURCES = [
  { id: 1, name: "ULS会社テンプレート.pptx", type: "file", icon: "🎨" },
  { id: 2, name: "Q3取締役会報告.pdf", type: "file", icon: "📊" }
];

export const AI_ORCHESTRATION_STATUS = [
  { model: "claude", icon: "🟣", task: "構成・本文", status: "done" },
  { model: "nanobanana", icon: "🍌", task: "図解5点", status: "done" },
  { model: "chatgpt", icon: "🟢", task: "KPIグラフ", status: "done" }
];

export const XLSX_CHAT = [
  {
    role: "user",
    text: "経費レポートのExcelファイルを作成してもらえますか？部門別の支出をまとめたいんです"
  },
  {
    role: "ai",
    text: "もちろんです。部門別の経費をまとめたExcelファイルを作成します。月別推移、部門別比較、予算との差分分析を含めるのはどうでしょう？"
  },
  {
    role: "user",
    text: "いいですね。あと営業部と開発部、経理部のそれぞれのシートがあると使いやすいな"
  },
  {
    role: "ai",
    text: "了解です。部門別に3つのシートを作成し、それぞれの詳細データと合計シートを付けます。また自動計算機能も組み込みますね。"
  },
  {
    role: "user",
    text: "完璧です。よろしくお願いします"
  },
  {
    role: "ai",
    text: "経費レポートのExcelファイルが完成しました。部門別シート、合計集計シート、グラフ付きで準備できています。ダウンロードしてご利用ください。"
  }
];

export const DOCX_CHAT = [
  {
    role: "user",
    text: "新規プロジェクトの提案書をWord形式で作成してほしいです。クライアントに提出するものなので、見栄えも大事です"
  },
  {
    role: "ai",
    text: "承知しました。クライアント向けの提案書を作成します。プロジェクト概要、実行計画、予算、期待効果などを含めた構成でいいですか？"
  },
  {
    role: "user",
    text: "そうですね。あと会社のロゴやヘッダーフッターも入れてもらえますか？"
  },
  {
    role: "ai",
    text: "もちろんです。会社ロゴを挿入し、プロフェッショナルなヘッダーフッターを設定します。フォント、色、レイアウトもプレミアムな仕上がりにしますね。"
  },
  {
    role: "user",
    text: "それで完璧です。作成お願いします"
  },
  {
    role: "ai",
    text: "提案書のWord文書が完成しました。カラフルなデザイン、会社ブランディングを反映させています。ダウンロードしてご確認ください。"
  }
];
