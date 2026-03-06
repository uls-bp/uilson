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

    // Use JSZip to parse the PPTX (which is a ZIP file)
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);

    // Count slides
    const slideFiles = Object.keys(zip.files).filter(
      f => f.match(/^ppt\/slides\/slide\d+\.xml$/)
    );

    // Extract theme fonts
    let fonts = { heading: null, body: null };
    let colors = {};
    try {
      const themeFile = zip.file('ppt/theme/theme1.xml');
      if (themeFile) {
        const themeXml = await themeFile.async('string');
        const majorEa = themeXml.match(/<a:majorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
        const minorEa = themeXml.match(/<a:minorFont>[\s\S]*?<a:ea\s+typeface="([^"]+)"/);
        const majorLat = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
        const minorLat = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
        fonts.heading = majorEa?.[1] || majorLat?.[1] || null;
        fonts.body = minorEa?.[1] || minorLat?.[1] || null;

        // Extract key colors
        const dk1 = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr val="([^"]+)"/);
        const accent1 = themeXml.match(/<a:accent1>[\s\S]*?<a:srgbClr val="([^"]+)"/);
        if (dk1) colors.dk1 = dk1[1];
        if (accent1) colors.accent1 = accent1[1];
      }
    } catch (e) {
      // Theme parsing optional
    }

    // Check for slide masters
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
      masterCount: masterFiles.length,
      layoutCount: layoutFiles.length
    });
  } catch (err) {
    console.error('parse-template error:', err);
    return res.status(500).json({ error: err.message });
  }
}
