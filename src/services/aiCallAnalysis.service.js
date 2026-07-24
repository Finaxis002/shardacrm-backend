import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import Groq from "groq-sdk";
import logger from "../utils/logger.js";

const INLINE_SIZE_LIMIT = 15 * 1024 * 1024;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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

const GROQ_FALLBACK_PROMPT =
  "You are an expert sales call analyst for a CRM system used by a financial services / CA firm in India. Analyze the following transcript and return ONLY a valid JSON object (no markdown) with keys: summary, intent, redFlags, objections, nextSteps. Be specific. If Hindi/Hinglish, respond in English.";

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
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("No JSON object found in AI response");
  return JSON.parse(cleaned.slice(start, end + 1));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- PROVIDER CONFIG: Interleaved User -> Org -> Env (Gemini then Groq at each level) ---
const getAiConfigForUser = async (userId, orgId) => {
  const User = (await import("../models/User.model.js")).default;
  const Settings = (await import("../models/Settings.model.js")).default;

  const [user, settings] = await Promise.all([
    User.findById(userId).select("+ai.gemini.key +ai.groq.key").lean(),
    Settings.findOne({ organization: orgId })
      .select("+ai.gemini.key +ai.groq.key")
      .lean(),
  ]);

  const providers = [];

  const levels = {
    user: {
      gemini: {
        key: user?.ai?.gemini?.key,
        model: user?.ai?.gemini?.model || "gemini-2.5-flash",
      },
      groq: {
        key: user?.ai?.groq?.key,
        model: user?.ai?.groq?.model || "whisper-large-v3",
      },
    },
    org: {
      gemini: {
        key: settings?.ai?.gemini?.enabled ? settings?.ai?.gemini?.key : null,
        model: settings?.ai?.gemini?.model || "gemini-2.5-flash",
      },
      groq: {
        key: settings?.ai?.groq?.enabled ? settings?.ai?.groq?.key : null,
        model: settings?.ai?.groq?.model || "whisper-large-v3",
      },
    },
    env: {
      gemini: { key: process.env.GEMINI_API_KEY, model: "gemini-2.5-flash" },
      groq: { key: process.env.GROQ_API_KEY, model: "whisper-large-v3" },
    },
  };

  for (const level of ["user", "org", "env"]) {
    const cap = level.charAt(0).toUpperCase() + level.slice(1);
    const gk = levels[level];

    if (gk.gemini.key) {
      providers.push({
        name: "gemini",
        label: "Gemini (" + cap + ")",
        key: gk.gemini.key,
        model: gk.gemini.model,
        fallbackModel: "gemini-2.5-flash-lite",
      });
    }
    if (gk.groq.key) {
      providers.push({
        name: "groq",
        label: "Groq (" + cap + ")",
        key: gk.groq.key,
        whisperModel: gk.groq.model,
        llamaModel: "llama-3.3-70b-versatile",
      });
    }
  }

  return {
    providers,
    autoAnalyse: settings?.ai?.autoAnalyse || false,
    prompt: settings?.ai?.prompt || "",
  };
};

// --- GEMINI ANALYZER ---
const generateWithRetry = async (
  audioPart,
  modelName,
  genAI,
  attempt = 1,
  provider = null,
) => {
  const FALLBACK = "gemini-2.5-flash-lite";

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt =
      provider && provider.customPrompt
        ? ANALYSIS_PROMPT +
          "\n\nAdditional custom instructions from admin:\n" +
          provider.customPrompt
        : ANALYSIS_PROMPT;
    const result = await model.generateContent([prompt, audioPart]);
    return result.response.text();
  } catch (err) {
    const isOverloaded =
      err?.status === 503 ||
      err?.status === 429 ||
      /overloaded|high demand|quota|too many requests/i.test(
        err?.message || "",
      );

    if (isOverloaded && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * attempt;
      logger.warn(
        "Model " +
          modelName +
          " overloaded, retrying in " +
          delay +
          "ms (attempt " +
          attempt +
          ")",
      );
      await sleep(delay);
      return generateWithRetry(
        audioPart,
        modelName,
        genAI,
        attempt + 1,
        provider,
      );
    }

    if (isOverloaded && modelName !== FALLBACK) {
      logger.warn("Switching to fallback model " + FALLBACK);
      return generateWithRetry(audioPart, FALLBACK, genAI, 1, provider);
    }

    throw err;
  }
};

const analyzeWithGemini = async (filePath, provider) => {
  const genAI = new GoogleGenerativeAI(provider.key);
  const fileManager = new GoogleAIFileManager(provider.key);
  const stats = fs.statSync(filePath);
  const mimeType = getMimeType(filePath);

  let audioPart;
  if (stats.size <= INLINE_SIZE_LIMIT) {
    const base64Data = fs.readFileSync(filePath, { encoding: "base64" });
    audioPart = { inlineData: { data: base64Data, mimeType } };
  } else {
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType,
      displayName: path.basename(filePath),
    });
    audioPart = { fileData: { fileUri: uploadResult.file.uri, mimeType } };
  }

  const responseText = await generateWithRetry(
    audioPart,
    provider.model,
    genAI,
    1,
    provider,
  );
  const parsed = extractJson(responseText);

  return {
    transcript: parsed.transcript || "",
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    provider: provider.label,
  };
};

// --- GROQ ANALYZER ---
const analyzeWithGroq = async (filePath, provider) => {
  const groq = new Groq({ apiKey: provider.key });
  logger.info("Groq Whisper transcription using " + provider.label);

  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: provider.whisperModel,
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
      provider: provider.label,
    };
  }

  const groqContent = provider.customPrompt
    ? GROQ_FALLBACK_PROMPT +
      "\n\nAdditional custom instructions:\n" +
      provider.customPrompt +
      "\n\nTranscript:\n" +
      transcript
    : GROQ_FALLBACK_PROMPT + "\n\nTranscript:\n" + transcript;

  const completion = await groq.chat.completions.create({
    model: provider.llamaModel,
    messages: [{ role: "user", content: groqContent }],
    temperature: 0.3,
  });

  const responseText = completion.choices[0]?.message?.content || "";

  let parsed;
  try {
    parsed = extractJson(responseText);
  } catch (err) {
    logger.error("Failed to parse Groq response as JSON", {
      error: err.message,
    });
    throw err;
  }

  return {
    transcript,
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    provider: provider.label,
  };
};

// --- MAIN ---
export const analyzeCallRecording = async (filePath, userId, orgId) => {
  const config = await getAiConfigForUser(userId, orgId);

  if (!config.providers.length) {
    throw new Error(
      "No AI provider configured. Please set up Gemini or Groq API keys in Admin Panel.",
    );
  }

  logger.info(
    "AI analysis starting for " +
      path.basename(filePath) +
      " | " +
      config.providers.length +
      " provider(s): " +
      config.providers
        .map(function (p) {
          return p.label;
        })
        .join(", "),
  );

  let lastError = null;

  for (var i = 0; i < config.providers.length; i++) {
    var provider = config.providers[i];
    try {
      logger.info("Trying " + provider.label + "...");

      if (config.prompt && config.prompt.trim().length > 0) {
        provider.customPrompt = config.prompt;
      }

      var result;
      if (provider.name === "gemini") {
        result = await analyzeWithGemini(filePath, provider);
      } else if (provider.name === "groq") {
        result = await analyzeWithGroq(filePath, provider);
      }

      if (result) {
        logger.info("OK via " + result.provider);
        return result;
      }
    } catch (err) {
      lastError = err;
      logger.warn("FAIL " + provider.label + ": " + err.message);
      continue;
    }
  }

  throw (
    lastError || new Error("All AI providers failed to analyze the recording")
  );
};

// --- LEGACY ---
export const analyzeCallRecordingLegacy = async (filePath) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const MODEL_NAME = "gemini-2.5-flash";
  const stats = fs.statSync(filePath);
  const mimeType = getMimeType(filePath);

  let audioPart;
  if (stats.size <= INLINE_SIZE_LIMIT) {
    const base64Data = fs.readFileSync(filePath, { encoding: "base64" });
    audioPart = { inlineData: { data: base64Data, mimeType } };
  } else {
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType,
      displayName: path.basename(filePath),
    });
    audioPart = { fileData: { fileUri: uploadResult.file.uri, mimeType } };
  }

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent([ANALYSIS_PROMPT, audioPart]);
    const parsed = extractJson(result.response.text());
    return {
      transcript: parsed.transcript || "",
      summary: parsed.summary || "",
      intent: parsed.intent || "",
      redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      provider: "Gemini (Legacy Env)",
    };
  } catch (err) {
    logger.warn("Gemini legacy failed: " + err.message + ", trying Groq...");
  }

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
      provider: "Groq (Legacy Env)",
    };
  }

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "user",
        content:
          "Analyze this sales call transcript...\n\nTranscript:\n" + transcript,
      },
    ],
    temperature: 0.3,
  });

  const parsed = extractJson(completion.choices[0]?.message?.content || "{}");
  return {
    transcript,
    summary: parsed.summary || "",
    intent: parsed.intent || "",
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    provider: "Groq (Legacy Env)",
  };
};
