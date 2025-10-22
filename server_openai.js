// server_openai.js
// Express-backend med OpenAI, enkel RAG mot CSV-kunskapsbas och grundläggande skydd.
// Kör: 1) npm i  2) kopiera .env.example -> .env  3) npm run dev

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import OpenAI from 'openai';

const app = express();

// --- Config ---
const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const COMPANY_NAME = process.env.COMPANY_NAME || '{{FÖRETAGSNAMN}}';
const BOOKING_URL = process.env.BOOKING_URL || '{{BOKNINGSLÄNK}}';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// CORS (låst till lista, annars * i dev)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS: ' + origin));
  }
}));

// Rate limit
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

// --- Ladda kunskapsbas ---
const KB_PATH = new URL('./knowledge_base.csv', import.meta.url).pathname;
let kbRows = [];
try {
  const raw = fs.readFileSync(KB_PATH, 'utf-8');
  kbRows = parse(raw, { columns: true, skip_empty_lines: true });
} catch (e) {
  console.warn('Kunde inte läsa knowledge_base.csv – fortsätter utan lokal kunskap.');
}

// Skapa embeddings för KB (vid uppstart). I produktion: cacha på disk.
let kbEmbeddings = [];
async function buildKbEmbeddings() {
  if (!kbRows.length) return;
  const inputs = kbRows.map(r => `${r.question}\n${r.answer}`);
  const { data } = await openai.embeddings.create({
    input: inputs,
    model: EMBEDDING_MODEL,
  });
  kbEmbeddings = data.map((d, i) => ({
    idx: i,
    vector: d.embedding,
  }));
  console.log('Embeddings klara för KB:', kbEmbeddings.length);
}

// Hjälpare: cosinus-sim
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function retrieveContext(userMessage, topK = 3) {
  if (!kbEmbeddings.length) return '';
  const embed = await openai.embeddings.create({
    input: userMessage,
    model: EMBEDDING_MODEL,
  });
  const q = embed.data[0].embedding;
  const scored = kbEmbeddings.map(e => ({
    idx: e.idx,
    score: cosine(q, e.vector)
  })).sort((a,b) => b.score - a.score).slice(0, topK);
  const snippets = scored.map(s => `Q: ${kbRows[s.idx].question}\nA: ${kbRows[s.idx].answer}`);
  return snippets.join('\n---\n');
}

// Systemprompt
function systemPrompt() {
  return `Du är en professionell svensk kundservice- och säljassistent för företaget ${COMPANY_NAME}.
Mål: svara korrekt, kortfattat och trevligt, samla leads, och erbjuda bokning när det passar.
Regler:
- Svara på svenska.
- Om du är osäker: fråga ett förtydligande eller erbjud mänsklig handoff.
- Använd alltid fakta från kontexten först. Om inget hittas: ge ett försiktigt svar och markera att du är osäker.
- För säljfrågor: erbjud nästa steg (t.ex. ‘Vill du boka en snabb demo?’) och länka bokningen: ${BOOKING_URL}.
- Samla lead-fält när relevant: namn, e-post, telefon, företagsnamn, behov (frivilligt). Bekräfta innan du sparar.
- Om användaren vill prata med människa: samla kontaktuppgifter och säg “Jag vidarebefordrar detta till en kollega direkt.”
- Håll svaren under 120 ord. Använd punktlistor vid behov.`;
}

// Enkel in-memory lead store (byt till databas i produktion)
const leads = [];
app.post('/api/lead', (req, res) => {
  const { name, email, phone, company, need } = req.body || {};
  if (!email && !phone) return res.status(400).json({ error: 'Minst e-post eller telefon krävs' });
  const lead = { id: Date.now().toString(), name, email, phone, company, need };
  leads.push(lead);
  res.json({ ok: true, lead });
});

// Chat-endpoint (icke-streaming för enkelhet)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message saknas' });

    const context = await retrieveContext(message, 3);

    const msgs = [
      { role: 'system', content: systemPrompt() },
      ...(context ? [{ role: 'system', content: `KONTEKST FRÅN KB:\n${context}` }] : []),
      ...(Array.isArray(history) ? history : []),
      { role: 'user', content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: msgs,
      temperature: 0.4,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || 'Jag är osäker, kan du omformulera?';
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Något gick fel' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, async () => {
  console.log('Servern startar på port', PORT);
  try { await buildKbEmbeddings(); } catch (e) { console.warn('Kunde inte bygga embeddings:', e.message); }
});
