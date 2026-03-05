// Default slides shown before AI generation
export const DEFAULT_SLIDES = [
  {
    id: 1,
    title: "表紙",
    layout: "cover",
    layoutLabel: "表紙",
    heading: "プレゼン資料",
    sub: "AIで自動生成されたスライド",
    body: "",
    note: "UILSON",
    bg: "#1E2D50",
    light: true,
    dataSrc: []
  },
  {
    id: 2,
    title: "目次",
    layout: "content",
    layoutLabel: "コンテンツ",
    heading: "目次",
    sub: "",
    body: "左のチャットでプレゼンの内容を入力してください。\nAIが自動でスライド構成を生成します。",
    note: "",
    bg: "#FFFFFF",
    light: false,
    dataSrc: []
  }
];

export const MODEL_COLORS = {
  claude: "#D97757",
  chatgpt: "#10A37F",
  gemini: "#4285F4"
};

export const MODEL_NAMES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini"
};

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
