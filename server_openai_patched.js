// server_openai_patched.js
// Robust för Windows + fallback utan OpenAI

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const DUMMY_MODE = String(process.env.DUMMY_MODE || '').toLowerCase() === 'true';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// --- CORS ---
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS: ' + origin));
  }
}));

// --- Rate limit ---
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

// --- Läs in knowledge_base ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_PATH = process.env.KB_PATH || path.join(__dirname, 'knowledge_base.csv');

console.log('Försöker läsa knowledge_base från:', KB_PATH);

let kbRows = [];
try {
  const raw = fs.readFileSync(KB_PATH, 'utf-8');
  kbRows = parse(raw, { columns: true, skip_empty_lines: true });
  console.log('Läste in knowledge_base.csv. Antal rader:', kbRows.length);
} catch (e) {
  console.warn('Kunde inte läsa knowledge_base.csv – fortsätter utan lokal kunskap.');
  console.warn('Detaljer:', e.message);
}

// --- Embeddings (för OpenAI-läge) ---
let kbEmbeddings = [];
async function buildKbEmbeddings() {
  if (!kbRows.length || DUMMY_MODE) return;
  const inputs = kbRows.map(r => `${r.question}\n${r.answer}`);
  const { data } = await openai.embeddings.create({
    input: inputs,
    model: EMBEDDING_MODEL,
  });
  kbEmbeddings = data.map((d, i) => ({ idx: i, vector: d.embedding }));
  console.log('Embeddings klara för KB:', kbEmbeddings.length);
}

// --- Hjälpfunktioner ---
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
  const embed = await openai.embeddings.create({ input: userMessage, model: EMBEDDING_MODEL });
  const q = embed.data[0].embedding;
  const scored = kbEmbeddings.map(e => ({ idx: e.idx, score: cosine(q, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  const snippets = scored.map(s => `Q: ${kbRows[s.idx].question}\nA: ${kbRows[s.idx].answer}`);
  return snippets.join('\n---\n');
}

function kbKeywordAnswer(userMessage) {
  if (!kbRows.length) return '';
  const q = String(userMessage || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const r of kbRows) {
    const hay = `${r.question} ${r.answer}`.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore > 0 ? best.answer : '';
}

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

// --- Leads (in-memory) ---
const leads = [];
app.post('/api/lead', (req, res) => {
  const { name, email, phone, company, need } = req.body || {};
  if (!email && !phone) return res.status(400).json({ error: 'Minst e-post eller telefon krävs' });
  const lead = { id: Date.now().toString(), name, email, phone, company, need };
  leads.push(lead);
  res.json({ ok: true, lead });
});

// --- Chat ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message saknas' });

    // Om dummy-läge -> använd CSV direkt
    if (DUMMY_MODE) {
      const kbReply = kbKeywordAnswer(message);
      return res.json({ reply: kbReply || 'Jag kan tyvärr inte svara på det just nu.' });
    }

    // Annars använd OpenAI
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
    console.warn('Fel i /api/chat:', err?.message || err);
    // Fallback till CSV om OpenAI faller
    const kbReply = kbKeywordAnswer(req.body.message);
    res.json({ reply: kbReply || 'Jag kan tyvärr inte svara just nu.' });
  }
});

// --- Health ---
app.get('/health', (req, res) => res.json({ ok: true, kbRows: kbRows.length }));

// --- Start ---
app.listen(PORT, async () => {
  console.log('Servern startar på port', PORT);
  try { await buildKbEmbeddings(); } catch (e) { console.warn('Kunde inte bygga embeddings:', e.message); }
});
