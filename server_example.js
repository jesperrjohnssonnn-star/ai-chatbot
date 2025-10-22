// server.js
// Minimal Express-backend som vidarebefordrar frågor till din AI-leverantör.
// Fyll i din leverantörs SDK/HTTP-anrop i /api/chat.

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message saknas' });
  try {
    // TODO: Anropa din AI-leverantör här, t.ex. OpenAI, Anthropic eller annan.
    // const reply = await aiClient.generate({ prompt: message });
    const reply = 'Detta är en platshållare. Koppla backend till din AI-tjänst.';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Något gick fel' });
  }
});

app.listen(3000, () => console.log('Servern kör på http://localhost:3000'));
