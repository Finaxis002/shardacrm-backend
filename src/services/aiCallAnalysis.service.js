import fs from "fs";
import path from "path";
import {
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import Groq from "groq-sdk";
import logger from "../utils/logger.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Gemini 2.0 Flash is free-tier friendly and supports audio input directly
const MODEL_NAME = "gemini-2.5-flash";
const FALLBACK_MODEL_NAME = "gemini-2.5-flash-lite";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Files under this size are sent inline (base64). Bigger files use the
// File API (upload once, reference by URI) — needed since multer allows
// recordings up to 100MB.
const INLINE_SIZE_LIMIT = 15 * 1024 * 1024; // 15MB

const ANALYSIS_PROMPT = `
You are an expert sales call analyst for a CRM system used by a financial services / CA firm in India.
Listen to the audio carefully and respond with ONLY a valid JSON object
(no markdown, no code fences, no extra text) in exactly this shape:

{
  "transcript": "Full verbatim transcript, speaker-labelled as Agent: and Customer: where possible",
  "summary": "A detailed 4-6 sentence summary covering: what the customer needs, what the agent offered, key discussion points, and how the call ended. Be specific — mention actual products, amounts, or services discussed if any.",
  "intent": "One clear phrase describing the customer's intent AND interest level, e.g. 'Interested in home loan, requested callback' or 'Not interested, already has CA' or 'Warm lead, asked for GST filing details'",
  "redFlags": [
    "Specific concern or warning sign observed in the call, e.g. 'Customer mentioned competitor pricing', 'Customer seemed rushed or distracted'"
  ],
  "objections": [
    "Specific objection raised by customer, e.g. 'Price too high', 'Already using another CA firm', 'Not the decision maker'"
  ],
  "nextSteps": [
    "Concrete follow-up action for the agent, e.g. 'Send product brochure on WhatsApp', 'Schedule callback for Thursday', 'Share GST filing fee structure'"
  ]
}

Rules:
- Be specific and actionable — generic phrases like "follow up with customer" are NOT acceptable
- If names, amounts, or services are mentioned in the call, include them
- If the audio is in Hindi or Hinglish, still respond in English
- If audio is silent or inaudible, return valid JSON with empty arrays and explain in summary
- Never omit any keys from the JSON
`;

const getMimeType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".mp3": "audio/mp3",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".3gp": "audio/3gpp",
  };
  return map[ext] || "audio/mp4";
};

const extractJson = (text) => {
  // Gemini sometimes wraps JSON in ```json fences despite instructions
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in AI response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateWithRetry = async (audioPart, modelName, attempt = 1) => {
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([ANALYSIS_PROMPT, audioPart]);
    return result.response.text();
  } catch (err) {
    const isOverloaded =
  err?.status === 503 ||
  err?.status === 429 ||
  /overloaded|high demand|quota|too many requests/i.test(
    err?.message || ""
  );

    if (isOverloaded && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * attempt;
      logger.warn(`Model ${modelName} overloaded, retrying in ${delay}ms (attempt ${attempt})`);
      await sleep(delay);
      return generateWithRetry(audioPart, modelName, attempt + 1);
    }

    if (isOverloaded && modelName !== FALLBACK_MODEL_NAME) {
      logger.warn(`Switching to fallback model ${FALLBACK_MODEL_NAME}`);
      return generateWithRetry(audioPart, FALLBACK_MODEL_NAME, 1);
    }

    throw err;
  }
};

/**
 * Sends an audio file to Gemini and returns structured call analysis.
 * @param {string} filePath - absolute path to the audio file on disk
 * @returns {Promise<{transcript:string, summary:string, intent:string, redFlags:string[], objections:string[], nextSteps:string[]}>}
 */
export const analyzeCallRecording = async (filePath) => {
  const stats = fs.statSync(filePath);
  const mimeType = getMimeType(filePath);

  let audioPart;

  if (stats.size <= INLINE_SIZE_LIMIT) {
    const base64Data = fs.readFileSync(filePath, { encoding: "base64" });
    audioPart = {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    };
  } else {
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType,
      displayName: path.basename(filePath),
    });
    audioPart = {
      fileData: {
        fileUri: uploadResult.file.uri,
        mimeType,
      },
    };
  }

try {
  const responseText = await generateWithRetry(audioPart, MODEL_NAME);

  const parsed = extractJson(responseText);

  return {
    transcript: parsed.transcript || "",
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  };

} catch (err) {
  logger.warn(`Gemini failed: ${err.message}`);
  logger.warn("Switching to Groq fallback...");

  return await analyzeWithGroqFallback(filePath);
}
};

export const analyzeWithGroqFallback = async (filePath) => {
  logger.warn(`Groq fallback triggered for: ${filePath}`);

  // Step 1: Whisper se transcript banao
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-large-v3",
    response_format: "text",
  });

  const transcript = String(transcription || "").trim();

  if (!transcript) {
    return {
      transcript: "",
      summary: "Audio was silent or inaudible.",
      intent: "Unknown",
      redFlags: [],
      objections: [],
      nextSteps: [],
    };
  }

  // Step 2: LLaMA se analysis karo
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "user",
        content: `You are an expert sales call analyst for a CRM system used by a financial services / CA firm in India.
Analyze the following call transcript and respond with ONLY a valid JSON object (no markdown, no code fences) in exactly this shape:
{
  "summary": "A detailed 4-6 sentence summary covering: what the customer needs, what the agent offered, key discussion points, and how the call ended. Be specific — mention actual products, amounts, or services discussed if any.",
  "intent": "One clear phrase describing the customer's intent AND interest level, e.g. 'Interested in home loan, requested callback' or 'Not interested, already has CA'",
  "redFlags": [
    "Specific concern or warning sign, e.g. 'Customer mentioned competitor', 'Customer seemed unsure about pricing'"
  ],
  "objections": [
    "Specific objection raised, e.g. 'Price too high', 'Already using another firm', 'Not the decision maker'"
  ],
  "nextSteps": [
    "Concrete follow-up action, e.g. 'Send fee structure on WhatsApp', 'Schedule callback for Thursday', 'Share GST filing details'"
  ]
}

Rules:
- Be specific — generic phrases like "follow up with customer" are NOT acceptable
- If names, amounts, or services are mentioned, include them
- If transcript is in Hindi or Hinglish, still respond in English
- Never omit any keys

Transcript:
${transcript}`,
      },
    ],
    temperature: 0.3,
  });

  const responseText = completion.choices[0]?.message?.content || "";

  let parsed;
  try {
    parsed = extractJson(responseText);
  } catch (err) {
    logger.error("Failed to parse Groq response as JSON", { error: err.message });
    throw err;
  }

  return {
    transcript,
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  };
};