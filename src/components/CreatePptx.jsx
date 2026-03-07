import { useState, useRef, useEffect } from "react";
import { DEFAULT_SLIDES, MODEL_COLORS, MODEL_NAMES, LAYOUT_ICONS, CREATE_CHAT, DEFAULT_SOURCES, AI_ORCHESTRATION_STATUS } from "../data/slides";

const V = {
  bg:"#F0F2F7", sb:"#FFFFFF", main:"#F5F6FA", card:"#FFFFFF", border:"#DDE1EB",
  border2:"#C8CDD8", t1:"#333333", t2:"#555555", t3:"#888888", t4:"#AAAAAA",
  white:"#FFFFFF", accent:"#3C5996", teal:"#2B4070", navy:"#1E2D50", blue:"#3C5996",
  red:"#C83732", green:"#2E7D32", orange:"#D4880F", lime:"#ABCD00"
};

export default function CreatePptx({ setView }) {
  const [slides, setSlides] = useState(DEFAULT_SLIDES);
  const [curSlide, setCurSlide] = useState(0);
  const [chatMessages, setChatMessages] = useState(
    CREATE_CHAT.map(m => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.text }))
  );
  const [chatInput, setChatInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generated, setGenerated] = useState(true);
  const [isComposing, setIsComposing] = useState(false);
  const [templateFile, setTemplateFile] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [templateInfo, setTemplateInfo] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  /* New state for mockup features */
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [showSourceAdd, setShowSourceAdd] = useState(false);
  const [curModel, setCurModel] = useState("chatgpt");
  const [aiStatus] = useState(AI_ORCHESTRATION_STATUS);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const templateBufferRef = useRef(null);

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
      templateBufferRef.current = buf; // preserve for download
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
            // First extract the element content within closing tag to avoid cross-element matching
            const elemMatch = themeXml.match(new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`, "i"));
            if (!elemMatch) return null;
            const elem = elemMatch[1];
            const srgb = elem.match(/<a:srgbClr val="([^"]+)"/);
            if (srgb) return srgb[1];
            const sys = elem.match(/<a:sysClr[^>]*lastClr="([^"]+)"/);
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

      // Helper: extract bg color from <p:bg> supporting srgbClr, schemeClr, sysClr
      const extractBgColor = (xmlStr) => {
        const bgSection = xmlStr.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
        if (!bgSection) return null;
        const bgContent = bgSection[1];
        // Check solidFill first
        const solidFill = bgContent.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
        if (solidFill) {
          const srgb = solidFill[1].match(/<a:srgbClr val="([^"]+)"/);
          if (srgb) return srgb[1];
          const scheme = solidFill[1].match(/<a:schemeClr val="([^"]+)"/);
          const schemeMap = { bg1:"lt1", bg2:"lt2", tx1:"dk1", tx2:"dk2" };
          if (scheme) {
            const key = schemeMap[scheme[1]] || scheme[1];
            if (colors[key]) return colors[key];
          }
          const sys = solidFill[1].match(/<a:sysClr[^>]*lastClr="([^"]+)"/);
          if (sys) return sys[1];
        }
        // Also check bgRef with schemeClr (e.g. <p:bgRef idx="1001"><a:schemeClr val="bg1"/>)
        const bgRef = bgContent.match(/<p:bgRef[^>]*>([\s\S]*?)<\/p:bgRef>/);
        if (bgRef) {
          const scheme = bgRef[1].match(/<a:schemeClr val="([^"]+)"/);
          const schemeMap = { bg1:"lt1", bg2:"lt2", tx1:"dk1", tx2:"dk2" };
          if (scheme) {
            const key = schemeMap[scheme[1]] || scheme[1];
            if (colors[key]) return colors[key];
          }
        }
        return null;
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
            const bgc = extractBgColor(mc);
            if (bgc) backgrounds.contentColor = bgc;
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
            const bgc = extractBgColor(lc);
            if (bgc) backgrounds.coverColor = bgc;
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
            const bgc = extractBgColor(sc);
            if (bgc) {
              if (i === 0 && !backgrounds.cover && !backgrounds.coverColor) backgrounds.coverColor = bgc;
              else if (i === 1 && !backgrounds.content && !backgrounds.contentColor) backgrounds.contentColor = bgc;
            }
          }
        }
      } catch (e) {
        console.log("bg extraction:", e.message);
      }

      // Extract visual elements (shapes, images, gradients) from slide masters, layouts & slides
      const EMU_W = 12192000, EMU_H = 6858000;

      // Resolve any color reference (srgbClr, schemeClr, sysClr) to hex
      const resolveColor = (xmlFragment) => {
        const srgb = xmlFragment.match(/<a:srgbClr val="([^"]+)"/);
        if (srgb) return srgb[1];
        const scheme = xmlFragment.match(/<a:schemeClr val="([^"]+)"/);
        if (scheme && colors[scheme[1]]) return colors[scheme[1]];
        // Map scheme names to theme color keys
        const schemeMap = { bg1:"lt1", bg2:"lt2", tx1:"dk1", tx2:"dk2" };
        if (scheme && schemeMap[scheme[1]] && colors[schemeMap[scheme[1]]]) return colors[schemeMap[scheme[1]]];
        const sys = xmlFragment.match(/<a:sysClr[^>]*lastClr="([^"]+)"/);
        if (sys) return sys[1];
        return null;
      };

      // Extract alpha from a fill section
      const extractAlpha = (xmlFragment) => {
        const a = xmlFragment.match(/<a:alpha val="(\d+)"/);
        return a ? parseInt(a[1]) / 100000 : 1;
      };

      const parseVisuals = async (xmlStr, relsStr, bPath) => {
        const elems = [];
        // Shapes with fills - only extract fill from <p:spPr> (shape properties),
        // NOT from text run properties (<a:rPr>) which contain text color, not shape fill
        const spRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
        let m;
        while ((m = spRx.exec(xmlStr)) !== null) {
          const sp = m[0];
          if (sp.includes("<p:ph")) continue; // skip text placeholders
          // Skip shapes that contain text body with actual text content (text boxes)
          const txBody = sp.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
          if (txBody) {
            const textContent = txBody[1].replace(/<[^>]+>/g, "").trim();
            if (textContent.length > 0) continue; // has visible text → skip (it's a text box, not a decoration)
          }
          const off = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
          const ex = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
          if (!off || !ex) continue;
          const x = parseInt(off[1])/EMU_W*100, y = parseInt(off[2])/EMU_H*100;
          const w = parseInt(ex[1])/EMU_W*100, h = parseInt(ex[2])/EMU_H*100;
          if (w < 0.3 && h < 0.3) continue;

          // Only look for fill inside <p:spPr> (shape properties), not entire shape
          const spPr = sp.match(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/);
          if (!spPr) continue;
          const spPrContent = spPr[1];

          // Solid fill (srgbClr, schemeClr, or sysClr) - from shape properties only
          const solidFill = spPrContent.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
          if (solidFill) {
            const color = resolveColor(solidFill[1]);
            if (color) {
              const opacity = extractAlpha(solidFill[1]);
              elems.push({ type:"rect", x, y, w, h, fill:`#${color}`, opacity });
              continue;
            }
          }

          // Gradient fill (supports both srgbClr and schemeClr) - from shape properties only
          const gradSection = spPrContent.match(/<a:gradFill>([\s\S]*?)<\/a:gradFill>/);
          if (gradSection) {
            const stops = [];
            const gsRx = /<a:gs pos="(\d+)">([\s\S]*?)<\/a:gs>/g;
            let gs;
            while ((gs = gsRx.exec(gradSection[1])) !== null) {
              const color = resolveColor(gs[2]);
              if (color) stops.push({ pos: parseInt(gs[1])/1000, color: `#${color}` });
            }
            if (stops.length >= 2) {
              const grad = `linear-gradient(180deg, ${stops.map(s=>`${s.color} ${s.pos}%`).join(", ")})`;
              elems.push({ type:"rect", x, y, w, h, fill: grad, opacity: 1 });
            }
          }
        }
        // Group shapes (spTree inside grpSp may contain shapes)
        const grpRx = /<p:grpSp\b[\s\S]*?<\/p:grpSp>/g;
        while ((m = grpRx.exec(xmlStr)) !== null) {
          const grp = m[0];
          // Recursively find shapes in groups
          const innerSpRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
          let innerM;
          while ((innerM = innerSpRx.exec(grp)) !== null) {
            const sp = innerM[0];
            if (sp.includes("<p:ph")) continue;
            // Skip text boxes in groups too
            const txB = sp.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
            if (txB) { const tc = txB[1].replace(/<[^>]+>/g, "").trim(); if (tc.length > 0) continue; }
            const off = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
            const ex = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
            if (!off || !ex) continue;
            const x = parseInt(off[1])/EMU_W*100, y = parseInt(off[2])/EMU_H*100;
            const w = parseInt(ex[1])/EMU_W*100, h = parseInt(ex[2])/EMU_H*100;
            if (w < 0.3 && h < 0.3) continue;
            // Only look in spPr for fill
            const grpSpPr = sp.match(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/);
            if (!grpSpPr) continue;
            const solidFill = grpSpPr[1].match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
            if (solidFill) {
              const color = resolveColor(solidFill[1]);
              if (color) {
                elems.push({ type:"rect", x, y, w, h, fill:`#${color}`, opacity: extractAlpha(solidFill[1]) });
              }
            }
          }
        }
        // Pictures
        const picRx = /<p:pic\b[\s\S]*?<\/p:pic>/g;
        while ((m = picRx.exec(xmlStr)) !== null) {
          const pic = m[0];
          const off = pic.match(/<a:off x="(\d+)" y="(\d+)"/);
          const ex = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
          const emb = pic.match(/r:embed="([^"]+)"/);
          if (!off || !ex || !emb || !relsStr) continue;
          const x = parseInt(off[1])/EMU_W*100, y = parseInt(off[2])/EMU_H*100;
          const w = parseInt(ex[1])/EMU_W*100, h = parseInt(ex[2])/EMU_H*100;
          const rId = emb[1];
          const tgt = relsStr.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`));
          if (!tgt) continue;
          let iP = tgt[1];
          if (iP.startsWith("../")) iP = "ppt/" + iP.replace(/^\.\.\//g, "");
          else if (!iP.startsWith("ppt/")) iP = bPath + iP;
          const iF = zip.file(iP);
          if (!iF) continue;
          const iD = await iF.async("base64");
          const iE = iP.split(".").pop().toLowerCase();
          const iM = iE==="png"?"image/png":iE==="svg"?"image/svg+xml":"image/jpeg";
          elems.push({ type:"img", x, y, w, h, src:`data:${iM};base64,${iD}` });
        }
        return elems;
      };

      let coverElements = [], contentElements = [];
      try {
        // Collect elements from master → layout → actual slides (layered)
        let masterElems = [];
        const mf = zip.file("ppt/slideMasters/slideMaster1.xml");
        const mfr = zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels");
        if (mf) {
          const mx = await mf.async("string");
          const mr2 = mfr ? await mfr.async("string") : null;
          masterElems = await parseVisuals(mx, mr2, "ppt/slideMasters/");
        }
        // Layout 1 = title/cover
        const l1f = zip.file("ppt/slideLayouts/slideLayout1.xml");
        const l1r = zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels");
        if (l1f) {
          const l1x = await l1f.async("string");
          const l1rels = l1r ? await l1r.async("string") : null;
          coverElements = [...masterElems, ...await parseVisuals(l1x, l1rels, "ppt/slideLayouts/")];
        } else coverElements = [...masterElems];
        // Layout 2 = content
        const l2f = zip.file("ppt/slideLayouts/slideLayout2.xml");
        const l2r = zip.file("ppt/slideLayouts/_rels/slideLayout2.xml.rels");
        if (l2f) {
          const l2x = await l2f.async("string");
          const l2rels = l2r ? await l2r.async("string") : null;
          contentElements = [...masterElems, ...await parseVisuals(l2x, l2rels, "ppt/slideLayouts/")];
        } else contentElements = [...masterElems];

        // Also extract elements from actual slides (many templates put decorations here)
        for (let i = 0; i < Math.min(slideFiles.length, 2); i++) {
          const sf = zip.file(slideFiles[i]);
          const srPath = slideFiles[i].replace("slides/", "slides/_rels/").replace(".xml", ".xml.rels");
          const sr = zip.file(srPath);
          if (!sf) continue;
          const sc = await sf.async("string");
          const srels = sr ? await sr.async("string") : null;
          const slideElems = await parseVisuals(sc, srels, "ppt/slides/");
          if (slideElems.length > 0) {
            if (i === 0) coverElements = [...coverElements, ...slideElems];
            else contentElements = [...contentElements, ...slideElems];
          }
        }
      } catch (e) {
        console.log("shape extraction:", e.message);
      }

      const info = {
        slideCount: slideFiles.length,
        fonts,
        colors,
        backgrounds,
        coverElements,
        contentElements,
      };
      console.log("Template parsed:", JSON.stringify({
        slideCount: info.slideCount,
        colorKeys: Object.keys(info.colors),
        coverBg: info.backgrounds.coverColor,
        contentBg: info.backgrounds.contentColor,
        coverElCount: info.coverElements.length,
        contentElCount: info.contentElements.length,
        coverEls: info.coverElements.map(e => ({type:e.type, fill:e.fill?.substring(0,20), x:e.x?.toFixed(1), y:e.y?.toFixed(1), w:e.w?.toFixed(1), h:e.h?.toFixed(1)})),
        contentEls: info.contentElements.map(e => ({type:e.type, fill:e.fill?.substring(0,20), x:e.x?.toFixed(1), y:e.y?.toFixed(1), w:e.w?.toFixed(1), h:e.h?.toFixed(1)})),
      }));
      setTemplateInfo(info);
    } catch (e) {
      console.error("Template parse error:", e.message, e.stack);
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
    templateBufferRef.current = null;
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
        body: JSON.stringify({ messages: newMessages, mode: "full", model: curModel })
      });
      const data = await res.json();

      if (data.error) {
        setChatMessages(prev => [...prev, { role: "assistant", content: "エラー: " + data.error }]);
      } else if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setGenerated(true);
        const summary = data.summary || `${data.slides.length}枚のスライドを生成しました。`;
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `${summary}\n\n構成パネルで各スライドの本文を確認してください。\n修正はチャットで指示できます。`
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
        body: JSON.stringify({ messages: regenMessages, mode: "full", model: curModel })
      });
      const data = await res.json();

      if (data.slides && data.slides.length > 0) {
        setSlides(data.slides);
        setCurSlide(0);
        setGenerated(true);
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

  /* ── Source Management ── */
  const addSource = (type) => {
    setShowSourceAdd(false);
    if (type === "upload") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pptx,.pdf,.docx,.xlsx,.txt";
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
          const newSrc = { id: Date.now(), name: file.name, type: "file", icon: "📄" };
          setSources(prev => [...prev, newSrc]);
          if (file.name.match(/\.pptx$/i)) handleTemplateUpload(file);
        }
      };
      input.click();
    } else {
      const labels = { drive: "Google Drive", sp: "SharePoint", skill: "スキルBOX" };
      alert(`${labels[type]} からの選択は今後実装予定です`);
    }
  };

  const removeSource = (id) => {
    setSources(prev => prev.filter(s => s.id !== id));
  };

  /* ── Slide Management ── */
  const moveSlide = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= slides.length) return;
    const newSlides = [...slides];
    const temp = newSlides[index];
    newSlides[index] = newSlides[newIndex];
    newSlides[newIndex] = temp;
    setSlides(newSlides);
    setCurSlide(newIndex);
  };

  const deleteSlide = (index) => {
    if (slides.length <= 1) return;
    const newSlides = slides.filter((_, i) => i !== index);
    setSlides(newSlides);
    if (curSlide >= newSlides.length) setCurSlide(newSlides.length - 1);
    else if (curSlide > index) setCurSlide(curSlide - 1);
  };

  const addSlide = () => {
    const newSlide = {
      id: Date.now(),
      title: "新しいスライド",
      layout: "body",
      layoutLabel: "コンテンツ",
      heading: "新しいスライド",
      sub: "",
      body: "内容を入力してください。",
      note: "",
      bg: "#FFFFFF",
      light: false,
      ai: [],
      dataSrc: []
    };
    setSlides(prev => [...prev, newSlide]);
    setCurSlide(slides.length);
  };

  /* ── Load CDN Script Helper ── */
  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      // If already loaded and global is available, resolve immediately
      if (existing.dataset.loaded === "1") return resolve();
      // If failed before, remove and retry
      if (existing.dataset.loaded === "0") existing.remove();
      else return resolve(); // still loading or done
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => { s.dataset.loaded = "0"; reject(new Error("Script load failed: " + src)); };
    document.head.appendChild(s);
  });

  /* ── Download: Template-based or PptxGenJS ── */
  const downloadPptx = async () => {
    if (downloading || !generated || slides.length < 1) return;
    setDownloading(true);

    try {
      if (templateFile) {
        // ── Template-based generation using PptxGenJS + template theme ──
        await loadScript("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js");

        // Use stored buffer (saved during upload) or re-read file
        let templateBuf = templateBufferRef.current;
        if (!templateBuf) {
          templateBuf = await templateFile.arrayBuffer();
          templateBufferRef.current = templateBuf;
        }
        // JSZip might come from PptxGenJS bundle or standalone
        const JSZipLib = window.JSZip;
        if (!JSZipLib) throw new Error("JSZip not available");
        const zip = await JSZipLib.loadAsync(templateBuf);

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
            pptSlide.addShape("rect", {
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
        await loadScript("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js");

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
      console.error("Download error:", err);
      alert("ダウンロードエラー: " + (err?.message || String(err)));
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

  const modelIcon = { claude: "\ud83d\udfe3", gemini: "\ud83d\udd35", chatgpt: "\ud83d\udfe2" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: V.main }}>
      {/* Top Bar */}
      <div style={{
        padding: "10px 24px",
        borderBottom: `1px solid ${V.border}`,
        background: V.white,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
      }}>
        <div
          onClick={() => setView("create-menu")}
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            cursor: "pointer", color: V.accent, fontSize: "13px", fontWeight: 600
          }}
        >
          {"\u2190 \u4f5c\u308b\u30e1\u30cb\u30e5\u30fc"}
        </div>
        <div style={{ width: "1px", height: "24px", background: V.border, margin: "0 10px" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: V.t1 }}>{"\ud83d\udcca \u30d7\u30ec\u30bc\u30f3\u8cc7\u6599\u3092\u4f5c\u308b"}</div>
          <div style={{ fontSize: "12px", color: V.t3 }}>{"\u793e\u5185\u30c7\u30fc\u30bf\u3068\u30ce\u30a6\u30cf\u30a6\u3092\u6d3b\u7528\u3057\u3066\u3001\u597d\u307f\u306eAI\u3067\u30d7\u30ec\u30bc\u30f3\u3092\u751f\u6210"}</div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {templateName && (
            <span style={{ fontSize: "12px", color: V.t3, display: "flex", alignItems: "center", gap: "4px" }}>
              {"\ud83d\udce6"} {"\u9069\u7528\u4e2d\uff1a"}<strong style={{ color: V.accent }}>{templateName.replace(/\.pptx$/i, "")}</strong>
            </span>
          )}
          <button
            onClick={downloadPptx}
            disabled={downloading || !generated}
            style={{
              padding: "6px 16px", borderRadius: 6,
              border: `1px solid ${generated ? V.accent : V.border}`,
              background: V.white,
              cursor: (!generated || downloading) ? "not-allowed" : "pointer",
              fontSize: 13, color: generated ? V.accent : V.t4, fontWeight: 600,
              opacity: !generated ? 0.5 : 1,
              transition: "all 0.2s"
            }}
          >
            {downloading ? "\u23f3 \u751f\u6210\u4e2d..." : "\ud83d\udce5 PPTX\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9"}
          </button>
          <button
            onClick={regenerate}
            disabled={generating || chatMessages.length === 0}
            style={{
              padding: "6px 16px", borderRadius: 6,
              border: "none",
              background: generating ? V.t4 : V.accent,
              color: V.white,
              cursor: generating ? "wait" : "pointer",
              fontSize: 13, fontWeight: 600,
              opacity: chatMessages.length === 0 ? 0.5 : 1,
              transition: "all 0.2s"
            }}
          >
            {"\ud83d\udd04 \u518d\u751f\u6210"}
          </button>
        </div>
      </div>

      {/* Main Content - 3 Panels */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: AI Dialogue (30%) */}
        <div style={{
          width: "30%", borderRight: `1px solid ${V.border}`,
          display: "flex", flexDirection: "column",
          background: V.sb, overflow: "hidden"
        }}>
          {/* Source Area */}
          <div style={{
            padding: "10px 14px", borderBottom: `1px solid ${V.border}`, background: V.main
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: V.t1 }}>{"\ud83d\udcce \u30bd\u30fc\u30b9"}</span>
              <span
                onClick={() => setShowSourceAdd(!showSourceAdd)}
                style={{ marginLeft: "auto", fontSize: "12px", color: V.accent, cursor: "pointer", fontWeight: 600 }}
              >
                {"\uff0b \u8ffd\u52a0"}
              </span>
            </div>
            {showSourceAdd && (
              <div style={{
                background: V.white, border: `1px solid ${V.border}`, borderRadius: "8px",
                padding: "8px", marginBottom: "8px"
              }}>
                {[
                  { key: "upload", icon: "\u2b06\ufe0f", label: "\u30d5\u30a1\u30a4\u30eb\u3092\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9" },
                  { key: "drive", icon: "\ud83d\udcc2", label: "Google Drive \u304b\u3089\u9078\u3076" },
                  { key: "sp", icon: "\ud83d\udcc2", label: "SharePoint \u304b\u3089\u9078\u3076" },
                  { key: "skill", icon: "\ud83d\udce6", label: "\u30b9\u30ad\u30ebBOX\u304b\u3089\u9078\u3076" }
                ].map(item => (
                  <div
                    key={item.key}
                    onClick={() => addSource(item.key)}
                    style={{
                      padding: "6px 8px", fontSize: "12px", color: V.t2,
                      cursor: "pointer", borderRadius: "5px",
                      display: "flex", alignItems: "center", gap: "6px"
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(60,89,150,0.05)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    {item.icon} {item.label}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {sources.map(src => (
                <div key={src.id} style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px",
                  background: V.white, borderRadius: "6px", border: `1px solid ${V.border}`,
                  fontSize: "12px", color: V.t2
                }}>
                  <span>{src.icon}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.name}</span>
                  <span
                    onClick={() => removeSource(src.id)}
                    style={{ cursor: "pointer", color: V.t4, fontSize: "11px" }}
                    onMouseEnter={e => e.currentTarget.style.color = V.red}
                    onMouseLeave={e => e.currentTarget.style.color = V.t4}
                  >{"\u2715"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chat Header with Model Selector */}
          <div style={{
            padding: "8px 14px", borderBottom: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", gap: "8px"
          }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: V.accent }}>{"\ud83d\udcac \u5bfe\u8a71"}</span>
            <div style={{ marginLeft: "auto" }}>
              <select
                value={curModel}
                onChange={e => setCurModel(e.target.value)}
                style={{
                  background: V.main, border: `1px solid ${V.border}`, color: V.t2,
                  padding: "4px 8px", borderRadius: "6px", fontSize: "12px",
                  fontFamily: "inherit", cursor: "pointer", outline: "none"
                }}
              >
                <option value="claude">{"\ud83d\udfe3 Claude"}</option>
                <option value="gemini">{"\ud83d\udd35 Gemini"}</option>
                <option value="chatgpt">{"\ud83d\udfe2 ChatGPT"}</option>
              </select>
            </div>
          </div>

          {/* Chat Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "12px",
            display: "flex", flexDirection: "column", gap: "10px"
          }}>
            {chatMessages.length === 0 && (
              <div style={{
                padding: "20px", textAlign: "center", color: V.t4, fontSize: "12px",
                lineHeight: 1.6
              }}>
                {"\u30d7\u30ec\u30bc\u30f3\u8cc7\u6599\u306e\u5185\u5bb9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002"}<br/>
                {"\u4f8b: \u300c\u55b6\u696d\u30c1\u30fc\u30e0\u5411\u3051\u306e\u6708\u6b21\u5831\u544a\u30928\u679a\u3067\u4f5c\u3063\u3066\u300d"}
              </div>
            )}
            {chatMessages.map((msg, i) => (
              msg.role === "user" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "85%",
                    background: `linear-gradient(135deg,${V.accent},${V.teal})`,
                    borderRadius: "12px 12px 4px 12px",
                    padding: "9px 12px", fontSize: "13px", lineHeight: 1.6, color: "#FFF",
                    whiteSpace: "pre-wrap", wordBreak: "break-word"
                  }}>
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ display: "flex", gap: "7px" }}>
                  <div style={{
                    width: "24px", height: "24px", borderRadius: "6px",
                    background: MODEL_COLORS[curModel] || V.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", fontWeight: 800, color: "#FFF", flexShrink: 0
                  }}>
                    {(MODEL_NAMES[curModel] || "AI")[0]}
                  </div>
                  <div style={{
                    background: V.main, borderRadius: "4px 12px 12px 12px",
                    padding: "9px 12px", border: `1px solid ${V.border}`,
                    fontSize: "13px", lineHeight: 1.6, color: V.t1, maxWidth: "88%",
                    whiteSpace: "pre-wrap", wordBreak: "break-word"
                  }}>
                    <div style={{
                      fontSize: "10px", color: MODEL_COLORS[curModel] || V.accent,
                      fontWeight: 600, marginBottom: "3px"
                    }}>
                      {modelIcon[curModel] || "\ud83d\udfe3"} {MODEL_NAMES[curModel] || "AI"}
                    </div>
                    {msg.content}
                  </div>
                </div>
              )
            ))}
            {/* AI Orchestration Status */}
            {generated && aiStatus.length > 0 && (
              <div style={{
                background: "rgba(60,89,150,0.04)", border: "1px solid rgba(60,89,150,0.12)",
                borderRadius: "8px", padding: "10px", marginTop: "4px"
              }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: V.accent, marginBottom: "6px" }}>
                  {"\ud83d\udd00 AI\u30aa\u30fc\u30b1\u30b9\u30c8\u30ec\u30fc\u30b7\u30e7\u30f3\u72b6\u6cc1"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {aiStatus.map((st, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                      <span style={{ color: MODEL_COLORS[st.model] }}>{st.icon}</span>
                      <span style={{ color: V.t2 }}>{MODEL_NAMES[st.model]}</span>
                      <span style={{ color: V.t4 }}>{"\u2192"} {st.task}</span>
                      <span style={{ color: V.green, marginLeft: "auto" }}>
                        {st.status === "done" ? "\u2713 \u5b8c\u4e86" : "\u23f3 \u51e6\u7406\u4e2d"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {generating && (
              <div style={{
                padding: "10px", borderRadius: "8px",
                background: V.main, color: V.t3,
                fontSize: "12px", fontStyle: "italic"
              }}>
                {"\ud83e\udd16 \u30b9\u30e9\u30a4\u30c9\u3092\u751f\u6210\u4e2d..."}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${V.border}` }}>
            <div style={{
              display: "flex", gap: "6px", alignItems: "center",
              background: V.main, borderRadius: "8px", padding: "4px 4px 4px 12px",
              border: `1px solid ${V.border}`
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
                placeholder={"\u6307\u793a\u3084\u4fee\u6b63\u3092\u5165\u529b..."}
                disabled={generating}
                style={{
                  flex: 1, border: "none", outline: "none", background: "transparent",
                  color: V.t2, fontSize: "13px", fontFamily: "inherit"
                }}
              />
              <button
                onClick={sendChat}
                disabled={generating || !chatInput.trim()}
                style={{
                  padding: "5px 12px", borderRadius: "6px",
                  border: "none", background: generating ? V.t4 : V.accent,
                  color: V.white, cursor: generating ? "wait" : "pointer",
                  fontSize: "12px", fontWeight: 600, transition: "all 0.2s"
                }}
              >
                {"\u9001\u4fe1"}
              </button>
            </div>
          </div>

          {/* Hidden template file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) handleTemplateUpload(e.target.files[0]); }}
          />
        </div>

        {/* Center: Slide Content (32%) */}
        <div style={{
          width: "32%", borderRight: `1px solid ${V.border}`,
          display: "flex", flexDirection: "column",
          background: V.main, overflow: "hidden"
        }}>
          <div style={{
            padding: "8px 14px", borderBottom: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", gap: "6px", background: V.sb
          }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: V.accent }}>{"\ud83d\udcdd \u69cb\u6210"}</span>
            <span style={{ fontSize: "12px", color: V.t3, fontWeight: 400, marginLeft: "auto" }}>
              {slides.length} slides
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
            {slides.map((s, i) => {
              const isActive = i === curSlide;
              const layoutIcon = LAYOUT_ICONS[s.layoutLabel] || "\u25a6";
              return (
                <div
                  key={s.id}
                  onClick={() => setCurSlide(i)}
                  style={{
                    background: V.white, borderRadius: "8px",
                    border: `2px solid ${isActive ? V.accent : V.border}`,
                    padding: "12px", marginBottom: "8px", cursor: "pointer",
                    transition: "all 0.12s",
                    boxShadow: isActive ? "0 2px 8px rgba(60,89,150,0.12)" : "none"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{
                      fontSize: "11px", fontWeight: 700, color: V.white,
                      background: isActive ? V.accent : V.t4,
                      padding: "2px 7px", borderRadius: "4px"
                    }}>{i + 1}</span>
                    <span style={{
                      fontSize: "14px", fontWeight: 600,
                      color: isActive ? V.accent : V.t1
                    }}>{s.title}</span>
                    <span style={{
                      fontSize: "11px", padding: "2px 8px", borderRadius: "4px",
                      background: isActive ? "rgba(60,89,150,0.06)" : V.main,
                      color: isActive ? V.accent : V.t3, fontWeight: 500, whiteSpace: "nowrap"
                    }}>{layoutIcon} {s.layoutLabel}</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }}
                        style={{ cursor: "pointer", fontSize: "12px", color: V.t4, padding: "2px 4px" }}
                        title={"\u4e0a\u306b\u79fb\u52d5"}
                      >{"\u2191"}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }}
                        style={{ cursor: "pointer", fontSize: "12px", color: V.t4, padding: "2px 4px" }}
                        title={"\u4e0b\u306b\u79fb\u52d5"}
                      >{"\u2193"}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); deleteSlide(i); }}
                        style={{ cursor: "pointer", fontSize: "12px", color: V.t4, padding: "2px 4px" }}
                        title={"\u524a\u9664"}
                      >{"\u2715"}</span>
                    </div>
                  </div>
                  <div style={{
                    fontSize: "13px", fontWeight: 600, color: V.t1, marginBottom: "3px"
                  }}>{(s.heading || "").replace(/\n/g, " ")}</div>
                  {s.sub && (
                    <div style={{ fontSize: "12px", color: V.accent, marginBottom: "3px" }}>{s.sub}</div>
                  )}
                  {s.body && (
                    <div style={{
                      fontSize: "12px", color: V.t3, lineHeight: 1.5,
                      maxHeight: isActive ? "none" : "52px", overflow: "hidden",
                      whiteSpace: "pre-wrap"
                    }}>{s.body}</div>
                  )}
                  {s.note && (
                    <div style={{ fontSize: "11px", color: V.t4, marginTop: "4px", fontStyle: "italic" }}>{s.note}</div>
                  )}
                  <div style={{
                    display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px",
                    paddingTop: "6px", borderTop: `1px solid ${V.border}`
                  }}>
                    {(s.ai || []).map((a, ai) => (
                      <span key={ai} style={{
                        display: "inline-flex", alignItems: "center", gap: "3px",
                        fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                        background: `${MODEL_COLORS[a.model] || "#999"}10`,
                        color: MODEL_COLORS[a.model] || "#999",
                        border: `1px solid ${MODEL_COLORS[a.model] || "#999"}25`,
                        whiteSpace: "nowrap"
                      }}>
                        {a.icon} {a.part}
                      </span>
                    ))}
                    {(s.dataSrc || []).map((d, di) => (
                      <span key={`ds${di}`} style={{
                        display: "inline-flex", alignItems: "center", gap: "2px",
                        fontSize: "10px", padding: "1px 5px", borderRadius: "3px",
                        background: "rgba(46,125,50,0.06)", color: V.green, whiteSpace: "nowrap"
                      }}>
                        {"\ud83d\udcca"} {d}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            <div
              onClick={addSlide}
              style={{
                padding: "10px", border: `2px dashed ${V.border}`, borderRadius: "8px",
                textAlign: "center", color: V.t3, fontSize: "13px",
                cursor: "pointer", marginTop: "4px"
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = V.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = V.border}
            >
              {"\uff0b \u30b9\u30e9\u30a4\u30c9\u3092\u8ffd\u52a0"}
            </div>
          </div>
        </div>

        {/* Right: PPT Preview (38%) - always visible */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", background: "#E8EAF0"
        }}>
          <div style={{
            padding: "8px 14px", borderBottom: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", gap: "6px", background: V.sb
          }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: V.accent }}>{"\ud83d\udda5\ufe0f \u30d7\u30ec\u30d3\u30e5\u30fc"}</span>
            <span style={{ fontSize: "12px", color: V.t3, fontWeight: 400, marginLeft: "auto" }}>
              {curSlide + 1} / {slides.length}
            </span>
          </div>

          <div style={{
            flex: 1, display: "flex", flexDirection: "column", padding: "14px", overflow: "hidden"
          }}>
            {/* Main slide preview */}
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", marginBottom: "12px"
            }}>
              <div
                ref={el => {
                  if (!el) return;
                  const ro = new ResizeObserver(() => {
                    const W = el.clientWidth, H = el.clientHeight;
                    const inner = el.firstChild;
                    if (!inner) return;
                    const scale = Math.min(W / 960, H / 540);
                    inner.style.transform = `scale(${scale})`;
                  });
                  ro.observe(el);
                }}
                style={{
                  width: "100%", height: "100%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden"
                }}
              >
                <div style={{
                  width: "960px", height: "540px", flexShrink: 0,
                  borderRadius: "6px",
                  ...getPreviewBg(slide),
                  border: `1px solid ${V.border}`,
                  overflow: "hidden",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                  position: "relative",
                  transformOrigin: "center center"
                }}>
                  {templateFile && templateInfo && (() => {
                    const isCov = slide.layout === "cover" || slide.layout === "closing";
                    const elms = isCov ? (templateInfo.coverElements || []) : (templateInfo.contentElements || []);
                    return elms.map((el, idx) => {
                      if (el.type === "rect") return (
                        <div key={`te${idx}`} style={{
                          position:"absolute", left:`${el.x}%`, top:`${el.y}%`,
                          width:`${el.w}%`, height:`${el.h}%`,
                          background: el.fill, opacity: el.opacity ?? 1,
                          pointerEvents:"none", zIndex: 1
                        }} />
                      );
                      if (el.type === "img") return (
                        <img key={`te${idx}`} src={el.src} alt="" style={{
                          position:"absolute", left:`${el.x}%`, top:`${el.y}%`,
                          width:`${el.w}%`, height:`${el.h}%`,
                          objectFit:"contain", pointerEvents:"none", zIndex: 1
                        }} />
                      );
                      return null;
                    });
                  })()}

                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 2,
                    display: "flex", flexDirection: "column",
                    alignItems: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    justifyContent: (slide.layout === "cover" || slide.layout === "closing") ? "center" : "flex-start",
                    padding: "48px",
                    color: getPreviewTextColor(slide)
                  }}>
                    {(slide.layout === "cover" || slide.layout === "closing") ? (
                      <>
                        <div style={{
                          fontSize: "48px", fontWeight: 800,
                          textAlign: "center", lineHeight: 1.3, marginBottom: "20px",
                          fontFamily: tmHeadingFont || "inherit",
                          color: getPreviewTextColor(slide),
                          whiteSpace: "pre-wrap"
                        }}>
                          {slide.heading || slide.title}
                        </div>
                        {slide.sub && (
                          <div style={{
                            fontSize: "22px", textAlign: "center",
                            color: getPreviewSubColor(slide),
                            fontFamily: tmBodyFont || "inherit"
                          }}>
                            {slide.sub}
                          </div>
                        )}
                        {slide.note && (
                          <div style={{
                            position: "absolute", bottom: "24px", right: "32px",
                            fontSize: "16px", opacity: 0.7,
                            fontFamily: tmBodyFont || "inherit"
                          }}>
                            {slide.note}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {templateFile && tmAccent && (
                          <div style={{
                            width: "80px", height: "4px",
                            background: tmAccent,
                            borderRadius: "2px",
                            marginBottom: "12px"
                          }} />
                        )}
                        <div style={{
                          fontSize: "36px", fontWeight: 800, marginBottom: "14px",
                          fontFamily: tmHeadingFont || "inherit",
                          color: getPreviewTextColor(slide)
                        }}>
                          {slide.heading || slide.title}
                        </div>
                        {slide.sub && (
                          <div style={{
                            fontSize: "20px",
                            color: getPreviewSubColor(slide),
                            marginBottom: "16px", fontWeight: 500,
                            fontFamily: tmBodyFont || "inherit"
                          }}>
                            {slide.sub}
                          </div>
                        )}
                        <div style={{
                          fontSize: "18px", lineHeight: 1.7,
                          whiteSpace: "pre-wrap",
                          color: getPreviewTextColor(slide),
                          opacity: slide.light ? 0.9 : 1,
                          overflow: "hidden", flex: 1, width: "100%",
                          fontFamily: tmBodyFont || "inherit"
                        }}>
                          {slide.body}
                        </div>
                      </>
                    )}
                  </div>

                  {slide.dataSrc && slide.dataSrc.length > 0 && (
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      padding: "6px 24px", zIndex: 3,
                      background: "rgba(46,125,50,0.04)",
                      borderTop: "1px solid rgba(46,125,50,0.1)",
                      display: "flex", gap: "8px", alignItems: "center"
                    }}>
                      <span style={{ fontSize: "10px", color: V.green, fontWeight: 600 }}>{"\u30c7\u30fc\u30bf\u53c2\u7167\uff1a"}</span>
                      {slide.dataSrc.map((d, di) => (
                        <span key={di} style={{
                          fontSize: "10px", color: V.green,
                          background: "rgba(46,125,50,0.08)",
                          padding: "1px 6px", borderRadius: "3px"
                        }}>{"\ud83d\udcca"} {d}</span>
                      ))}
                    </div>
                  )}

                  {slide.ai && slide.ai.length > 0 && (
                    <div style={{
                      position: "absolute", bottom: slide.dataSrc?.length ? "28px" : 0,
                      left: 0, right: 0, zIndex: 3,
                      padding: "4px 24px 6px",
                      display: "flex", gap: "8px", alignItems: "center",
                      borderTop: `1px solid ${V.border}`
                    }}>
                      {slide.ai.map((a, ai) => (
                        <span key={ai} style={{
                          fontSize: "9px", color: MODEL_COLORS[a.model] || "#999",
                          display: "flex", alignItems: "center", gap: "2px"
                        }}>
                          {a.icon} {MODEL_NAMES[a.model] || a.model} {"\u2192"} {a.part}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Thumbnail strip */}
            <div style={{
              display: "flex", gap: "8px", overflowX: "auto",
              padding: "4px 0", flexShrink: 0
            }}>
              {slides.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => setCurSlide(i)}
                  style={{
                    width: "120px", height: "68px", flexShrink: 0,
                    borderRadius: "4px",
                    border: `2px solid ${i === curSlide ? V.accent : V.border}`,
                    cursor: "pointer",
                    overflow: "hidden",
                    position: "relative",
                    ...getPreviewBg(s)
                  }}
                >
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex", flexDirection: "column",
                    alignItems: (s.layout === "cover" || s.layout === "closing") ? "center" : "flex-start",
                    justifyContent: (s.layout === "cover" || s.layout === "closing") ? "center" : "flex-start",
                    padding: "6px", overflow: "hidden"
                  }}>
                    <div style={{
                      fontSize: "6px", fontWeight: 800,
                      color: getPreviewTextColor(s),
                      textAlign: (s.layout === "cover" || s.layout === "closing") ? "center" : "left",
                      lineHeight: 1.2, whiteSpace: "pre-wrap",
                      overflow: "hidden", maxHeight: "30px"
                    }}>
                      {(s.heading || s.title).replace(/\n/g, " ")}
                    </div>
                    {s.body && (
                      <div style={{
                        fontSize: "4px", color: getPreviewTextColor(s), opacity: 0.6,
                        lineHeight: 1.2, marginTop: "2px", overflow: "hidden", maxHeight: "20px"
                      }}>
                        {s.body.substring(0, 80)}
                      </div>
                    )}
                  </div>
                  <div style={{
                    position: "absolute", bottom: "2px", right: "2px",
                    fontSize: "8px", fontWeight: 700, color: V.white,
                    background: i === curSlide ? V.accent : "rgba(0,0,0,0.4)",
                    borderRadius: "3px", padding: "1px 4px"
                  }}>
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
