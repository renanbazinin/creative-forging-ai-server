// server.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Load Gemini API key & model from .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GEMINI_API_KEY) {
  console.error('❌ No GEMINI_API_KEY in .env');
  process.exit(1);
}

// Enable CORS for all origins
app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send(`
Welcome to the Gemini Shape & Board API!

  POST /getBoard  →  Ask Gemini to place 1–3 new pixels and return the full 50×50 board  
  POST /predict   →  Ask Gemini to identify what the user is drawing
  `);
});

// POST /getBoard
// Accepts a 10×10 array of 0/1 and asks Gemini to place the next 1–3 blocks,
// then return ONLY the complete 10×10 JSON array (no fences, no extra text).
app.post('/getBoard', async (req, res) => {
  let board = req.body;
  // If client sends 51 rows, ignore the last row
  if (Array.isArray(board) && board.length === 51) {
    board = board.slice(0, 50);
  }
  if (
    !Array.isArray(board) ||
    board.length !== 50 ||
    board.some(r => !Array.isArray(r) || r.length !== 50 || r.some(c => c !== 0 && c !== 1))
  ) {
    return res.status(400).json({ error: 'Expect a 50×50 array of 0s and 1s.' });
  }

  const prompt = `
You are given a 50×50 JSON array called "board", where 1 means a pixel is drawn and 0 means empty. imagine this as incomplete drawing (mostly think of objects like houses, trees, animals, etc. but even letter are possible).; to to be creative and think what the user wants.
Think of what to do to progress the complete of the drawing; choose exactly 1–3 new pixels to continue the drawing, be creative and think what the user wants, and **return only** the updated 50×50 JSON array with those new pixels set to 1. No markdown, no explanation.
Board:
${JSON.stringify(board)}
  `.trim();

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const { data } = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY
        }
      }
    );
    // Gemini’s raw reply is in data.candidates[0].content.parts[0].text
    res.send(data.candidates[0].content.parts[0].text);
  } catch (err) {
    console.error('Gemini error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Gemini error', details: err.response?.data || err.message });
  }
});

// POST /predict
// Accepts the same 10×10 board and asks Gemini to identify the shape only.
// Returns a JSON object: { "shape": "<description>" }
app.post('/predict', async (req, res) => {
  const board = req.body;
  if (
    !Array.isArray(board) ||
    board.length !== 50 ||
    board.some(r => !Array.isArray(r) || r.length !== 50 || r.some(c => c !== 0 && c !== 1))
  ) {
    return res.status(400).json({ error: 'Expect a 50×50 array of 0s and 1s.' });
  }

  const prompt = `
You are given a 50×50 JSON array called "board", where 1 means a pixel is drawn and 0 means empty.  imagine this as drawing (mostly think of objects like houses, trees, animals, etc. but even letter are possible).
Look at this as a user's drawing; identify what the user is drawing in a few words, and **return only** this JSON object (no fences, no explanation):
{"draw":"<short description>"}
Board:
${JSON.stringify(board)}
  `.trim();

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const { data } = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY
        }
      }
    );
    res.send(data.candidates[0].content.parts[0].text);
  } catch (err) {
    console.error('Gemini error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Gemini error', details: err.response?.data || err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Listening on http://localhost:${port} using model ${GEMINI_MODEL}`);
});
