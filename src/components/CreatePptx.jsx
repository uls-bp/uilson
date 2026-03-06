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
  const [templateFile, setTemplateFile] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [templateInfo, setTemplateInfo] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  /* ── Template Upload Handlers ── */
  const handleTemplateUpload = async (file) => {
    if (!file || !file.name.match(/\.pptx$/i)) {
      alert("PPTXファイルを選択してください");
      return;
    }
    setTemplateFile(file);
    setTemplateName(file.name);

    // Client-side JSZip parsing for faithful preview
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
      const buf = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);

      // Count slides
      const slideFiles = Object.keys(zip.files)
        .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort();

      // Extract theme fonts & colors
      let fonts = { heading: null, body: null };
      let colors = {};
      try {
        const themeFile = zip.file("ppt/theme/theme1.xml");
        if (themeFile) {
          const themeXml = await themeFile.async("string");
          const majorEa = themeXml.match(/<a:majorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
          const minorEa = themeXml.match(/<a:minorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
          const majorLat = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
          const minorLat = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
          fonts.heading = majorEa?.[1] || majorLat?.[1] || null;
          fonts.body = minorEa?.[1] || minorLat?.[1] || null;

          const extractColor = (tag) => {
            const srgb = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<a:srgbClr val="([^"]+)"`, "i"));
            if (srgb) return srgb[1];
            const sys = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<a:sysClr[^>]*lastClr="([^"]+)"`, "i"));
            if (sys) return sys[1];
            return null;
          };
          ["dk1","dk2","lt1","lt2","accent1","accent2","accent3","accent4","accent5","accent6","hlink"]
            .forEach(tag => { colors[tag] = extractColor(tag); });
        }
      } catch (e) { /* theme parsing optional */ }

      // Helper: resolve image from relationship
      const resolveImage = async (xmlContent, relsContent, basePath) => {
        const bgImg = xmlContent.match(/<p:bg>[\s\S]*?<a:blipFill>[\s\S]*?r:embed="([^"]+)"/);
        if (!bgImg || !relsContent) return null;
        const relId = bgImg[1];
        const target = relsContent.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`));
        if (!target) return null;
        let imgPath = target[1];
        if (imgPath.startsWith("../")) imgPath = "ppt/" + imgPath.replace("../", "");
        else if (!imgPath.startsWith("ppt/")) imgPath = basePath + imgPath;
        const imgFile = zip.file(imgPath);
        if (!imgFile) return null;
        const imgBuf = await imgFile.async("base64");
        const ext = imgPath.split(".").pop().toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
        return `data:${mime};base64,${imgBuf}`;
      };

      // Extract background images from slide masters, layouts, and actual slides
      let backgrounds = { cover: null, content: null, coverColor: null, contentColor: null };
      try {
        // Slide master background
        const masterXml = zip.file("ppt/slideMasters/slideMaster1.xml");
        const masterRels = zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels");
        if (masterXml) {
          const mc = await masterXml.async("string");
          const mr = masterRels ? await masterRels.async("string") : null;
          const img = await resolveImage(mc, mr, "ppt/slideMasters/");
          if (img) backgrounds.content = img;
          if (!img) {
            const solid = mc.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            if (solid) backgrounds.contentColor = solid[1];
          }
        }

        // First slide layout (cover)
        const layout1 = zip.file("ppt/slideLayouts/slideLayout1.xml");
        const layout1Rels = zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels");
        if (layout1) {
          const lc = await layout1.async("string");
          const lr = layout1Rels ? await layout1Rels.async("string") : null;
          const img = await resolveImage(lc, lr, "ppt/slideLayouts/");
          if (img) backgrounds.cover = img;
          if (!img) {
            const solid = lc.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            if (solid) backgrounds.coverColor = solid[1];
          }
        }

        // Actual slides (first = cover, second = content)
        for (let i = 0; i < Math.min(slideFiles.length, 2); i++) {
          const sf = zip.file(slideFiles[i]);
          const srPath = slideFiles[i].replace("slides/", "slides/_rels/").replace(".xml", ".xml.rels");
          const sr = zip.file(srPath);
          if (!sf) continue;
          const sc = await sf.async("string");
          const srels = sr ? await sr.async("string") : null;
          const img = await resolveImage(sc, srels, "ppt/slides/");
          if (img) {
            if (i === 0 && !backgrounds.cover) backgrounds.cover = img;
            else if (i === 1 && !backgrounds.content) backgrounds.content = img;
          }
          if (!img) {
            const solid = sc.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            if (solid) {
              if (i === 0 && !backgrounds.cover && !backgrounds.coverColor) backgrounds.coverColor = solid[1];
              else if (i === 1 && !backgrounds.content && !backgrounds.contentColor) backgrounds.contentColor = solid[1];
            }
          }
        }
      } catch (e) {
        console.log("bg extraction:", e.message);
      }

      setTemplateInfo({
        slideCount: slideFiles.length,
        fonts,
        colors,
        backgrounds,
      });
    } catch (e) {
      console.log("Template parse optional:", e.message);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleTemplateUpload(file);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const removeTemplate = () => {
    setTemplateFile(null);
    setTemplateName("");
    setTemplateInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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

  /* ── Load CDN Script Helper ── */
  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });

  /* ── Download: Template-based or PptxGenJS ── */
  const downloadPptx = async () => {
    if (downloading || !generated || slides.length < 2) return;
    setDownloading(true);

    try {
      if (templateFile) {
        // ── Template-based generation using JSZip + template manipulation ──
        await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgenjs.bundle.js");

        // Read template as ArrayBuffer
        const templateBuf = await templateFile.arrayBuffer();
        const zip = await window.JSZip.loadAsync(templateBuf);

        // Count existing slides in template
        const slideFiles = Object.keys(zip.files).filter(
          f => f.match(/^ppt\/slides\/slide\d+\.xml$/)
        ).sort();
        const templateSlideCount = slideFiles.length;

        // Strategy: Use PptxGenJS but apply template's theme colors & fonts
        // by extracting theme info from the template
        let themeColors = null;
        let themeFonts = { heading: "Yu Gothic", body: "Yu Gothic" };
        try {
          const themeFile = zip.file("ppt/theme/theme1.xml");
          if (themeFile) {
            const themeXml = await themeFile.async("string");
            // Extract major/minor font
            const majorMatch = themeXml.match(/<a:majorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
            const minorMatch = themeXml.match(/<a:minorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
            if (majorMatch) themeFonts.heading = majorMatch[1];
            if (minorMatch) themeFonts.body = minorMatch[1];

            // Extract scheme colors
            const dk1 = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            const dk2 = themeXml.match(/<a:dk2>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            const lt1 = themeXml.match(/<a:lt1>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            const accent1 = themeXml.match(/<a:accent1>[\s\S]*?<a:srgbClr val="([^"]+)"/);
            themeColors = {
              dk1: dk1?.[1] || "1E2D50",
              dk2: dk2?.[1] || "2B4070",
              lt1: lt1?.[1] || "FFFFFF",
              accent1: accent1?.[1] || "3C5996"
            };
          }
        } catch (e) { /* theme extraction optional */ }

        // Generate new PPTX using theme from template
        const pptx = new window.PptxGenJS();
        pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
        pptx.layout = "WIDE";

        const headingFont = themeFonts.heading;
        const bodyFont = themeFonts.body;
        const coverBg = themeColors ? themeColors.dk1 : "1E2D50";
        const closingBg = themeColors ? themeColors.dk2 : "2B4070";
        const accentColor = themeColors ? themeColors.accent1 : "3C5996";

        for (const s of slides) {
          const pptSlide = pptx.addSlide();
          const isCoverClose = s.layout === "cover" || s.layout === "closing";

          let bgColor;
          if (isCoverClose) {
            bgColor = s.layout === "cover" ? coverBg : closingBg;
          } else {
            bgColor = (s.bg || "#FFFFFF").replace("#", "");
          }
          pptSlide.background = { color: bgColor };

          const textColor = (isCoverClose || s.light) ? "FFFFFF" : "333333";
          const subColor = (isCoverClose || s.light) ? "CCCCCC" : "888888";

          if (isCoverClose) {
            pptSlide.addText(s.heading || s.title, {
              x: 0.5, y: 2.0, w: 12.33, h: 1.5,
              fontSize: 36, fontFace: headingFont,
              color: textColor, bold: true, align: "center"
            });
            if (s.sub) {
              pptSlide.addText(s.sub, {
                x: 0.5, y: 3.8, w: 12.33, h: 0.8,
                fontSize: 18, fontFace: bodyFont,
                color: subColor, align: "center"
              });
            }
            if (s.note) {
              pptSlide.addText(s.note, {
                x: 9, y: 6.5, w: 4, h: 0.5,
                fontSize: 10, fontFace: bodyFont,
                color: subColor, align: "right"
              });
            }
          } else {
            // Accent line under heading
            pptSlide.addShape(pptx.ShapeType.rect, {
              x: 0.5, y: 1.25, w: 1.5, h: 0.04, fill: { color: accentColor }
            });
            pptSlide.addText(s.heading || s.title, {
              x: 0.5, y: 0.3, w: 12.33, h: 1.0,
              fontSize: 28, fontFace: headingFont,
              color: textColor, bold: true
            });
            if (s.sub) {
              pptSlide.addText(s.sub, {
                x: 0.5, y: 1.4, w: 12.33, h: 0.6,
                fontSize: 14, fontFace: bodyFont,
                color: subColor
              });
            }
            if (s.body) {
              const bodyY = s.sub ? 2.2 : 1.6;
              pptSlide.addText(s.body, {
                x: 0.5, y: bodyY, w: 12.33, h: 4.5,
                fontSize: 16, fontFace: bodyFont,
                color: textColor, lineSpacingMultiple: 1.5,
                valign: "top"
              });
            }
          }
        }

        await pptx.writeFile({ fileName: "UILSON_presentation.pptx" });

      } else {
        // ── Default: No template, plain PptxGenJS ──
        await loadScript("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgenjs.bundle.js");

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
      }
    } catch (err) {
      alert("ダウンロードエラー: " + err.message);
    }
    setDownloading(false);
  };

  const slide = slides[curSlide] || slides[0];

  /* ── Template theme helpers for preview ── */
  const tColors = templateInfo?.colors || {};
  const tFonts = templateInfo?.fonts || {};
  const tBgs = templateInfo?.backgrounds || {};

  // Derive preview colors from template theme
  const tmCoverBg = tBgs.coverColor ? `#${tBgs.coverColor}` : tColors.dk1 ? `#${tColors.dk1}` : null;
  const tmContentBg = tBgs.contentColor ? `#${tBgs.contentColor}` : tColors.lt1 ? `#${tColors.lt1}` : null;
  const tmAccent = tColors.accent1 ? `#${tColors.accent1}` : null;
  const tmTextDark = tColors.dk1 ? `#${tColors.dk1}` : null;
  const tmTextLight = tColors.lt1 ? `#${tColors.lt1}` : "#FFFFFF";
  const tmSubDark = tColors.dk2 ? `#${tColors.dk2}` : null;
  const tmHeadingFont = tFonts.heading || null;
  const tmBodyFont = tFonts.body || null;

  // Get bg style for a slide depending on template
  const getPreviewBg = (s) => {
    const isCoverClose = s.layout === "cover" || s.layout === "closing";
    if (templateFile && isCoverClose) {
      if (tBgs.cover) return { backgroundImage: `url(${tBgs.cover})`, backgroundSize: "cover", backgroundPosition: "center" };
      if (tmCoverBg) return { background: tmCoverBg };
    }
    if (templateFile && !isCoverClose) {
      if (tBgs.content) return { backgroundImage: `url(${tBgs.content})`, backgroundSize: "cover", backgroundPosition: "center" };
      if (tmContentBg) return { background: tmContentBg };
    }
    return { background: s.bg || "#FFFFFF" };
  };

  // Get text color for preview
  const getPreviewTextColor = (s) => {
    const isCoverClose = s.layout === "cover" || s.layout === "closing";
    if (templateFile) {
      if (isCoverClose || s.light) return tmTextLight || "#FFFFFF";
      return tmTextDark || V.t1;
    }
    return s.light ? V.white : V.t1;
  };

  const getPreviewSubColor = (s) => {
    const isCoverClose = s.layout === "cover" || s.layout === "closing";
    if (templateFile) {
      if (isCoverClose || s.light) return "rgba(255,255,255,0.7)";
      return tmSubDark || V.t3;
    }
    return s.light ? "rgba(255,255,255,0.8)" : V.t3;
  };

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
            {downloading ? "⏳ 生成中..." : templateFile ? "📥 テンプレ適用DL" : "📥 ダウンロード"}
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

          {/* ── Template Upload Area ── */}
          <div style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${V.border}`,
            background: templateFile ? `${V.green}08` : V.main
          }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx"
              style={{ display: "none" }}
              onChange={e => { if (e.target.files?.[0]) handleTemplateUpload(e.target.files[0]); }}
            />
            {!templateFile ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? V.accent : V.border2}`,
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: dragOver ? `${V.accent}08` : "transparent",
                  transition: "all 0.2s"
                }}
              >
                <div style={{ fontSize: "20px", marginBottom: "4px", opacity: 0.5 }}>📎</div>
                <div style={{ fontSize: "11px", color: V.t3, lineHeight: 1.5 }}>
                  テンプレート (.pptx) をドラッグ&ドロップ<br/>
                  またはクリックして選択
                </div>
                <div style={{ fontSize: "10px", color: V.t4, marginTop: "4px" }}>
                  テンプレなしでもOK
                </div>
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                background: V.white, borderRadius: "8px", padding: "8px 12px",
                border: `1px solid ${V.green}40`
              }}>
                <span style={{ fontSize: "18px" }}>📊</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "11px", fontWeight: 600, color: V.t1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>
                    {templateName}
                  </div>
                  <div style={{ fontSize: "10px", color: V.green }}>
                    テンプレート適用中
                    {templateInfo?.slideCount && ` · ${templateInfo.slideCount}枚`}
                    {templateInfo?.fonts?.heading && ` · ${templateInfo.fonts.heading}`}
                  </div>
                </div>
                <button
                  onClick={removeTemplate}
                  style={{
                    border: "none", background: "none", cursor: "pointer",
                    fontSize: "14px", color: V.t4, padding: "2px 4px",
                    borderRadius: "4px"
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = V.red}
                  onMouseLeave={e => e.currentTarget.style.color = V.t4}
                  title="テンプレートを削除"
                >
                  ✕
                </button>
              </div>
            )}
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
                  background: curSlide === i ? `${templateFile && tmAccent ? tmAccent : V.accent}10` : V.main,
                  cursor: "pointer", marginBottom: "10px",
                  fontSize: "12px",
                  border: `1px solid ${curSlide === i ? (templateFile && tmAccent ? tmAccent : V.accent) : V.border}`,
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
                {/* Mini color preview strip for template */}
                {templateFile && tColors.accent1 && (
                  <div style={{
                    display: "flex", gap: "3px", marginTop: "8px",
                    paddingTop: "6px", borderTop: `1px solid ${V.border}`
                  }}>
                    {(s.layout === "cover" || s.layout === "closing") ? (
                      <div style={{
                        flex: 1, height: "4px", borderRadius: "2px",
                        background: tmCoverBg || `#${tColors.dk1 || "1E2D50"}`
                      }} />
                    ) : (
                      <>
                        <div style={{ flex: 2, height: "4px", borderRadius: "2px",
                          background: tmContentBg || "#FFFFFF", border: `1px solid ${V.border}` }} />
                        <div style={{ flex: 1, height: "4px", borderRadius: "2px",
                          background: tmAccent || V.accent }} />
                      </>
                    )}
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
            /* Slide preview - template-aware */
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
                    ...getPreviewBg(slide),
                    border: `1px solid ${V.border}`,
                    display: "flex", flexDirection: "column",
                    alignItems: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    justifyContent: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    padding: "28px",
                    color: getPreviewTextColor(slide),
                    overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                    position: "relative"
                  }}
                >
                  {(slide.layout === "cover" || slide.layout === "closing") ? (
                    <>
                      <div style={{
                        fontSize: "28px", fontWeight: 800,
                        textAlign: "center", lineHeight: 1.3, marginBottom: "16px",
                        fontFamily: tmHeadingFont || "inherit",
                        color: getPreviewTextColor(slide)
                      }}>
                        {slide.heading || slide.title}
                      </div>
                      {slide.sub && (
                        <div style={{
                          fontSize: "13px", textAlign: "center",
                          color: getPreviewSubColor(slide),
                          fontFamily: tmBodyFont || "inherit"
                        }}>
                          {slide.sub}
                        </div>
                      )}
                      {slide.note && (
                        <div style={{
                          position: "absolute", bottom: "16px", right: "20px",
                          fontSize: "10px", opacity: 0.7,
                          fontFamily: tmBodyFont || "inherit"
                        }}>
                          {slide.note}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Accent bar under heading (matches download output) */}
                      {templateFile && tmAccent && (
                        <div style={{
                          width: "60px", height: "3px",
                          background: tmAccent,
                          borderRadius: "2px",
                          marginBottom: "8px"
                        }} />
                      )}
                      <div style={{
                        fontSize: "22px", fontWeight: 800, marginBottom: "10px",
                        fontFamily: tmHeadingFont || "inherit",
                        color: getPreviewTextColor(slide)
                      }}>
                        {slide.heading || slide.title}
                      </div>
                      {slide.sub && (
                        <div style={{
                          fontSize: "12px",
                          color: getPreviewSubColor(slide),
                          marginBottom: "12px", fontWeight: 500,
                          fontFamily: tmBodyFont || "inherit"
                        }}>
                          {slide.sub}
                        </div>
                      )}
                      <div style={{
                        fontSize: "11px", lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        color: getPreviewTextColor(slide),
                        opacity: slide.light ? 0.9 : 1,
                        overflow: "auto", flex: 1, width: "100%",
                        fontFamily: tmBodyFont || "inherit"
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
                fontSize: "11px", color: V.t4,
                display: "flex", justifyContent: "space-between", alignItems: "center"
              }}>
                <span><strong>{slide.heading || slide.title}</strong> — {slide.layoutLabel || slide.layout}</span>
                {templateFile && (
                  <span style={{
                    fontSize: "10px", padding: "2px 8px",
                    background: `${V.green}15`, color: V.green,
                    borderRadius: "4px", fontWeight: 600
                  }}>
                    テンプレ適用
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
