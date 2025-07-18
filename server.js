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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

if (!GEMINI_API_KEY) {
  console.error('❌ No GEMINI_API_KEY in .env');
  process.exit(1);
}

app.use(cors());
app.use(bodyParser.json());

// --- Game Constants ---
const BOARD_SIZE = 10;
const BLOCK_COUNT = 10;

// --- Game Logic Helper Functions ---

/**
 * Checks if a coordinate is within the board boundaries.
 */
const isValidCoord = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

/**
 * Finds all blocks (cells with value 1) on the board.
 */
const findBlocks = (board) => {
  const blocks = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 1) {
        blocks.push({ r, c });
      }
    }
  }
  return blocks;
};

/**
 * Counts connected blocks from a starting point using BFS.
 */
const countConnectedBlocks = (board, startNode) => {
  if (!startNode) return 0;
  const queue = [startNode];
  const visited = new Set([`${startNode.r},${startNode.c}`]);
  let count = 0;

  while (queue.length > 0) {
    const { r, c } = queue.shift();
    count++;
    const neighbors = [{ r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }];

    for (const neighbor of neighbors) {
      const key = `${neighbor.r},${neighbor.c}`;
      if (isValidCoord(neighbor.r, neighbor.c) && board[neighbor.r][neighbor.c] === 1 && !visited.has(key)) {
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }
  return count;
};

/**
 * Checks if the board is valid: 10x10, 10 blocks, one contiguous shape.
 */
const validateBoard = (board) => {
  if (!Array.isArray(board) || board.length !== BOARD_SIZE || board.some(r => !Array.isArray(r) || r.length !== BOARD_SIZE)) {
    return 'Board must be a 10x10 array.';
  }
  const blocks = findBlocks(board);
  if (blocks.length !== BLOCK_COUNT) {
    return `Board must have exactly ${BLOCK_COUNT} blocks.`;
  }
  if (countConnectedBlocks(board, blocks[0]) !== BLOCK_COUNT) {
    return 'All blocks must form a single, continuous shape.';
  }
  return null; // Board is valid
};

/**
 * Finds all possible valid moves for the current board state.
 */
const findAllValidMoves = (board) => {
  const blocks = findBlocks(board);
  const allMoves = [];

  for (const block of blocks) {
    // Create a temporary board without the current block
    const tempBoard = board.map(row => [...row]);
    tempBoard[block.r][block.c] = 0;
    const remainingBlocks = findBlocks(tempBoard);

    // Check for connectivity (is it a bridge?)
    if (countConnectedBlocks(tempBoard, remainingBlocks[0]) === remainingBlocks.length) {
      // If not a bridge, find valid destinations
      const validDestinations = new Set();
      for (const otherBlock of remainingBlocks) {
        const neighbors = [{ r: otherBlock.r - 1, c: otherBlock.c }, { r: otherBlock.r + 1, c: otherBlock.c }, { r: otherBlock.r, c: otherBlock.c - 1 }, { r: otherBlock.r, c: otherBlock.c + 1 }];
        for (const neighbor of neighbors) {
          if (isValidCoord(neighbor.r, neighbor.c) && tempBoard[neighbor.r][neighbor.c] === 0) {
            validDestinations.add(`${neighbor.r},${neighbor.c}`);
          }
        }
      }
      if (validDestinations.size > 0) {
        allMoves.push({
          from: block,
          to: Array.from(validDestinations).map(s => ({ r: parseInt(s.split(',')[0]), c: parseInt(s.split(',')[1]) })),
        });
      }
    }
  }
  return allMoves;
};

// --- API Endpoints ---

app.get('/', (req, res) => {
  res.send(`
Welcome to the Creative Block Mover API!

POST /getBoard  →  Provide a 10x10 board, and the AI will make a creative move.
POST /predict   →  The AI will identify the shape on the board.
  `);
});

// POST /getBoard
// Receives a board, finds all valid moves, asks Gemini to pick one,
// and returns the new board state.
app.post('/getBoard', async (req, res) => {
  const { board, debug, context: userContext } = req.body;
  const validationError = validateBoard(board);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const possibleMoves = findAllValidMoves(board);
  if (possibleMoves.length === 0) {
    return res.status(400).json({ error: 'No valid moves available on the provided board.' });
  }

  // Create ASCII visualization of the board for prompt
  const visualRows = board.map(row => row.map(cell => (cell === 1 ? '#' : ' ')).join(''));

  let prompt = `
You are an AI playing a creative block-moving game on a 10x10 board. Your goal is to make the current drawing more interesting and recognizable by moving the blocks.

**GAME RULES - YOU MUST FOLLOW THESE:**
1.  **Block Count:** The final board MUST contain EXACTLY 10 blocks (represented by \`1\`). Not 9, not 11, but 10.
2.  **Connectivity:** All 10 blocks MUST form a single, continuous shape. Blocks connect ONLY up, down, left, or right. **DIAGONAL CONNECTIONS ARE FORBIDDEN.** No separate islands or disconnected blocks are allowed.
3.  **Valid Moves:** Each move must be valid. A block can only move to an empty space adjacent to the main shape. You cannot move a block if doing so would split the shape into two pieces.

**Your Task:**
1.  Analyze the current board.
2.  Plan a sequence of 1 to 2 valid moves to improve the drawing.
3.  Form your top 3 predictions for what the final drawing represents.

**Constraint Checklist (Your response MUST satisfy these):**
- Does the "board" have exactly 10 blocks? [ ]
- Do all 10 blocks form a single connected shape (NO DIAGONALS, NO ISLANDS)? [ ]
- Is the "predict" value an array of 3 strings? [ ]

**Return ONLY a single JSON object with the final state (no markdown fences or explanations):**
{
  "predict": ["<your best prediction>", "<your second best>", "<your third best>"],
  "board": [[...the final 10x10 board after your 1-2 moves...]]
}

Current Board:
${JSON.stringify(board)}

Possible First Moves (for your reference):
${JSON.stringify(possibleMoves, null, 2)}

**Board Visualization:**
rows = ${JSON.stringify(visualRows, null, 2)}
  `.trim();
  // If debug mode is enabled, include additional user-provided context
  if (debug) {
    prompt += `

**ADDITIONAL USER CONTEXT, very big clue... consider what the user wants.. try to complete his shape he asking**
 User: ${userContext}`;
  }

  console.log("--- Final Prompt Sent to Gemini ---");
  console.log(prompt);
  console.log("----------------------------------");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const { data } = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY } }
    );

    const responseText = data.candidates[0].content.parts[0].text;
    console.log("--- Raw AI Response Text ---");
    console.log(responseText);
    console.log("----------------------------");

    // Clean the response to remove markdown fences
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log("--- Cleaned AI Response for JSON Parsing ---");
    console.log(cleanedText);
    console.log("------------------------------------------");

    const aiResponse = JSON.parse(cleanedText);

    const { predict, board: newBoard } = aiResponse;

    // Validate the board returned by the AI
    const finalValidationError = validateBoard(newBoard);
    if (finalValidationError) {
      console.error('AI returned an invalid board:', finalValidationError);
      return res.status(500).json({ error: 'AI returned an invalid board state.', details: finalValidationError });
    }

    res.json({ board: newBoard, predict });

  } catch (err) {
    console.error('Gemini error or JSON parsing error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error processing AI response.', details: err.response?.data || err.message });
  }
});

// POST /predict
// Receives a board and asks Gemini to identify the shape.
app.post('/predict', async (req, res) => {
  const { board } = req.body;
  const validationError = validateBoard(board);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const prompt = `
You are given a 10x10 JSON array called "board" with 10 blocks forming a shape.
In a few words, what does this shape look like? Be creative.
Return ONLY a JSON object like this: {"shape": "<your description>"}

Board:
${JSON.stringify(board)}
  `.trim();

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const { data } = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY } }
    );

    res.send(data.candidates[0].content.parts[0].text);
  } catch (err) {
    console.error('Gemini error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Gemini error', details: err.response?.data || err.message });
  }


  
});






app.post('/getBoard', async (req, res) => {
  const { board, debug, context: userContext } = req.body;
  const validationError = validateBoard(board);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const possibleMoves = findAllValidMoves(board);
  if (possibleMoves.length === 0) {
    return res.status(400).json({ error: 'No valid moves available on the provided board.' });
  }

  // Create ASCII visualization of the board for prompt
  const visualRows = board.map(row => row.map(cell => (cell === 1 ? '#' : ' ')).join(''));

  let prompt = `
You are an AI playing a creative block-moving game on a 10x10 board. Your goal is to make the current drawing more interesting and recognizable by moving the blocks.

**GAME RULES - YOU MUST FOLLOW THESE:**
1.  **Block Count:** The final board MUST contain EXACTLY 10 blocks (represented by \`1\`). Not 9, not 11, but 10.
2.  **Connectivity:** All 10 blocks MUST form a single, continuous shape. Blocks connect ONLY up, down, left, or right. **DIAGONAL CONNECTIONS ARE FORBIDDEN.** No separate islands or disconnected blocks are allowed.
3.  **Valid Moves:** Each move must be valid. A block can only move to an empty space adjacent to the main shape. You cannot move a block if doing so would split the shape into two pieces.

**Your Task:**
1.  Analyze the current board.
2.  Plan a sequence of 1 to 2 valid moves to improve the drawing.
3.  Form your top 3 predictions for what the final drawing represents.

**Constraint Checklist (Your response MUST satisfy these):**
- Does the "board" have exactly 10 blocks? [ ]
- Do all 10 blocks form a single connected shape (NO DIAGONALS, NO ISLANDS)? [ ]
- Is the "predict" value an array of 3 strings? [ ]

**Return ONLY a single JSON object with the final state (no markdown fences or explanations):**
{
  "predict": ["<your best prediction>", "<your second best>", "<your third best>"],
  "board": [[...the final 10x10 board after your 1-2 moves...]]
}

Current Board:
${JSON.stringify(board)}

Possible First Moves (for your reference):
${JSON.stringify(possibleMoves, null, 2)}

**Board Visualization:**
rows = ${JSON.stringify(visualRows, null, 2)}
  `.trim();
  // If debug mode is enabled, include additional user-provided context
  if (debug) {
    prompt += `

**ADDITIONAL USER CONTEXT:**
${userContext}`;
  }

  console.log("--- Final Prompt Sent to Gemini ---");
  console.log(prompt);
  console.log("----------------------------------");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const { data } = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY } }
    );

    const responseText = data.candidates[0].content.parts[0].text;
    console.log("--- Raw AI Response Text ---");
    console.log(responseText);
    console.log("----------------------------");

    // Clean the response to remove markdown fences
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log("--- Cleaned AI Response for JSON Parsing ---");
    console.log(cleanedText);
    console.log("------------------------------------------");

    const aiResponse = JSON.parse(cleanedText);

    const { predict, board: newBoard } = aiResponse;

    // Validate the board returned by the AI
    const finalValidationError = validateBoard(newBoard);
    if (finalValidationError) {
      console.error('AI returned an invalid board:', finalValidationError);
      return res.status(500).json({ error: 'AI returned an invalid board state.', details: finalValidationError });
    }

    res.json({ board: newBoard, predict });

  } catch (err) {
    console.error('Gemini error or JSON parsing error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error processing AI response.', details: err.response?.data || err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});





