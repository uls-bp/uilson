import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = new IncomingForm({ maxFileSize: 50 * 1024 * 1024 });
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const templateFile = Array.isArray(files.template)
      ? files.template[0]
      : files.template;

    if (!templateFile) {
      return res.status(400).json({ error: 'No template file provided' });
    }

    const buf = readFileSync(templateFile.filepath);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);

    // Count slides
    const slideFiles = Object.keys(zip.files).filter(
      f => f.match(/^ppt\/slides\/slide\d+\.xml$/)
    );

    // Extract theme fonts & colors
    let fonts = { heading: null, body: null };
    let colors = {};
    try {
      const themeFile = zip.file('ppt/theme/theme1.xml');
      if (themeFile) {
        const themeXml = await themeFile.async('string');

        // Extract fonts
        const majorEa = themeXml.match(/<a:majorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
        const minorEa = themeXml.match(/<a:minorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
        const majorLat = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
        const minorLat = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
        fonts.heading = majorEa?.[1] || majorLat?.[1] || null;
        fonts.body = minorEa?.[1] || minorLat?.[1] || null;

        // Extract all scheme colors
        const extractColor = (tag) => {
          // Try srgbClr first
          const srgb = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<a:srgbClr val="([^"]+)"`, 'i'));
          if (srgb) return srgb[1];
          // Try sysClr
          const sys = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<a:sysClr[^>]*lastClr="([^"]+)"`, 'i'));
          if (sys) return sys[1];
          return null;
        };

        colors.dk1 = extractColor('dk1');
        colors.dk2 = extractColor('dk2');
        colors.lt1 = extractColor('lt1');
        colors.lt2 = extractColor('lt2');
        colors.accent1 = extractColor('accent1');
        colors.accent2 = extractColor('accent2');
        colors.accent3 = extractColor('accent3');
        colors.accent4 = extractColor('accent4');
        colors.accent5 = extractColor('accent5');
        colors.accent6 = extractColor('accent6');
        colors.hlink = extractColor('hlink');
      }
    } catch (e) {
      // Theme parsing optional
    }

    // Extract background images from slide masters/layouts
    let backgrounds = { cover: null, content: null };
    try {
      // Check slide master for background image
      const masterRels = zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels');
      const masterXml = zip.file('ppt/slideMasters/slideMaster1.xml');

      if (masterXml) {
        const masterContent = await masterXml.async('string');
        // Check for background fill with image
        const bgImgMatch = masterContent.match(/<p:bg>[\s\S]*?<a:blipFill>[\s\S]*?r:embed="([^"]+)"/);

        if (bgImgMatch && masterRels) {
          const relsContent = await masterRels.async('string');
          const relId = bgImgMatch[1];
          const targetMatch = relsContent.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`));
          if (targetMatch) {
            let imgPath = targetMatch[1];
            if (imgPath.startsWith('../')) {
              imgPath = 'ppt/' + imgPath.replace('../', '');
            } else if (!imgPath.startsWith('ppt/')) {
              imgPath = 'ppt/slideMasters/' + imgPath;
            }
            const imgFile = zip.file(imgPath);
            if (imgFile) {
              const imgBuf = await imgFile.async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
              backgrounds.content = `data:${mime};base64,${imgBuf}`;
            }
          }
        }

        // Check for solid background color
        if (!backgrounds.content) {
          const solidBg = masterContent.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
          if (solidBg) {
            backgrounds.contentColor = solidBg[1];
          }
        }
      }

      // Check first slide layout (often title/cover layout)
      const layout1 = zip.file('ppt/slideLayouts/slideLayout1.xml');
      const layout1Rels = zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels');
      if (layout1) {
        const layoutContent = await layout1.async('string');
        const bgImgMatch = layoutContent.match(/<p:bg>[\s\S]*?<a:blipFill>[\s\S]*?r:embed="([^"]+)"/);

        if (bgImgMatch && layout1Rels) {
          const relsContent = await layout1Rels.async('string');
          const relId = bgImgMatch[1];
          const targetMatch = relsContent.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`));
          if (targetMatch) {
            let imgPath = targetMatch[1];
            if (imgPath.startsWith('../')) {
              imgPath = 'ppt/' + imgPath.replace('../', '');
            } else if (!imgPath.startsWith('ppt/')) {
              imgPath = 'ppt/slideLayouts/' + imgPath;
            }
            const imgFile = zip.file(imgPath);
            if (imgFile) {
              const imgBuf = await imgFile.async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
              backgrounds.cover = `data:${mime};base64,${imgBuf}`;
            }
          }
        }

        // Check for solid background color on cover layout
        if (!backgrounds.cover) {
          const solidBg = layoutContent.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
          if (solidBg) {
            backgrounds.coverColor = solidBg[1];
          }
        }
      }

      // Also extract from actual slides (first slide = cover, second = content)
      for (let i = 0; i < Math.min(slideFiles.length, 2); i++) {
        const slideFile = zip.file(slideFiles[i]);
        const slideRels = zip.file(slideFiles[i].replace('slides/', 'slides/_rels/').replace('.xml', '.xml.rels'));
        if (!slideFile) continue;
        const slideContent = await slideFile.async('string');

        const bgImgMatch = slideContent.match(/<p:bg>[\s\S]*?<a:blipFill>[\s\S]*?r:embed="([^"]+)"/);
        if (bgImgMatch && slideRels) {
          const relsContent = await slideRels.async('string');
          const relId = bgImgMatch[1];
          const targetMatch = relsContent.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`));
          if (targetMatch) {
            let imgPath = targetMatch[1];
            if (imgPath.startsWith('../')) {
              imgPath = 'ppt/' + imgPath.replace('../', '');
            } else if (!imgPath.startsWith('ppt/')) {
              imgPath = 'ppt/slides/' + imgPath;
            }
            const imgFile = zip.file(imgPath);
            if (imgFile) {
              const imgBuf = await imgFile.async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
              if (i === 0 && !backgrounds.cover) {
                backgrounds.cover = `data:${mime};base64,${imgBuf}`;
              } else if (i === 1 && !backgrounds.content) {
                backgrounds.content = `data:${mime};base64,${imgBuf}`;
              }
            }
          }
        }

        // Check for solid bg color
        if (!bgImgMatch) {
          const solidBg = slideContent.match(/<p:bg>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/);
          if (solidBg) {
            if (i === 0 && !backgrounds.cover && !backgrounds.coverColor) {
              backgrounds.coverColor = solidBg[1];
            } else if (i === 1 && !backgrounds.content && !backgrounds.contentColor) {
              backgrounds.contentColor = solidBg[1];
            }
          }
        }
      }
    } catch (e) {
      // Background extraction optional
      console.log('bg extraction:', e.message);
    }

    // Check for slide masters/layouts count
    const masterFiles = Object.keys(zip.files).filter(
      f => f.match(/^ppt\/slideMasters\//)
    );
    const layoutFiles = Object.keys(zip.files).filter(
      f => f.match(/^ppt\/slideLayouts\//)
    );

    return res.status(200).json({
      slideCount: slideFiles.length,
      fonts,
      colors,
      backgrounds,
      masterCount: masterFiles.length,
      layoutCount: layoutFiles.length
    });
  } catch (err) {
    console.error('parse-template error:', err);
    return res.status(500).json({ error: err.message });
  }
}
