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
  const [curModel, setCurModel] = useState("claude");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // phase: "idle" → "outline" (構成案表示中) → "full" (本文生成済み)
  const [phase, setPhase] = useState("idle");
  const [isComposing, setIsComposing] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Step 1: Generate outline only
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
        body: JSON.stringify({ messages: newMessages, mode: "outline" })
      });
      const data = await res.json();

      if (data.error) {
        setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + data.error }]);
      } else if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setPhase("outline");
        const summary = data.summary || `${data.slides.length}枚の構成案を生成しました。`;
        const slideList = data.slides.map(s => `${s.id}. ${s.heading || s.title}（${s.layoutLabel || s.layout}）`).join("\n");
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `${summary}\n\n構成案:\n${slideList}\n\n構成を確認して、よければ中央パネルの「スライド生成」ボタンを押してください。\n修正があればチャットで指示してください。`
        }]);
      } else if (data.rawText) {
        setChatMessages(prev => [...prev, { role: "assistant", content: data.rawText }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + err.message }]);
    }
    setGenerating(false);
  };

  // Step 2: Generate full content based on confirmed outline
  const generateFull = async () => {
    if (generating || phase !== "outline") return;
    setGenerating(true);

    // Build messages that include the outline for context
    const outlineDesc = slides.map(s => `${s.id}. ${s.heading || s.title}（${s.layoutLabel || s.layout}）`).join("\n");
    const fullMessages = [
      ...chatMessages,
      {
        role: "user",
        content: `以下の構成案が確定しました。この構成に基づいて各スライドの本文（sub、body、note）を充実させてください。\n\n確定構成:\n${outlineDesc}`
      }
    ];

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: fullMessages, mode: "full" })
      });
      const data = await res.json();

      if (data.error) {
        setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + data.error }]);
      } else if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setPhase("full");
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `スライドの本文を生成しました（${data.slides.length}枚）。右側のプレビューで確認してください。\n修正があればお伝えください。PPTXダウンロードも可能です。`
        }]);
      } else if (data.rawText) {
        setChatMessages(prev => [...prev, { role: "assistant", content: data.rawText }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "生成エラー: " + err.message }]);
    }
    setGenerating(false);
  };

  const regenerate = async () => {
    if (generating || chatMessages.length === 0) return;
    const regenMessages = [...chatMessages, { role: "user", content: "スライド構成を再生成してください。別のアプローチや表現で作り直してください。" }];
    setChatMessages(regenMessages);
    setGenerating(true);
    setPhase("idle");

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: regenMessages, mode: "outline" })
      });
      const data = await res.json();

      if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setPhase("outline");
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `構成案を再生成しました（${data.slides.length}枚）。確認して「スライド生成」を押してください。`
        }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "再生成エラー: " + err.message }]);
    }
    setGenerating(false);
  };

  const downloadPptx = async () => {
    if (downloading || slides.length < 2 || phase !== "full") return;
    setDownloading(true);

    try {
      // Dynamically load PptxGenJS from CDN
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
          // Content slides: heading + body
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
          {/* Phase indicator */}
          <span style={{
            fontSize: "11px", padding: "4px 10px", borderRadius: "12px",
            background: phase === "idle" ? V.main : phase === "outline" ? `${V.orange}20` : `${V.green}20`,
            color: phase === "idle" ? V.t4 : phase === "outline" ? V.orange : V.green,
            fontWeight: 600
          }}>
            {phase === "idle" ? "入力待ち" : phase === "outline" ? "構成確認中" : "生成完了"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={downloadPptx}
            disabled={downloading || phase !== "full"}
            style={{
              padding: "8px 16px", borderRadius: 6,
              border: `1px solid ${V.border}`,
              background: downloading ? V.main : V.white,
              cursor: (downloading || phase !== "full") ? "not-allowed" : "pointer",
              fontSize: 13, color: V.t2, fontWeight: 500,
              opacity: phase !== "full" ? 0.5 : 1,
              transition: "all 0.2s"
            }}
            onMouseEnter={e => { if (!downloading && phase === "full") e.currentTarget.style.backgroundColor = V.main; }}
            onMouseLeave={e => { if (!downloading && phase === "full") e.currentTarget.style.backgroundColor = V.white; }}
          >
            {downloading ? "⏳ 生成中..." : "📥 PPTXダウンロード"}
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
            onMouseEnter={e => { if (!generating) e.currentTarget.style.backgroundColor = V.main; }}
            onMouseLeave={e => { if (!generating) e.currentTarget.style.backgroundColor = V.white; }}
          >
            🔄 再生成
          </button>
        </div>
      </div>

      {/* Main Content - 3 Panels */}
      <div className="panel-3" style={{
        display: "flex", flex: 1, overflow: "hidden", gap: 0
      }}>
        {/* Left Panel: Chat (30%) */}
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

          {/* Chat Messages */}
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
                例: 「新製品発表のプレゼンを作って」<br/><br/>
                <span style={{ color: V.accent, fontWeight: 600 }}>
                  まず構成案を生成 → 確認後に本文生成
                </span>
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
                🤖 {phase === "outline" || phase === "idle" ? "構成案を生成中..." : "スライド本文を生成中..."}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
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

        {/* Center Panel: Composition (35%) */}
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
            <span>📑 構成</span>
            <span style={{ fontSize: "11px", color: V.t4 }}>
              {slides.length}枚
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            {slides.map((s, i) => (
              <div
                key={s.id}
                onClick={() => setCurSlide(i)}
                style={{
                  padding: "12px", borderRadius: "6px",
                  background: curSlide === i ? V.accent : V.main,
                  color: curSlide === i ? V.white : V.t2,
                  cursor: "pointer", marginBottom: "8px",
                  fontSize: "12px",
                  fontWeight: curSlide === i ? 600 : 500,
                  border: `1px solid ${curSlide === i ? V.accent : V.border}`,
                  transition: "all 0.2s"
                }}
                onMouseEnter={e => {
                  if (curSlide !== i) e.currentTarget.style.backgroundColor = `${V.accent}10`;
                }}
                onMouseLeave={e => {
                  if (curSlide !== i) e.currentTarget.style.backgroundColor = V.main;
                }}
              >
                <div style={{ fontWeight: 700 }}>{s.id}. {s.heading || s.title}</div>
                <div style={{
                  fontSize: "11px",
                  color: curSlide === i ? "rgba(255,255,255,0.7)" : V.t4,
                  marginTop: "4px"
                }}>
                  {s.layoutLabel || s.layout}
                </div>
                {phase === "outline" && (
                  <div style={{
                    fontSize: "10px",
                    color: curSlide === i ? "rgba(255,255,255,0.5)" : V.orange,
                    marginTop: "2px", fontStyle: "italic"
                  }}>
                    構成のみ（本文未生成）
                  </div>
                )}
                {/* 本文生成後: sub / body テキストを表示 */}
                {phase === "full" && s.sub && (
                  <div style={{
                    fontSize: "11px",
                    color: curSlide === i ? "rgba(255,255,255,0.8)" : V.t3,
                    marginTop: "6px", fontWeight: 500
                  }}>
                    {s.sub}
                  </div>
                )}
                {phase === "full" && s.body && (
                  <div style={{
                    fontSize: "11px", lineHeight: 1.5,
                    color: curSlide === i ? "rgba(255,255,255,0.7)" : V.t2,
                    marginTop: "4px", whiteSpace: "pre-wrap",
                    borderTop: `1px solid ${curSlide === i ? "rgba(255,255,255,0.2)" : V.border}`,
                    paddingTop: "6px"
                  }}>
                    {s.body}
                  </div>
                )}
                {phase === "full" && s.note && (
                  <div style={{
                    fontSize: "10px",
                    color: curSlide === i ? "rgba(255,255,255,0.5)" : V.t4,
                    marginTop: "4px", fontStyle: "italic"
                  }}>
                    💡 {s.note}
                  </div>
                )}
                {s.dataSrc && s.dataSrc.length > 0 && (
                  <div style={{
                    fontSize: "10px",
                    color: curSlide === i ? "rgba(255,255,255,0.5)" : V.t4,
                    marginTop: "2px"
                  }}>
                    📊 {s.dataSrc.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Generate Full Content Button */}
          {phase === "outline" && (
            <div style={{
              padding: "16px", borderTop: `1px solid ${V.border}`,
              background: `${V.green}08`
            }}>
              <button
                onClick={generateFull}
                disabled={generating}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: "8px",
                  border: "none",
                  background: generating ? V.t4 : V.green,
                  color: V.white, cursor: generating ? "wait" : "pointer",
                  fontSize: "14px", fontWeight: 700, transition: "all 0.2s",
                  boxShadow: generating ? "none" : "0 2px 8px rgba(46,125,50,0.3)"
                }}
              >
                {generating ? "⏳ 本文を生成中..." : "✅ この構成でスライド生成"}
              </button>
              <div style={{
                fontSize: "11px", color: V.t3, textAlign: "center", marginTop: "8px"
              }}>
                構成を修正したい場合はチャットで指示してください
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Preview (35%) */}
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
            <span style={{ fontSize: "11px", color: V.t4 }}>
              {curSlide + 1} / {slides.length}
            </span>
          </div>

          {/* Model Selector */}
          <div style={{
            display: "flex", gap: "4px",
            padding: "8px 12px",
            borderBottom: `1px solid ${V.border}`,
            background: V.white, overflowX: "auto"
          }}>
            {Object.entries(MODEL_COLORS).map(([key, color]) => (
              <button
                key={key}
                onClick={() => setCurModel(key)}
                style={{
                  padding: "6px 10px", borderRadius: "4px",
                  border: curModel === key ? `2px solid ${color}` : `1px solid ${V.border}`,
                  background: curModel === key ? `${color}15` : V.white,
                  color: curModel === key ? color : V.t2,
                  fontSize: "11px", cursor: "pointer",
                  fontWeight: curModel === key ? 600 : 500,
                  transition: "all 0.2s", whiteSpace: "nowrap"
                }}
              >
                {MODEL_NAMES[key]}
              </button>
            ))}
          </div>

          <div style={{
            flex: 1, overflow: "auto", padding: "20px",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            {/* Slide Preview Box */}
            <div
              style={{
                width: "100%", maxWidth: "480px",
                aspectRatio: "16 / 9",
                borderRadius: "8px",
                background: slide.bg || "#FFFFFF",
                border: `1px solid ${V.border}`,
                display: "flex", flexDirection: "column",
                alignItems: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                justifyContent: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                padding: "24px",
                color: slide.light ? V.white : V.t1,
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
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
                    <div style={{
                      fontSize: "13px", textAlign: "center", opacity: 0.9
                    }}>
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
                  <div style={{
                    fontSize: "20px", fontWeight: 800, marginBottom: "10px"
                  }}>
                    {slide.heading || slide.title}
                  </div>
                  {slide.sub && (
                    <div style={{
                      fontSize: "11px",
                      color: slide.light ? "rgba(255,255,255,0.8)" : V.t3,
                      marginBottom: "12px", fontWeight: 500
                    }}>
                      {slide.sub}
                    </div>
                  )}
                  {phase === "outline" && !slide.body ? (
                    <div style={{
                      fontSize: "12px", color: slide.light ? "rgba(255,255,255,0.5)" : V.t4,
                      fontStyle: "italic", flex: 1, display: "flex",
                      alignItems: "center", justifyContent: "center", width: "100%"
                    }}>
                      構成確認後に本文が生成されます
                    </div>
                  ) : (
                    <div style={{
                      fontSize: "11px", lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      opacity: slide.light ? 0.9 : 1,
                      overflow: "auto", flex: 1, width: "100%"
                    }}>
                      {slide.body}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{
            padding: "12px 16px",
            borderTop: `1px solid ${V.border}`,
            background: V.white,
            fontSize: "11px", color: V.t4
          }}>
            <div>
              <strong>レイアウト:</strong> {slide.layoutLabel || slide.layout}
            </div>
            {slide.dataSrc && slide.dataSrc.length > 0 && (
              <div style={{ marginTop: "4px" }}>
                データ: {slide.dataSrc.join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
