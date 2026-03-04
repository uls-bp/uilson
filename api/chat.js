// Gemini model fallback chain: try models in order, skip to next on 404/deprecated
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

async function callGemini(apiKey, reqBody) {
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    if (resp.status === 404 || resp.status === 403) continue; // model deprecated or unavailable
    const data = await resp.json();
    if (data.error && (data.error.code === 404 || data.error.status === 'NOT_FOUND')) continue;
    return { data, model };
  }
  return { data: { error: { message: 'All Gemini models unavailable' } }, model: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey)
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const { messages, system, googleToken, msToken, slackToken } = req.body;

    const tools = [
      // ===== GMAIL TOOLS =====
      {
        name: 'gmail_search',
        description: 'Search Gmail messages dynamically. Use when user asks about specific emails by date, sender, subject, etc.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query (e.g. "from:john after:2026/03/01", "subject:meeting", "is:unread")' }, maxResults: { type: 'number', description: 'Max results (default 15)' } }, required: ['query'] }
      },
      {
        name: 'gmail_trash',
        description: 'Move a Gmail email to trash. Requires messageId.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Gmail message ID' } }, required: ['messageId'] }
      },
      {
        name: 'gmail_modify_labels',
        description: 'Add or remove labels on a Gmail email. Use for moving between folders, marking read/unread, starring. Common labels: INBOX, STARRED, IMPORTANT, SPAM, TRASH, UNREAD. To mark as read: remove UNREAD. To star: add STARRED. To move to folder: add target label and optionally remove INBOX.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Gmail message ID' }, addLabelIds: { type: 'array', items: { type: 'string' }, description: 'Label IDs to add' }, removeLabelIds: { type: 'array', items: { type: 'string' }, description: 'Label IDs to remove' } }, required: ['messageId'] }
      },
      {
        name: 'gmail_list_labels',
        description: 'List all available Gmail labels (folders). Use to find label IDs for moving emails.',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'gmail_get_attachments',
        description: 'Check if a Gmail message has attachments and list their filenames and sizes.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Gmail message ID' } }, required: ['messageId'] }
      },
      {
        name: 'gmail_create_draft',
        description: 'Create a Gmail draft email. Use this when user wants to compose an email. The draft is saved but NOT sent. Tell the user: "Draft created. Would you like me to send it now, or keep it as a draft?"',
        input_schema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email address(es), comma separated' }, subject: { type: 'string', description: 'Email subject' }, body: { type: 'string', description: 'Email body (plain text)' }, cc: { type: 'string', description: 'CC recipients, comma separated' }, bcc: { type: 'string', description: 'BCC recipients, comma separated' } }, required: ['to', 'subject', 'body'] }
      },
      {
        name: 'gmail_send_draft',
        description: 'Send an existing Gmail draft. IMPORTANT: Only use this AFTER the user explicitly confirms they want to send. This is the human-in-the-loop step. First create a draft with gmail_create_draft, show it to the user, and only send after their confirmation.',
        input_schema: { type: 'object', properties: { draftId: { type: 'string', description: 'The draft ID returned from gmail_create_draft' } }, required: ['draftId'] }
      },
      {
        name: 'gmail_send_direct',
        description: 'Send a Gmail email directly without creating a draft first. IMPORTANT: Only use this when the user has EXPLICITLY said to send immediately. If there is any ambiguity, use gmail_create_draft instead and confirm with the user.',
        input_schema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email(s), comma separated' }, subject: { type: 'string', description: 'Email subject' }, body: { type: 'string', description: 'Email body (plain text)' }, cc: { type: 'string', description: 'CC recipients' }, bcc: { type: 'string', description: 'BCC recipients' } }, required: ['to', 'subject', 'body'] }
      },
      // ===== GOOGLE CALENDAR TOOLS =====
      {
        name: 'calendar_create_event',
        description: 'Create a new Google Calendar event. For meetings with attendees, include their email addresses.',
        input_schema: { type: 'object', properties: { summary: { type: 'string', description: 'Event title' }, description: { type: 'string', description: 'Event description' }, startDateTime: { type: 'string', description: 'Start in ISO 8601 (e.g. 2026-03-15T10:00:00+09:00)' }, endDateTime: { type: 'string', description: 'End in ISO 8601' }, location: { type: 'string', description: 'Location' }, attendees: { type: 'array', items: { type: 'string' }, description: 'List of attendee email addresses for meeting invites' } }, required: ['summary', 'startDateTime', 'endDateTime'] }
      },
      {
        name: 'calendar_update_event',
        description: 'Update an existing Google Calendar event.',
        input_schema: { type: 'object', properties: { eventId: { type: 'string', description: 'The calendar event ID' }, summary: { type: 'string' }, description: { type: 'string' }, startDateTime: { type: 'string' }, endDateTime: { type: 'string' }, location: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' }, description: 'Updated attendee emails' } }, required: ['eventId'] }
      },
      {
        name: 'calendar_delete_event',
        description: 'Delete a Google Calendar event.',
        input_schema: { type: 'object', properties: { eventId: { type: 'string', description: 'The calendar event ID to delete' } }, required: ['eventId'] }
      },
      // ===== OUTLOOK MAIL TOOLS =====
      {
        name: 'outlook_search_mail',
        description: 'Search Outlook emails via Microsoft Graph API. Use whenever user asks about Outlook emails.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword (subject, body, sender)' }, fromAddress: { type: 'string', description: 'Filter by sender email' }, startDate: { type: 'string', description: 'Emails on/after this date (ISO 8601)' }, endDate: { type: 'string', description: 'Emails before this date (ISO 8601)' }, folder: { type: 'string', description: 'Mail folder: inbox, sentitems, drafts, junkemail, deleteditems' }, top: { type: 'number', description: 'Max results (default 20)' } } }
      },
      {
        name: 'outlook_delete_mail',
        description: 'Delete an Outlook email (moves to Deleted Items).',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Outlook message ID' } }, required: ['messageId'] }
      },
      {
        name: 'outlook_move_mail',
        description: 'Move an Outlook email to a different folder. Common folder IDs: inbox, drafts, sentitems, deleteditems, junkemail, archive. You can also use folder display names.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Outlook message ID' }, destinationFolder: { type: 'string', description: 'Target folder ID or well-known name (inbox, archive, deleteditems, etc.)' } }, required: ['messageId', 'destinationFolder'] }
      },
      {
        name: 'outlook_mark_read',
        description: 'Mark an Outlook email as read or unread.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Outlook message ID' }, isRead: { type: 'boolean', description: 'true = mark as read, false = mark as unread' } }, required: ['messageId', 'isRead'] }
      },
      {
        name: 'outlook_flag_mail',
        description: 'Set or clear a follow-up flag on an Outlook email. Flagged emails appear in the To-Do list.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Outlook message ID' }, flagStatus: { type: 'string', description: 'flagged, complete, or notFlagged' } }, required: ['messageId', 'flagStatus'] }
      },
      {
        name: 'outlook_get_attachments',
        description: 'Check if an Outlook email has attachments and list their names and sizes.',
        input_schema: { type: 'object', properties: { messageId: { type: 'string', description: 'The Outlook message ID' } }, required: ['messageId'] }
      },
      {
        name: 'outlook_create_draft',
        description: 'Create an Outlook email draft. The draft is saved but NOT sent.',
        input_schema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email(s), comma separated' }, subject: { type: 'string', description: 'Email subject' }, body: { type: 'string', description: 'Email body' }, cc: { type: 'string', description: 'CC recipients' }, bodyType: { type: 'string', description: 'Text or HTML (default Text)' } }, required: ['to', 'subject', 'body'] }
      },
      {
        name: 'outlook_list_folders',
        description: 'List all Outlook mail folders with their IDs and unread counts.',
        input_schema: { type: 'object', properties: {} }
      },
      o/ ===== OUTLOOK CALENDAR TOOLS =====
      {
        name: 'outlook_list_events',
        description: 'List Outlook calendar events in a date range.',
        input_schema: { type: 'object', properties: { startDate: { type: 'string', description: 'Start (ISO 8601)' }, endDate: { type: 'string', description: 'End (ISO 8601)' }, top: { type: 'number', description: 'Max results (default 20)' } }, required: ['startDate', 'endDate'] }
      },
      {
        name: 'outlook_calendar_create',
        description: 'Create an Outlook calendar event. For meeting invites, include attendee emails.',
        input_schema: { type: 'object', properties: { subject: { type: 'string', description: 'Event title' }, body: { type: 'string', description: 'Event description' }, startDateTime: { type: 'string', description: 'Start (ISO 8601)' }, endDateTime: { type: 'string', description: 'End (ISO 8601)' }, timeZone: { type: 'string', description: 'Time zone (default Asia/Tokyo)' }, location: { type: 'string', description: 'Location' }, attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses for meeting invites' } }, required: ['subject', 'startDateTime', 'endDateTime'] }
      },
      {
        name: 'outlook_calendar_update',
        description: 'Update an existing Outlook calendar event.',
        input_schema: { type: 'object', properties: { eventId: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, startDateTime: { type: 'string' }, endDateTime: { type: 'string' }, timeZone: { type: 'string' }, location: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } }, required: ['eventId'] }
      },
      {
        name: 'outlook_calendar_delete',
        description: 'Delete an Outlook calendar event.',
        input_schema: { type: 'object', properties: { eventId: { type: 'string', description: 'The Outlook event ID' } }, required: ['eventId'] }
      },
      {
        name: 'sharepoint_search_sites',
        description: 'Search SharePoint sites accessible to the user.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword' } }, required: ['query'] }
      },
      {
        name: 'sharepoint_list_files',
        description: 'List files in a SharePoint site document library.',
        input_schema: { type: 'object', properties: { siteId: { type: 'string', description: 'SharePoint site ID' }, path: { type: 'string', description: 'Folder path (default: root)' } }, required: ['siteId'] }
      },
      {
        name: 'sharepoint_search_files',
        description: 'Search files across SharePoint by keyword.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword for files' } }, required: ['query'] }
      },
      {
        name: 'sharepoint_get_file_content',
        description: 'Get the text content or metadata of a SharePoint file.',
        input_schema: { type: 'object', properties: { siteId: { type: 'string', description: 'SharePoint site ID' }, itemId: { type: 'string', description: 'File/item ID' } }, required: ['siteId', 'itemId'] }
      }
    ,
      // ===== SLACK DM TOOLS =====
      {
        name: 'slack_search_users',
        description: 'Search Slack workspace users by name, display_name, email, etc. Returns matching users with their IDs. Use this first to find a DM target. IMPORTANT: If searching with Japanese kanji/hiragana returns no results, retry with romaji (e.g. if æ¨ä¸ fails, try kinoshita). Also try partial matches and English names.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name or partial name to search (e.g. "ç°ä¸­", "Tanaka", "john")' } }, required: ['query'] }
      },
      {
        name: 'slack_read_dm',
        description: 'Read DM (direct message) history with a specific Slack user. Requires the user ID from slack_search_users.',
        input_schema: { type: 'object', properties: { userId: { type: 'string', description: 'Slack user ID (e.g. U01ABC123)' }, limit: { type: 'number', description: 'Number of messages to fetch (default 20, max 50)' } }, required: ['userId'] }
      },
      {
        name: 'slack_send_dm',
        description: 'Send a DM (direct message) to a Slack user. IMPORTANT: Only use after user explicitly confirms the message content. First show the draft message and ask for confirmation.',
        input_schema: { type: 'object', properties: { userId: { type: 'string', description: 'Slack user ID' }, text: { type: 'string', description: 'Message text to send' } }, required: ['userId', 'text'] }
      }
    ,{name:"teams_list_chats",description:"List user's recent Teams chats with last message preview",input_schema:{type:"object",properties:{top:{type:"number",description:"Number of chats (max 50)"}}}},{name:"teams_get_chat_messages",description:"Get messages from a specific Teams chat",input_schema:{type:"object",properties:{chatId:{type:"string",description:"Chat ID"}},required:["chatId"]}},{name:"teams_list_teams_channels",description:"List joined teams and their channels",input_schema:{type:"object",properties:{}}},{name:"teams_get_channel_messages",description:"Get recent messages from a Teams channel",input_schema:{type:"object",properties:{teamId:{type:"string",description:"Team ID"},channelId:{type:"string",description:"Channel ID"}},required:["teamId","channelId"]}},{name:"google_drive_search",description:"Search files in Google Drive",input_schema:{type:"object",properties:{query:{type:"string",description:"Search query"}},required:["query"]}},{name:"google_drive_list",description:"List recent files in Google Drive",input_schema:{type:"object",properties:{pageSize:{type:"number",description:"Number of files (max 100)"},folderId:{type:"string",description:"Folder ID (optional)"}}}},{name:"google_drive_get_content",description:"Get text content of a Google Drive document",input_schema:{type:"object",properties:{fileId:{type:"string",description:"File ID"}},required:["fileId"]}}];

    // ===== TOOL EXECUTION =====
    async function executeTool(name, input, gToken, msTk) {
      const gh = { 'Authorization': 'Bearer ' + gToken, 'Content-Type': 'application/json' };
      const mh = { 'Authorization': 'Bearer ' + msTk, 'Content-Type': 'application/json' };

      try {
        switch (name) {

          // ----- Gmail -----
          case 'gmail_search': {
            const q = encodeURIComponent(input.query || '');
            const max = input.maxResults || 15;
            const listR = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + q + '&maxResults=' + max, { headers: gh });
            const listD = await listR.json();
            if (!listR.ok) return { error: listD.error?.message || 'Gmail search failed' };
            if (!listD.messages || listD.messages.length === 0) return { results: [], message: 'No emails found matching: ' + input.query };
            const results = [];
            for (const msg of listD.messages.slice(0, max)) {
              const detR = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + msg.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To', { headers: gh });
              const detD = await detR.json();
              if (detR.ok) {
                const hdrs = {};
                (detD.payload?.headers || []).forEach(h => { hdrs[h.name] = h.value; });
                results.push({ id: detD.id, threadId: detD.threadId, from: hdrs.From || '', to: hdrs.To || '', subject: hdrs.Subject || '', date: hdrs.Date || '', snippet: detD.snippet || '', labelIds: detD.labelIds || [] });
              }
            }
            return { results, totalFound: listD.resultSizeEstimate || results.length };
          }

          case 'gmail_trash': {
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + input.messageId + '/trash', { method: 'POST', headers: gh });
            return r.ok ? { success: true, message: 'Email moved to trash' } : { error: (await r.json()).error?.message || 'Failed' };
          }

          case 'gmail_modify_labels': {
            const body = {};
            if (input.addLabelIds) body.addLabelIds = input.addLabelIds;
            if (input.removeLabelIds) body.removeLabelIds = input.removeLabelIds;
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + input.messageId + '/modify', { method: 'POST', headers: gh, body: JSON.stringify(body) });
            return r.ok ? { success: true, message: 'Labels updated' } : { error: (await r.json()).error?.message || 'Failed' };
          }

          case 'gmail_list_labels': {
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: gh });
            const d = await r.json();
            return r.ok ? { labels: (d.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type })) } : { error: d.error?.message || 'Failed' };
          }

          case 'gmail_get_attachments': {
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + input.messageId + '?format=full', { headers: gh });
            const d = await r.json();
            if (!r.ok) return { error: d.error?.message || 'Failed' };
            const attachments = [];
            function findParts(parts) {
              for (const p of (parts || [])) {
                if (p.filename && p.filename.length > 0) {
                  attachments.push({ filename: p.filename, mimeType: p.mimeType, size: p.body?.size || 0 });
                }
                if (p.parts) findParts(p.parts);
              }
            }
            findParts(d.payload?.parts);
            if (d.payload?.filename && d.payload.filename.length > 0) {
              attachments.push({ filename: d.payload.filename, mimeType: d.payload.mimeType, size: d.payload.body?.size || 0 });
            }
            return { hasAttachments: attachments.length > 0, count: attachments.length, attachments };
          }

          case 'gmail_create_draft': {
            const toLine = input.to;
            const subj = input.subject;
            const bodyText = input.body;
            let rawEmail = 'To: ' + toLine + '\nSubject: ' + subj + '\nContent-Type: text/plain; charset=utf-8\n';
            if (input.cc) rawEmail += 'Cc: ' + input.cc + '\n';
            if (input.bcc) rawEmail += 'Bcc: ' + input.bcc + '\n';
            rawEmail += '\n' + bodyText;
            const encoded = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
              method: 'POST', headers: gh,
              body: JSON.stringify({ message: { raw: encoded } })
            });
            const d = await r.json();
            return r.ok ? { success: true, draftId: d.id, message: 'Draft created. Ask user: send now or keep as draft?' } : { error: d.error?.message || 'Failed to create draft' };
          }

          case 'gmail_send_draft': {
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
              method: 'POST', headers: gh,
              body: JSON.stringify({ id: input.draftId })
            });
            const d = await r.json();
            return r.ok ? { success: true, messageId: d.id, message: 'Email sent successfully' } : { error: d.error?.message || 'Failed to send' };
          }

          case 'gmail_send_direct': {
            const toLine = input.to;
            const subj = input.subject;
            const bodyText = input.body;
            let rawEmail = 'To: ' + toLine + '\nSubject: ' + subj + '\nContent-Type: text/plain; charset=utf-8\n';
            if (input.cc) rawEmail += 'Cc: ' + input.cc + '\n';
            if (input.bcc) rawEmail += 'Bcc: ' + input.bcc + '\n';
            rawEmail += '\n' + bodyText;
            const encoded = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST', headers: gh,
              body: JSON.stringify({ raw: encoded })
            });
            const d = await r.json();
            return r.ok ? { success: true, messageId: d.id, message: 'Email sent' } : { error: d.error?.message || 'Failed to send' };
          }

          // ----- Google Calendar -----
          case 'calendar_create_event': {
            const ev = { summary: input.summary, start: { dateTime: input.startDateTime }, end: { dateTime: input.endDateTime } };
            if (input.description) ev.description = input.description;
            if (input.location) ev.location = input.location;
            if (input.attendees && input.attendees.length > 0) {
              ev.attendees = input.attendees.map(e => ({ email: e }));
            }
            const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', { method: 'POST', headers: gh, body: JSON.stringify(ev) });
            const d = await r.json();
            return r.ok ? { success: true, eventId: d.id, summary: d.summary, start: d.start, end: d.end, attendees: d.attendees?.map(a => a.email) } : { error: d.error?.message || 'Failed' };
          }

          case 'calendar_update_event': {
            const patch = {};
            if (input.summary) patch.summary = input.summary;
            if (input.description) patch.description = input.description;
            if (input.startDateTime) patch.start = { dateTime: input.startDateTime };
            if (input.endDateTime) patch.end = { dateTime: input.endDateTime };
            if (input.location) patch.location = input.location;
            if (input.attendees && input.attendees.length > 0) {
              patch.attendees = input.attendees.map(e => ({ email: e }));
            }
            const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + input.eventId + '?sendUpdates=all', { method: 'PATCH', headers: gh, body: JSON.stringify(patch) });
            const d = await r.json();
            return r.ok ? { success: true, eventId: d.id, summary: d.summary } : { error: d.error?.message || 'Failed' };
          }

          case 'calendar_delete_event': {
            const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + input.eventId + '?sendUpdates=all', { method: 'DELETE', headers: gh });
            return (r.ok || r.status === 204) ? { success: true, message: 'Event deleted' } : { error: 'Failed to delete' };
          }

          // ----- Outlook Mail -----
          case 'outlook_search_mail': {
            if (!msTk) return { error: 'Outlook not connected. Please connect Outlook first in Settings.' };
            const top = input.top || 20;
            const sel = '$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments';
            const order = '$orderby=receivedDateTime desc';
            const filters = [];
            if (input.startDate) filters.push("receivedDateTime ge " + input.startDate);
            if (input.endDate) filters.push("receivedDateTime lt " + input.endDate);
            if (input.fromAddress) filters.push("from/emailAddress/address eq '" + input.fromAddress + "'");
            const base = input.folder ? 'https://graph.microsoft.com/v1.0/me/mailFolders/' + input.folder + '/messages' : 'https://graph.microsoft.com/v1.0/me/messages';
            let url = base + '?$top=' + top + '&' + sel + '&' + order;
            if (filters.length > 0) url += '&$filter=' + encodeURIComponent(filters.join(' and '));
            if (input.query) url += '&$search=' + encodeURIComponent('"' + input.query + '"');
            const r = await fetch(url, { headers: mh });
            const d = await r.json();
            if (!r.ok) return { error: d.error?.message || 'Outlook search failed' };
            const emails = (d.value || []).map(m => ({
              id: m.id, subject: m.subject,
              from: (m.from?.emailAddress?.name || '') + ' <' + (m.from?.emailAddress?.address || '') + '>',
              date: m.receivedDateTime, preview: (m.bodyPreview || '').substring(0, 200),
              isRead: m.isRead, flagStatus: m.flag?.flagStatus || 'notFlagged', hasAttachments: m.hasAttachments
            }));
            return { results: emails, count: emails.length };
          }

          case 'outlook_delete_mail': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages/' + input.messageId, { method: 'DELETE', headers: mh });
            return (r.ok || r.status === 204) ? { success: true, message: 'Email deleted' } : { error: 'Failed to delete email' };
          }

          case 'outlook_move_mail': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages/' + input.messageId + '/move', {
              method: 'POST', headers: mh,
              body: JSON.stringify({ destinationId: input.destinationFolder })
            });
            const d = await r.json();
            return r.ok ? { success: true, message: 'Email moved', newId: d.id } : { error: d.error?.message || 'Failed to move email' };
          }

          case 'outlook_mark_read': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages/' + input.messageId, {
              method: 'PATCH', headers: mh,
              body: JSON.stringify({ isRead: input.isRead })
            });
            return r.ok ? { success: true, message: input.isRead ? 'Marked as read' : 'Marked as unread' } : { error: 'Failed to update read status' };
          }

          case 'outlook_flag_mail': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages/' + input.messageId, {
              method: 'PATCH', headers: mh,
              body: JSON.stringify({ flag: { flagStatus: input.flagStatus } })
            });
            return r.ok ? { success: true, message: 'Flag updated to: ' + input.flagStatus } : { error: 'Failed to update flag' };
          }

          case 'outlook_get_attachments': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages/' + input.messageId + '/attachments?$select=name,size,contentType,isInline', { headers: mh });
            const d = await r.json();
            if (!r.ok) return { error: d.error?.message || 'Failed to get attachments' };
            const atts = (d.value || []).map(a => ({ name: a.name, size: a.size, contentType: a.contentType, isInline: a.isInline }));
            return { hasAttachments: atts.length > 0, count: atts.length, attachments: atts };
          }

          case 'outlook_create_draft': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const toRecipients = input.to.split(',').map(e => ({ emailAddress: { address: e.trim() } }));
            const draft = { subject: input.subject, body: { contentType: input.bodyType || 'Text', content: input.body }, toRecipients };
            if (input.cc) {
              draft.ccRecipients = input.cc.split(',').map(e => ({ emailAddress: { address: e.trim() } }));
            }
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', { method: 'POST', headers: mh, body: JSON.stringify(draft) });
            const d = await r.json();
            return r.ok ? { success: true, draftId: d.id, subject: d.subject, message: 'Outlook draft created' } : { error: d.error?.message || 'Failed to create draft' };
          }

          case 'outlook_list_folders': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const r = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount', { headers: mh });
            const d = await r.json();
            if (!r.ok) return { error: d.error?.message || 'Failed to list folders' };
            return { folders: (d.value || []).map(f => ({ id: f.id, name: f.displayName, total: f.totalItemCount, unread: f.unreadItemCount })) };
          }

          // ----- Outlook Calendar -----
          case 'outlook_list_events': {
            if (!msTk) return { error: 'Outlook not connected.' };
            const start = encodeURIComponent(input.startDate);
            const end = encodeURIComponent(input.endDate);
            const top = input.top || 20;
            const url = 'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=' + start + '&endDateTime=' + end + '&$top=' + top + '&$select=id,subject,start,end,location,organizer,isAllDay,bodyPreview,attendees&$orderby=start/dateTime';
            const r = await fetch(url, { headers: mh });
            const d = await r.json();
            if (!r.ok) return { error: d.error?.message || 'Outlook calendar fetch failed' };
            const events = (d.value || []).map(e => ({
              id: e.id, subject: e.subject, start: e.start, end: e.end,
              location: e.location?.displayName || '',
              organizer: e.organizer?.emailAddress?.name || '',
              isAllDay: e.isAllDay,
              attendees: (e.attendees || []).map(a => ({ name: a.emailAddress?.name, email: a.emailAddress?.address, status: a.status?.response })),
              preview: (e.bodyPreview || '').substring(0, 150)
            }));
            return { results: events, count: events.length };
          }

          case 'outlook_calendar_create': {
            const tz = input.timeZone || 'Asia/Tokyo';
            const ev = { subject: input.subject, start: { dateTime: input.startDateTime, timeZone: tz }, end: { dateTime: input.endDateTime, timeZone: tz } };
            if (input.body) ev.body = { contentType: 'Text', content: input.body };
            if (input.location) ev.location = { displayName: input.location };
            if (input.attendees && input.attendees.length > 0) {
              ev.attendees = input.attendees.map(e => ({ emailAddress: { address: e }, type: 'required' }));
            }
            const r = await fetch('https://graph.microsoft.com/v1.0/me/events', { method: 'POST', headers: mh, body: JSON.stringify(ev) });
            const d = await r.json();
            return r.ok ? { success: true, eventId: d.id, subject: d.subject, start: d.start, end: d.end } : { error: d.error?.message || 'Failed' };
          }

          case 'outlook_calendar_update': {
            const patch = {};
            if (input.subject) patch.subject = input.subject;
            if (input.body) patch.body = { contentType: 'Text', content: input.body };
            const tz = input.timeZone || 'Asia/Tokyo';
            if (input.startDateTime) patch.start = { dateTime: input.startDateTime, timeZone: tz };
            if (input.endDateTime) patch.end = { dateTime: input.endDateTime, timeZone: tz };
            if (input.location) patch.location = { displayName: input.location };
            if (input.attendees && input.attendees.length > 0) {
              patch.attendees = input.attendees.map(e => ({ emailAddress: { address: e }, type: 'required' }));
            }
            const r = await fetch('https://graph.microsoft.com/v1.0/me/events/' + input.eventId, { method: 'PATCH', headers: mh, body: JSON.stringify(patch) });
            const d = await r.json();
            return r.ok ? { success: true, eventId: d.id, subject: d.subject } : { error: d.error?.message || 'Failed' };
          }

          case 'outlook_calendar_delete': {
            const r = await fetch('https://graph.microsoft.com/v1.0/me/events/' + input.eventId, { method: 'DELETE', headers: mh });
            return (r.ok || r.status === 204) ? { success: true, message: 'Outlook event deleted' } : { error: 'Failed to delete' };
          }

          case 'sharepoint_search_sites': {
            const q = input.query || '*';
            const sr = await fetch('https://graph.microsoft.com/v1.0/sites?search=' + encodeURIComponent(q) + '&$top=10&$select=id,displayName,webUrl,description', { headers: { Authorization: 'Bearer ' + msToken } });
            if (sr.ok) { const sd = await sr.json(); result = (sd.value || []).map(s => ({ id: s.id, name: s.displayName, url: s.webUrl, desc: s.description })); } else { result = { error: 'Failed to search sites' }; }
            break;
          }
          case 'sharepoint_list_files': {
            const sid = input.siteId;
            const fp = input.path ? ':/' + input.path + ':/children' : '/children';
            const fr = await fetch('https://graph.microsoft.com/v1.0/sites/' + sid + '/drive/root' + fp + '?$top=50&$select=id,name,webUrl,size,lastModifiedDateTime,file,folder', { headers: { Authorization: 'Bearer ' + msToken } });
            if (fr.ok) { const fd = await fr.json(); result = (fd.value || []).map(f => ({ id: f.id, name: f.name, url: f.webUrl, size: f.size, modified: f.lastModifiedDateTime, isFolder: !!f.folder })); } else { result = { error: 'Failed to list files' }; }
            break;
          }
          case 'sharepoint_search_files': {
            const sq = input.query;
            const sfr = await fetch('https://graph.microsoft.com/v1.0/search/query', { method: 'POST', headers: { Authorization: 'Bearer ' + msToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ entityTypes: ['driveItem'], query: { queryString: sq }, from: 0, size: 20 }] }) });
            if (sfr.ok) { const sfd = await sfr.json(); const hits = sfd.value?.[0]?.hitsContainers?.[0]?.hits || []; result = hits.map(h => ({ name: h.resource?.name, url: h.resource?.webUrl, size: h.resource?.size, modified: h.resource?.lastModifiedDateTime })); } else { result = { error: 'Failed to search files' }; }
            break;
          }
          case 'sharepoint_get_file_content': {
            const gsid = input.siteId;
            const gid = input.itemId;
            const gm = await fetch('https://graph.microsoft.com/v1.0/sites/' + gsid + '/drive/items/' + gid + '?$select=id,name,webUrl,size,file,lastModifiedDateTime', { headers: { Authorization: 'Bearer ' + msToken } });
            if (gm.ok) { const gmd = await gm.json(); const preview = await fetch('https://graph.microsoft.com/v1.0/sites/' + gsid + '/drive/items/' + gid + '/content', { headers: { Authorization: 'Bearer ' + msToken } }).then(r => r.text()).then(t => t.substring(0, 3000)).catch(() => '(binary file)'); result = { name: gmd.name, url: gmd.webUrl, size: gmd.size, modified: gmd.lastModifiedDateTime, contentPreview: preview }; } else { result = { error: 'Failed to get file' }; }
            break;
          }
          
          case 'teams_list_chats': {
            const top = input.top || 20;
            const r = await fetch('https://graph.microsoft.com/v1.0/me/chats?$top='+top+'&$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc', {headers:{Authorization:'Bearer '+msToken}});
            if(!r.ok){const e=await r.text();return {error:e};}
            const d = await r.json();
            return {chats:(d.value||[]).map(ch=>({id:ch.id,topic:ch.topic||'(no topic)',type:ch.chatType,lastMsg:ch.lastMessagePreview?{from:ch.lastMessagePreview.from?.user?.displayName||'',body:(ch.lastMessagePreview.body?.content||'').replace(/<[^>]*>/g,'').substring(0,300),date:ch.lastMessagePreview.createdDateTime}:null}))};
          }

          case 'teams_get_chat_messages': {
            const r = await fetch('https://graph.microsoft.com/v1.0/me/chats/'+input.chatId+'/messages?$top=20', {headers:{Authorization:'Bearer '+msToken}});
            if(!r.ok){const e=await r.text();return {error:e};}
            const d = await r.json();
            return {messages:(d.value||[]).map(m=>({from:m.from?.user?.displayName||'',body:(m.body?.content||'').replace(/<[^>]*>/g,'').substring(0,500),date:m.createdDateTime}))};
          }

          case 'teams_list_teams_channels': {
            const tr = await fetch('https://graph.microsoft.com/v1.0/me/joinedTeams', {headers:{Authorization:'Bearer '+msToken}});
            if(!tr.ok){const e=await tr.text();return {error:e};}
            const td = await tr.json();
            const results = [];
            for(const team of (td.value||[])){
              const cr = await fetch('https://graph.microsoft.com/v1.0/teams/'+team.id+'/channels', {headers:{Authorization:'Bearer '+msToken}});
              if(!cr.ok) continue;
              const cd = await cr.json();
              results.push({teamId:team.id,teamName:team.displayName,channels:(cd.value||[]).map(ch=>({id:ch.id,name:ch.displayName}))});
            }
            return {teams:results};
          }

          case 'teams_get_channel_messages': {
            const r = await fetch('https://graph.microsoft.com/v1.0/teams/'+input.teamId+'/channels/'+input.channelId+'/messages?$top=20', {headers:{Authorization:'Bearer '+msToken}});
            if(!r.ok){const e=await r.text();return {error:e};}
            const d = await r.json();
            return {messages:(d.value||[]).map(m=>({from:m.from?.user?.displayName||'',body:(m.body?.content||'').replace(/<[^>]*>/g,'').substring(0,500),date:m.createdDateTime}))};
          }

          case 'google_drive_search': {
            const q = encodeURIComponent("name contains '"+input.query+"' and trashed=false");
            const r = await fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&pageSize=20&orderBy=modifiedTime%20desc&fields=files%28id%2Cname%2CmimeType%2CmodifiedTime%2Cowners%2CwebViewLink%29', {headers:{Authorization:'Bearer '+googleToken}});
            if(!r.ok){const e=await r.text();return {error:e};}
            const d = await r.json();
            return {files:(d.files||[]).map(f=>({id:f.id,name:f.name,type:f.mimeType,modified:f.modifiedTime,link:f.webViewLink||''}))};
          }

          case 'google_drive_list': {
            const ps = input.pageSize || 30;
            let q = 'trashed=false';
            if(input.folderId) q += " and '"+input.folderId+"' in parents";
            const r = await fetch('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&pageSize='+ps+'&orderBy=modifiedTime%20desc&fields=files%28id%2Cname%2CmimeType%2CmodifiedTime%2Cowners%2CwebViewLink%29', {headers:{Authorization:'Bearer '+googleToken}});
            if(!r.ok){const e=await r.text();return {error:e};}
            const d = await r.json();
            return {files:(d.files||[]).map(f=>({id:f.id,name:f.name,type:f.mimeType,modified:f.modifiedTime,link:f.webViewLink||''}))};
          }

          case 'google_drive_get_content': {
            const mr = await fetch('https://www.googleapis.com/drive/v3/files/'+input.fileId+'?fields=id%2Cname%2CmimeType%2CmodifiedTime', {headers:{Authorization:'Bearer '+googleToken}});
            if(!mr.ok){const e=await mr.text();return {error:e};}
            const meta = await mr.json();
            let content = '';
            if(meta.mimeType && meta.mimeType.startsWith('application/vnd.google-apps.')){
              const er = await fetch('https://www.googleapis.com/drive/v3/files/'+input.fileId+'/export?mimeType=text%2Fplain', {headers:{Authorization:'Bearer '+googleToken}});
              if(er.ok) content = (await er.text()).substring(0,5000);
            } else {
              const dr = await fetch('https://www.googleapis.com/drive/v3/files/'+input.fileId+'?alt=media', {headers:{Authorization:'Bearer '+googleToken}});
              if(dr.ok) content = (await dr.text()).substring(0,5000);
            }
            return {file:meta, content};
          }

          // ----- Slack DM -----
          case 'slack_search_users': {
            if (!slackToken) return { error: 'Slack not connected. Please connect Slack first in Settings.' };
            const sh = { Authorization: 'Bearer ' + slackToken };
            let allMembers = [];
            let cursor = '';
            for (let page = 0; page < 10; page++) {
              const url = 'https://slack.com/api/users.list?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
              const r = await fetch(url, { headers: sh });
              const d = await r.json();
              if (!d.ok) return { error: 'Slack API error: ' + (d.error || 'unknown') };
              allMembers = allMembers.concat(d.members || []);
              cursor = d.response_metadata?.next_cursor || '';
              if (!cursor) break;
            }
            const q = (input.query || '').toLowerCase();
            const matches = allMembers
              .filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')
              .filter(u => {
                const rn = (u.real_name || '').toLowerCase();
                const dn = (u.profile?.display_name || '').toLowerCase();
                const nm = (u.name || '').toLowerCase();
                const em = (u.profile?.email || '').toLowerCase();
                const fn = (u.profile?.first_name || '').toLowerCase();
                const ln = (u.profile?.last_name || '').toLowerCase();
                return rn.includes(q) || dn.includes(q) || nm.includes(q) || em.includes(q) || fn.includes(q) || ln.includes(q);
              })
              .slice(0, 10)
              .map(u => ({
                id: u.id,
                real_name: u.real_name || u.name,
                display_name: u.profile?.display_name || '',
                email: u.profile?.email || '',
                title: u.profile?.title || '',
                status: u.profile?.status_text || ''
              }));
            return { results: matches, count: matches.length, message: matches.length === 0 ? 'No users found matching: ' + input.query : null };
          }

          case 'slack_read_dm': {
            if (!slackToken) return { error: 'Slack not connected.' };
            const sh = { Authorization: 'Bearer ' + slackToken, 'Content-Type': 'application/json' };
            // Open (or get existing) DM channel
            const openR = await fetch('https://slack.com/api/conversations.open', {
              method: 'POST', headers: sh,
              body: JSON.stringify({ users: input.userId })
            });
            const openD = await openR.json();
            if (!openD.ok) return { error: 'Cannot open DM: ' + (openD.error || 'unknown') };
            const channelId = openD.channel.id;
            const limit = Math.min(input.limit || 20, 50);
            // Read history
            const histR = await fetch('https://slack.com/api/conversations.history?channel=' + channelId + '&limit=' + limit, { headers: sh });
            const histD = await histR.json();
            if (!histD.ok) return { error: 'Cannot read DM: ' + (histD.error || 'unknown') };
            // Resolve user names
            const uids = [...new Set((histD.messages || []).map(m => m.user).filter(Boolean))];
            const userMap = {};
            for (const uid of uids.slice(0, 10)) {
              try {
                const ur = await fetch('https://slack.com/api/users.info?user=' + uid, { headers: sh });
                const ud = await ur.json();
                if (ud.ok) userMap[uid] = ud.user.real_name || ud.user.name;
              } catch {}
            }
            const messages = (histD.messages || []).reverse().map(m => ({
              from: userMap[m.user] || m.user || 'bot',
              text: (m.text || '').substring(0, 500),
              date: new Date(parseFloat(m.ts) * 1000).toLocaleString('ja-JP'),
              ts: m.ts
            }));
            return { channelId, messages, count: messages.length };
          }

          case 'slack_send_dm': {
            if (!slackToken) return { error: 'Slack not connected.' };
            const sh = { Authorization: 'Bearer ' + slackToken, 'Content-Type': 'application/json' };
            // Open DM channel
            const openR = await fetch('https://slack.com/api/conversations.open', {
              method: 'POST', headers: sh,
              body: JSON.stringify({ users: input.userId })
            });
            const openD = await openR.json();
            if (!openD.ok) return { error: 'Cannot open DM: ' + (openD.error || 'unknown') };
            // Send message
            const sendR = await fetch('https://slack.com/api/chat.postMessage', {
              method: 'POST', headers: sh,
              body: JSON.stringify({ channel: openD.channel.id, text: input.text })
            });
            const sendD = await sendR.json();
            return sendD.ok
              ? { success: true, message: 'DM sent successfully', channel: openD.channel.id, ts: sendD.ts }
              : { error: 'Failed to send DM: ' + (sendD.error || 'unknown') };
          }

          default: return { error: 'Unknown tool: ' + name };
        }
      } catch (e) { return { error: e.message }; }
    }

    // ===== AI CONVERSATION LOOP (Gemini) =====
    const geminiTools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];
    const currentContents = messages.map(m => {
      if (typeof m.content === 'string') return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
      if (Array.isArray(m.content)) {
        const pts = [];
        for (const c of m.content) { if (c.type === 'text') pts.push({ text: c.text }); else pts.push({ text: JSON.stringify(c) }); }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: pts };
      }
      return { role: 'user', parts: [{ text: String(m.content || '') }] };
    });
    for (let i = 0; i < 8; i++) {
      const reqBody = { contents: currentContents, generationConfig: { maxOutputTokens: 8192 } };
      if (system) reqBody.systemInstruction = { parts: [{ text: system }] };
      if (googleToken || msToken || slackToken) reqBody.tools = geminiTools;
      const { data } = await callGemini(geminiKey, reqBody);
      if (!data.candidates || !data.candidates[0]) {
        return res.status(200).json({ content: [{ type: 'text', text: data.error ? data.error.message : JSON.stringify(data) }] });
      }
      const parts = data.candidates[0].content.parts || [];
      const fcs = parts.filter(p => p.functionCall);
      if (fcs.length > 0 && (googleToken || msToken || slackToken)) {
        currentContents.push({ role: 'model', parts: parts });
        const rps = [];
        for (const part of fcs) {
          const fc = part.functionCall;
          const result = await executeTool(fc.name, fc.args, googleToken, msToken);
          rps.push({ functionResponse: { name: fc.name, response: result } });
        }
        currentContents.push({ role: 'user', parts: rps });
      } else {
        const txt = parts.filter(p => p.text).map(p => p.text).join('');
        return res.status(200).json({ content: [{ type: 'text', text: txt || '' }] });
      }
    }
    return res.status(200).json({ content: [{ type: 'text', text: 'Tool execution limit reached.' }] });
  
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
