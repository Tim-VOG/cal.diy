# NE26 email templates — design drafts

Open these `.html` files in a browser, restyle them to your taste, then send them
back. I'll wire them into the code as the real templates, substituting the dynamic
fields. **Keep the `{{placeholders}}` exactly as written** — they're replaced at
send time. Everything else (layout, colors, fonts, wording) is yours to change.

Email-safe rules to keep in mind while editing:
- Use tables for layout and **inline `style="..."`** (many clients drop `<style>` blocks).
- Keep the logo as an absolute URL (`https://rooms.vo-eu.be/emails/logo.png`).
- Avoid external CSS / JS / web fonts.

## Files & their dynamic placeholders

### verification.html — account verification (sent on signup)
- `{{name}}` — recipient name
- `{{verifyUrl}}` — verification link (button + plain link)
- `{{supportEmail}}` — support address

### invoice.html — booking confirmation + invoice (PDF + .ics attached)
- `{{name}}`, `{{roomName}}`, `{{amount}}`, `{{invoiceNumber}}`

### credit-note.html — refund / cancellation (credit-note PDF attached)
- `{{name}}`, `{{roomName}}`, `{{amount}}`, `{{creditNoteNumber}}`

The **subject** and **sender display name** are separate (not in the HTML) — tell me
those too if you want to change them. Current:
- Verification — `NATO Edge 26: Verify your account`
- Invoice — `Your NATO Edge 26 booking — invoice {{invoiceNumber}}`
- Credit note — `Your NATO Edge 26 refund — credit note {{creditNoteNumber}}`
- Sender display name (all): `NATO Edge 26`
