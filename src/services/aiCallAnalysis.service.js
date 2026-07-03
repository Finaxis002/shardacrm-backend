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
You are analyzing a sales call recording for a CRM system.
Listen to the audio carefully and respond with ONLY a valid JSON object
(no markdown, no code fences, no extra text) in exactly this shape:

{
  "transcript": "Full transcript of the call, speaker-labelled if possible",
  "summary": "A concise 3-5 sentence summary of what was discussed",
  "intent": "One short phrase describing the customer's intent/interest level",
  "redFlags": ["short phrase", "short phrase"],
  "objections": ["short phrase", "short phrase"],
  "nextSteps": ["short actionable phrase", "short actionable phrase"]
}

If the audio is silent, inaudible, or not a real conversation, still return
valid JSON with empty/best-effort values instead of failing.
Keep arrays empty ([]) if nothing relevant was found — never omit the keys.
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
    const isOverloaded = err?.status === 503 || /overloaded|high demand/i.test(err?.message || "");

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

  const responseText = await generateWithRetry(audioPart, MODEL_NAME);

  let parsed;
  try {
    parsed = extractJson(responseText);
  } catch (err) {
    logger.error("Failed to parse Gemini response as JSON", {
      error: err.message,
      raw: responseText?.slice(0, 500),
    });
    throw err;
  }

return {
    transcript: parsed.transcript || "",
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  };
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
        content: `You are analyzing a sales call transcript for a CRM system.
Respond with ONLY a valid JSON object (no markdown, no code fences) in exactly this shape:
{
  "summary": "A concise 3-5 sentence summary",
  "intent": "One short phrase describing customer intent/interest level",
  "redFlags": ["short phrase"],
  "objections": ["short phrase"],
  "nextSteps": ["short actionable phrase"]
}

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