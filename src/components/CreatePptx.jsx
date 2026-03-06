import { useState, useRef, useEffect } from "react";
import { DEFAULT_SLIDES, MODEL_COLORS, MODEL_NAMES } from "../data/slides";

const V = {
  bg:"#F0F2F7", sb:"#FFFFFF", main:"#F5F6FA", card:"#FFFFFF", border:"#DDE1EB",
  border2:"#C8CDD8", t1:"#333333", t2:"#555555", t3:"#888888", t4:"#AAAAAA",
  white:"#FFFFFF", accent:"#3C5996", teal:"#2B4070", navy:"#1E2D50", blue:"#3C5996",
  red:"#C83732", green:"#2E7D32", orange:"#D4880F", lime:"#ABCD00"
};

export default function CreatePptx({ setView }) {
  const [slides, setSlides] = useState(DEFAULT_SLIDES);
  const [curSlide, setCurSlide] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || generating) return;

    const userMsg = { role: "user", content: text };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setGenerating(true);

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, mode: "full" })
      });
      const data = await res.json();

      if (data.error) {
        setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + data.error }]);
      } else if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setGenerated(true);
        setPreviewing(false);
        const summary = data.summary || `${data.slides.length}枚のスライドを生成しました。`;
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `${summary}\n\n構成パネルで各スライドの本文を確認してください。\n修正はチャットで指示できます。\n内容OKなら「PPTプレビュー」で確認できます。`
        }]);
      } else if (data.rawText) {
        setChatMessages(prev => [...prev, { role: "assistant", content: data.rawText }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + err.message }]);
    }
    setGenerating(false);
  };

  const regenerate = async () => {
    if (generating || chatMessages.length === 0) return;
    const regenMessages = [...chatMessages, { role: "user", content: "スライドを再生成してください。別のアプローチや表現で作り直してください。" }];
    setChatMessages(regenMessages);
    setGenerating(true);

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: regenMessages, mode: "full" })
      });
      const data = await res.json();

      if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setGenerated(true);
        setPreviewing(false);
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `再生成しました（${data.slides.length}枚）。構成パネルで確認してください。`
        }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "再生成エラー: " + err.message }]);
    }
    setGenerating(false);
  };

  const downloadPptx = async () => {
    if (downloading || !generated || slides.length < 2) return;
    setDownloading(true);

    try {
      if (!window.PptxGenJS) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgenjs.bundle.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const pptx = new window.PptxGenJS();
      pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
      pptx.layout = "WIDE";

      for (const s of slides) {
        const pptSlide = pptx.addSlide();
        const bgColor = (s.bg || "#FFFFFF").replace("#", "");
        pptSlide.background = { color: bgColor };
        const textColor = s.light ? "FFFFFF" : "333333";
        const subColor = s.light ? "CCCCCC" : "888888";

        if (s.layout === "cover" || s.layout === "closing") {
          pptSlide.addText(s.heading || s.title, {
            x: 0.5, y: 2.0, w: 12.33, h: 1.5,
            fontSize: 36, fontFace: "Yu Gothic",
            color: textColor, bold: true, align: "center"
          });
          if (s.sub) {
            pptSlide.addText(s.sub, {
              x: 0.5, y: 3.8, w: 12.33, h: 0.8,
              fontSize: 18, fontFace: "Yu Gothic",
              color: subColor, align: "center"
            });
          }
          if (s.note) {
            pptSlide.addText(s.note, {
              x: 9, y: 6.5, w: 4, h: 0.5,
              fontSize: 10, fontFace: "Yu Gothic",
              color: subColor, align: "right"
            });
          }
        } else {
          pptSlide.addText(s.heading || s.title, {
            x: 0.5, y: 0.3, w: 12.33, h: 1.0,
            fontSize: 28, fontFace: "Yu Gothic",
            color: textColor, bold: true
          });
          if (s.sub) {
            pptSlide.addText(s.sub, {
              x: 0.5, y: 1.3, w: 12.33, h: 0.6,
              fontSize: 14, fontFace: "Yu Gothic",
              color: subColor
            });
          }
          if (s.body) {
            const bodyY = s.sub ? 2.1 : 1.5;
            pptSlide.addText(s.body, {
              x: 0.5, y: bodyY, w: 12.33, h: 4.5,
              fontSize: 16, fontFace: "Yu Gothic",
              color: textColor, lineSpacingMultiple: 1.5,
              valign: "top"
            });
          }
        }
      }

      await pptx.writeFile({ fileName: "UILSON_presentation.pptx" });
    } catch (err) {
      alert("ダウンロードエラー: " + err.message);
    }
    setDownloading(false);
  };

  const slide = slides[curSlide] || slides[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: V.main }}>
      {/* Top Bar */}
      <div style={{
        padding: "16px 24px",
        borderBottom: `1px solid ${V.border}`,
        background: V.white,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
          <button
            onClick={() => setView("create-menu")}
            style={{
              padding: "8px 14px", borderRadius: 6,
              border: `1px solid ${V.border}`, background: V.white,
              cursor: "pointer", fontSize: 14, color: V.t2, fontWeight: 500,
              transition: "all 0.2s"
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = V.main}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = V.white}
          >
            ← 作るメニュー
          </button>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: V.t1, margin: 0 }}>
            📊 プレゼン資料を作る
          </h1>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={() => setPreviewing(true)}
            disabled={!generated}
            style={{
              padding: "8px 16px", borderRadius: 6,
              border: `1px solid ${generated ? V.accent : V.border}`,
              background: !generated ? V.main : previewing ? `${V.accent}15` : V.white,
              cursor: !generated ? "not-allowed" : "pointer",
              fontSize: 13, color: generated ? V.accent : V.t4, fontWeight: 600,
              opacity: !generated ? 0.5 : 1,
              transition: "all 0.2s"
            }}
          >
            👁️ PPTプレビュー
          </button>
          <button
            onClick={downloadPptx}
            disabled={downloading || !generated}
            style={{
              padding: "8px 16px", borderRadius: 6,
              border: `1px solid ${generated ? V.green : V.border}`,
              background: !generated ? V.main : `${V.green}10`,
              cursor: (!generated || downloading) ? "not-allowed" : "pointer",
              fontSize: 13, color: generated ? V.green : V.t4, fontWeight: 600,
              opacity: !generated ? 0.5 : 1,
              transition: "all 0.2s"
            }}
          >
            {downloading ? "⏳ 生成中..." : "📥 ダウンロード"}
          </button>
          <button
            onClick={regenerate}
            disabled={generating || chatMessages.length === 0}
            style={{
              padding: "8px 16px", borderRadius: 6,
              border: `1px solid ${V.border}`,
              background: generating ? V.main : V.white,
              cursor: generating ? "wait" : "pointer",
              fontSize: 13, color: V.t2, fontWeight: 500,
              opacity: chatMessages.length === 0 ? 0.5 : 1,
              transition: "all 0.2s"
            }}
          >
            🔄 再生成
          </button>
        </div>
      </div>

      {/* Main Content - 3 Panels */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: 0 }}>

        {/* Left: Chat (30%) */}
        <div style={{
          flex: "0 0 30%",
          borderRight: `1px solid ${V.border}`,
          display: "flex", flexDirection: "column",
          background: V.card, overflow: "hidden"
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${V.border}`,
            fontSize: "12px", fontWeight: 600, color: V.t3
          }}>
            💬 チャット
          </div>

          <div style={{
            flex: 1, overflowY: "auto", padding: "12px",
            display: "flex", flexDirection: "column", gap: "8px"
          }}>
            {chatMessages.length === 0 && (
              <div style={{
                padding: "20px", textAlign: "center", color: V.t4, fontSize: "12px",
                lineHeight: 1.6
              }}>
                プレゼン資料の内容を入力してください。<br/>
                例: 「営業チーム向けの月次報告を8枚で作って」<br/>
                例: 「新製品発表のプレゼンを作って」
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                style={{
                  padding: "10px", borderRadius: "8px",
                  background: msg.role === "user" ? V.accent : V.main,
                  color: msg.role === "user" ? V.white : V.t2,
                  fontSize: "12px", lineHeight: 1.5,
                  whiteSpace: "pre-wrap", wordBreak: "break-word"
                }}
              >
                {msg.content}
              </div>
            ))}
            {generating && (
              <div style={{
                padding: "10px", borderRadius: "8px",
                background: V.main, color: V.t3,
                fontSize: "12px", fontStyle: "italic"
              }}>
                🤖 スライドを生成中...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{
            padding: "12px", borderTop: `1px solid ${V.border}`,
            display: "flex", gap: "8px"
          }}>
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="プレゼンの内容を入力..."
              disabled={generating}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: "6px",
                border: `1px solid ${V.border}`, fontSize: "12px",
                backgroundColor: V.white
              }}
            />
            <button
              onClick={sendChat}
              disabled={generating || !chatInput.trim()}
              style={{
                padding: "8px 12px", borderRadius: "6px",
                border: "none", background: generating ? V.t4 : V.accent,
                color: V.white, cursor: generating ? "wait" : "pointer",
                fontSize: "12px", fontWeight: 600, transition: "all 0.2s"
              }}
            >
              送信 →
            </button>
          </div>
        </div>

        {/* Center: Composition / Text Review (35%) */}
        <div style={{
          flex: "0 0 35%",
          borderRight: `1px solid ${V.border}`,
          display: "flex", flexDirection: "column",
          background: V.white, overflow: "hidden"
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${V.border}`,
            fontSize: "12px", fontWeight: 600, color: V.t3,
            display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            <span>📑 構成・本文確認</span>
            <span style={{ fontSize: "11px", color: V.t4 }}>{slides.length}枚</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            {slides.map((s, i) => (
              <div
                key={s.id}
                onClick={() => { setCurSlide(i); if (previewing) setPreviewing(true); }}
                style={{
                  padding: "14px", borderRadius: "6px",
                  background: curSlide === i ? `${V.accent}08` : V.main,
                  cursor: "pointer", marginBottom: "10px",
                  fontSize: "12px",
                  border: `1px solid ${curSlide === i ? V.accent : V.border}`,
                  transition: "all 0.2s"
                }}
              >
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: "6px"
                }}>
                  <span style={{ fontWeight: 700, color: V.t1 }}>
                    {s.id}. {s.heading || s.title}
                  </span>
                  <span style={{
                    fontSize: "10px", padding: "2px 8px", borderRadius: "10px",
                    background: V.border, color: V.t3
                  }}>
                    {s.layoutLabel || s.layout}
                  </span>
                </div>
                {s.sub && (
                  <div style={{ fontSize: "12px", color: V.t2, marginBottom: "6px", fontWeight: 500 }}>
                    {s.sub}
                  </div>
                )}
                {s.body && (
                  <div style={{
                    fontSize: "12px", lineHeight: 1.6, color: V.t2,
                    whiteSpace: "pre-wrap",
                    borderTop: `1px solid ${V.border}`,
                    paddingTop: "8px", marginTop: "4px"
                  }}>
                    {s.body}
                  </div>
                )}
                {s.note && (
                  <div style={{ fontSize: "11px", color: V.t4, marginTop: "6px", fontStyle: "italic" }}>
                    💡 {s.note}
                  </div>
                )}
                {s.dataSrc && s.dataSrc.length > 0 && (
                  <div style={{ fontSize: "10px", color: V.t4, marginTop: "4px" }}>
                    📊 {s.dataSrc.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Preview (35%) - empty until "PPTプレビュー" clicked */}
        <div style={{
          flex: "0 0 35%",
          display: "flex", flexDirection: "column",
          background: V.main, overflow: "hidden"
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${V.border}`,
            fontSize: "12px", fontWeight: 600, color: V.t3,
            background: V.white,
            display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            <span>👁️ プレビュー</span>
            {previewing && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setCurSlide(Math.max(0, curSlide - 1))}
                  disabled={curSlide === 0}
                  style={{
                    padding: "3px 7px", borderRadius: "4px",
                    border: `1px solid ${V.border}`, background: V.white,
                    cursor: curSlide === 0 ? "default" : "pointer",
                    fontSize: "11px", opacity: curSlide === 0 ? 0.3 : 1
                  }}
                >◀</button>
                <span style={{ fontSize: "11px", color: V.t4 }}>
                  {curSlide + 1} / {slides.length}
                </span>
                <button
                  onClick={() => setCurSlide(Math.min(slides.length - 1, curSlide + 1))}
                  disabled={curSlide === slides.length - 1}
                  style={{
                    padding: "3px 7px", borderRadius: "4px",
                    border: `1px solid ${V.border}`, background: V.white,
                    cursor: curSlide === slides.length - 1 ? "default" : "pointer",
                    fontSize: "11px", opacity: curSlide === slides.length - 1 ? 0.3 : 1
                  }}
                >▶</button>
              </div>
            )}
          </div>

          {!previewing ? (
            /* Empty state */
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              padding: "24px", textAlign: "center"
            }}>
              <div style={{ color: V.t4, fontSize: "13px", lineHeight: 1.6 }}>
                <div style={{ fontSize: "40px", marginBottom: "12px", opacity: 0.3 }}>📊</div>
                テキスト内容を確定したら<br/>
                「PPTプレビュー」で確認できます
              </div>
            </div>
          ) : (
            /* Slide preview */
            <>
              <div style={{
                flex: 1, overflow: "auto", padding: "20px",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <div
                  style={{
                    width: "100%", maxWidth: "520px",
                    aspectRatio: "16 / 9",
                    borderRadius: "8px",
                    background: slide.bg || "#FFFFFF",
                    border: `1px solid ${V.border}`,
                    display: "flex", flexDirection: "column",
                    alignItems: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    justifyContent: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    padding: "28px",
                    color: slide.light ? V.white : V.t1,
                    overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    position: "relative"
                  }}
                >
                  {(slide.layout === "cover" || slide.layout === "closing") ? (
                    <>
                      <div style={{
                        fontSize: "28px", fontWeight: 800,
                        textAlign: "center", lineHeight: 1.3, marginBottom: "16px"
                      }}>
                        {slide.heading || slide.title}
                      </div>
                      {slide.sub && (
                        <div style={{ fontSize: "13px", textAlign: "center", opacity: 0.9 }}>
                          {slide.sub}
                        </div>
                      )}
                      {slide.note && (
                        <div style={{
                          position: "absolute", bottom: "16px", right: "20px",
                          fontSize: "10px", opacity: 0.7
                        }}>
                          {slide.note}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: "22px", fontWeight: 800, marginBottom: "10px" }}>
                        {slide.heading || slide.title}
                      </div>
                      {slide.sub && (
                        <div style={{
                          fontSize: "12px",
                          color: slide.light ? "rgba(255,255,255,0.8)" : V.t3,
                          marginBottom: "12px", fontWeight: 500
                        }}>
                          {slide.sub}
                        </div>
                      )}
                      <div style={{
                        fontSize: "11px", lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        opacity: slide.light ? 0.9 : 1,
                        overflow: "auto", flex: 1, width: "100%"
                      }}>
                        {slide.body}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{
                padding: "10px 16px",
                borderTop: `1px solid ${V.border}`,
                background: V.white,
                fontSize: "11px", color: V.t4
              }}>
                <strong>{slide.heading || slide.title}</strong> — {slide.layoutLabel || slide.layout}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
