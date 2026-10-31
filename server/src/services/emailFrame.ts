// The shared look of the emails FleetAI sends for an account: a blue FleetAI banner on top (the
// colours of the FleetAI start screen), the message in the middle and a small FleetAI line at the
// bottom. Only tables and inline styles, so it looks the same in Gmail, Apple Mail and Outlook.
// Symbols are written as HTML entities (&middot; &minus;), so this file stays plain ASCII.

const GRADIENT = 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#3b82f6 100%)'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

// Everything that comes from a person (a name, a plate, a message) goes through this before it
// is put into the HTML.
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface EmailFrameInput {
  title: string       // the page title (the subject)
  preheader: string   // the grey preview line some inboxes show after the subject; not visible in the email
  bodyHtml: string    // table rows (<tr>) for the middle part
  footerHtml: string  // the small lines under "Sent with FleetAI"; already escaped
}

export function emailFrame(input: EmailFrameInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2F7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EEF2F7;font-size:1px;line-height:1px;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF2F7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:2px solid #3b82f6;border-radius:14px;border-collapse:separate;overflow:hidden;font-family:${FONT};color:#1F2937;">
<tr><td align="center" bgcolor="#1e40af" style="background-color:#1e40af;background-image:${GRADIENT};padding:30px 24px 26px;">
<div style="font-size:30px;line-height:1.1;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">FleetAI</div>
<div style="font-size:12px;color:#BFDBFE;margin-top:7px;letter-spacing:.4px;">Fleet Management Platform</div>
</td></tr>
${input.bodyHtml}
<tr><td align="center" style="background-color:#F1F5F9;border-top:1px solid #DBE4F0;padding:16px 28px;font-size:11px;line-height:1.7;color:#94A3B8;">
Sent with <strong style="color:#3b82f6;">FleetAI</strong> &middot; fleetai.co.in<br>
${input.footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`
}
