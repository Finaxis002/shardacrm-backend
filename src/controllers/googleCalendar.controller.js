import { google } from "googleapis";
import Settings from "../models/Settings.model.js";
import ApiResponse from "../utils/apiResponse.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";
 
// ── Helpers ───────────────────────────────────────────────────────────────────
 
const makeOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
 
/**
 * Load tokens from DB, attach to client, and auto-persist refreshed tokens.
 * Throws ApiError(400) if the org has no saved tokens.
 */
const getAuthedClient = async (organization) => {
  const settings = await Settings.findOne({ organization });
  if (!settings?.gcalTokens?.access_token) {
    throw new ApiError(400, "Google Calendar is not connected for this organisation.");
  }
 
  const client = makeOAuth2Client();
  client.setCredentials({
    access_token:  settings.gcalTokens.access_token,
    refresh_token: settings.gcalTokens.refresh_token,
    expiry_date:   settings.gcalTokens.expiry_date,
    token_type:    settings.gcalTokens.token_type,
    scope:         settings.gcalTokens.scope,
  });
 
  // Persist new access_token automatically after silent refresh
  client.on("tokens", async (tokens) => {
    const patch = {
      "gcalTokens.access_token": tokens.access_token,
      "gcalTokens.expiry_date":  tokens.expiry_date,
    };
    if (tokens.refresh_token) {
      patch["gcalTokens.refresh_token"] = tokens.refresh_token;
    }
    await Settings.findOneAndUpdate({ organization }, { $set: patch });
    logger.info(`GCal tokens refreshed for org ${organization}`);
  });
 
  return client;
};
 
// ── Controllers ───────────────────────────────────────────────────────────────
 
/**
 * GET /api/v1/gcal/auth-url
 * Returns the Google OAuth consent-screen URL.
 * Frontend opens this URL (window.location.href = url).
 */
export const getAuthUrl = asyncHandler(async (req, res) => {
  const client = makeOAuth2Client();
  
  // Frontend se origin path mangwayein (e.g. /calendar ya /admin)
  const { origin } = req.query; 

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    // State mein ab origin path bhi bhej rahe hain
    state: JSON.stringify({
      organization: req.user.organization.toString(),
      userId: req.user._id.toString(),
      returnPath: origin || '/admin' // Ye line add karein
    }),
  });

  res.status(200).json(new ApiResponse(200, { url }, "Auth URL generated"));
});
 
/**
 * GET /api/v1/gcal/callback   (public — Google redirects here)
 * Exchanges the auth code for tokens and saves them, then redirects the
 * browser back to the admin panel.
 */
export const oauthCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
 
  if (error) {
    logger.warn(`Google OAuth error: ${error}`);
    return res.redirect(
      `${frontendUrl}/admin?gcal=error&msg=${encodeURIComponent(error)}&tab=integrations`,
    );
  }
 
 let organization, userId, returnPath;
  try {
    const parsedState = JSON.parse(state);
    organization = parsedState.organization;
    userId = parsedState.userId;
    returnPath = parsedState.returnPath || '/admin'; // State se path nikalein
  } catch {
    return res.redirect(`${frontendUrl}/admin?gcal=error&msg=invalid_state`);
  }
 
  try {
    const client = makeOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
 
    // Fetch the Google account e-mail so we can display it in the UI
    const oauth2    = google.oauth2({ version: "v2", auth: client });
    const { data }  = await oauth2.userinfo.get();
    const gcalUser  = data.email || "";
 
    await Settings.findOneAndUpdate(
      { organization },
      {
        gcalConnected: true,
        gcalUser,
        gcalTokens: {
          access_token:  tokens.access_token  || "",
          refresh_token: tokens.refresh_token || "",
          expiry_date:   tokens.expiry_date   || 0,
          token_type:    tokens.token_type    || "Bearer",
          scope:         tokens.scope         || "",
        },
      },
      { new: true },
    );
 
    logger.info(`Google Calendar connected for org ${organization} by user ${userId}`);
   res.redirect(`${frontendUrl}${returnPath}?gcal=success&tab=integrations`);
  } catch (err) {
    logger.error("GCal callback error:", err);
    res.redirect(`${frontendUrl}/admin?gcal=error&msg=token_exchange_failed&tab=integrations`);
  }
});
 
/**
 * POST /api/v1/gcal/disconnect
 * Revokes the token at Google and clears stored credentials.
 */
export const disconnectGcal = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const settings = await Settings.findOne({ organization });
 
  if (settings?.gcalTokens?.access_token) {
    try {
      const client = makeOAuth2Client();
      client.setCredentials({ access_token: settings.gcalTokens.access_token });
      await client.revokeCredentials();
    } catch (err) {
      // Revocation can fail if the token already expired — still disconnect locally
      logger.warn(`GCal token revocation failed (continuing): ${err.message}`);
    }
  }
 
  await Settings.findOneAndUpdate(
    { organization },
    {
      gcalConnected: false,
      gcalUser: "",
      gcalTokens: { access_token: "", refresh_token: "", expiry_date: 0, token_type: "", scope: "" },
    },
  );
 
  logger.info(`Google Calendar disconnected for org ${organization}`);
  res.status(200).json(new ApiResponse(200, {}, "Google Calendar disconnected"));
});
 
/**
 * GET /api/v1/gcal/status
 * Returns connection state (safe — no tokens exposed).
 */
export const getGcalStatus = asyncHandler(async (req, res) => {
  const settings = await Settings.findOne({ organization: req.user.organization });
  res.status(200).json(
    new ApiResponse(200, {
      connected: settings?.gcalConnected || false,
      user: settings?.gcalUser || null,
    }, "GCal status fetched"),
  );
});
 
/**
 * GET /api/v1/gcal/events
 * Lists the next 20 upcoming events from the connected calendar.
 */
export const listEvents = asyncHandler(async (req, res) => {
  const client   = await getAuthedClient(req.user.organization);
  const calendar = google.calendar({ version: "v3", auth: client });
 
  const { data } = await calendar.events.list({
    calendarId:   "primary",
    timeMin:      new Date().toISOString(),
    maxResults:   20,
    singleEvents: true,
    orderBy:      "startTime",
  });
 
  res.status(200).json(new ApiResponse(200, { events: data.items || [] }, "Events fetched"));
});
 
/**
 * POST /api/v1/gcal/events
 * Creates a calendar event. Body: { title, description?, startTime, endTime?, leadId? }
 */
export const createEvent = asyncHandler(async (req, res) => {
  const { title, description, startTime, endTime, leadId } = req.body;
 
  if (!title || !startTime) {
    throw new ApiError(400, "title and startTime are required");
  }
 
  const settings = await Settings.findOne({ organization: req.user.organization });
  const timezone  = settings?.timezone || "Asia/Kolkata";
 
  const client   = await getAuthedClient(req.user.organization);
  const calendar = google.calendar({ version: "v3", auth: client });
 
  const start = new Date(startTime);
  const end   = endTime
    ? new Date(endTime)
    : new Date(start.getTime() + 60 * 60 * 1000); // default: +1 h
 
  const eventBody = {
    summary:     title,
    description: description || "",
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end:   { dateTime: end.toISOString(),   timeZone: timezone },
    reminders: {
      useDefault: false,
      overrides:  [
        { method: "popup", minutes: 30 },
        { method: "email", minutes: 60 },
      ],
    },
    ...(leadId && { extendedProperties: { private: { leadId } } }),
  };
 
  const { data } = await calendar.events.insert({
    calendarId: "primary",
    resource:   eventBody,
  });
 
  logger.info(`GCal event created: ${data.id} for org ${req.user.organization}`);
  res.status(201).json(
    new ApiResponse(201, { eventId: data.id, eventLink: data.htmlLink }, "Event created"),
  );
});