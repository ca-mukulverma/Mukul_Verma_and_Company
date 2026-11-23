# MVC WhatsApp listener

Reads the client WhatsApp groups of MVC's dedicated number and hands every message to the MV Company app. It is
read-only and never sends anything. The set-up steps and how it works are in `../docs/WHATSAPP_INTAKE.md`.

```
copy env.example .env      (fill in WA_LISTENER_KEY - same as in Vercel)
npm install
npm start                  (first time: scan the QR from WhatsApp > Linked devices)
```
