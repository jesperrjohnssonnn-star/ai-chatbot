# AI Chatbot Starter Pack (SV)
Detta paket hjälper dig att snabbt komma igång med en AI-chatt för företag.

## Innehåll
- knowledge_base.csv – FAQ/kunskapsbas
- system_prompt_sv.txt – systeminstruktioner för boten
- lead_form_fields.csv – vilka fält du vill samla in
- handoff_guide.txt – rutiner för mänsklig överlämning
- cold_email_sv.txt – mall för att sälja in tjänsten
- chat_widget.html – enkel chatt-widget att bädda in
- server_example.js – minimal backend (Node/Express) med platshållare
  
## Snabbstart (no/low-code)
1) Välj en chatbot-plattform (t.ex. Chatbase, Tidio, Botpress Cloud).
2) Ladda upp `knowledge_base.csv` som FAQ/Docs.
3) Klistra in innehållet från `system_prompt_sv.txt` i botens “System”/”Instructions”.
4) Ställ in lead-fälten enligt `lead_form_fields.csv` i plattformens formulär/automation.
5) Sätt upp handoff-regler enligt `handoff_guide.txt`.
6) Bädda in den script-snutt plattformen ger på kundens hemsida.

## Snabbstart (egen widget + backend)
1) Öppna `chat_widget.html` lokalt för front-end.
2) Implementera din AI-leverantör i `server_example.js` (chat-completions).
3) Kör servern: `node server_example.js` (kräver Node 18+). Uppdatera URL:en i `chat_widget.html`.
4) Lägg till kunskapsbaslogik (sök i `knowledge_base.csv` innan du frågar modellen).

## Tips
- Begränsa svar till <120 ord och erbjud alltid nästa steg (bokning, offert, demo).
- Logga alla konversationer anonymiserat för förbättringar och mät KPI: svarstid, andel lösta ärenden, lead-rate.
- Se till att följa GDPR: informera användaren om datalagring och syfte.
