const {
  passport,
  googleEnabled,
  microsoftEnabled,
} = require("../config/passport");
const { User } = require("../models");
const { createToken } = require("../utils/createToken");
const { google } = require("googleapis");
const {
  classifySubscriptionEmailsWithAI,
} = require("../utils/subscriptionClassifier");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

function sendMappedError(res, error, fallbackMessage) {
  const message = error?.message || fallbackMessage || "Request failed";
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("mailbox is either inactive") ||
    lowerMessage.includes("soft-deleted") ||
    lowerMessage.includes("hosted on-premise")
  ) {
    return res.status(400).json({
      message:
        "This Microsoft account does not have an active Exchange Online mailbox. Please use an account with a licensed Exchange Online mailbox or ask your Microsoft 365 admin to activate mailbox access.",
    });
  }

  if (
    lowerMessage.includes("admin approval") ||
    lowerMessage.includes("consent_required") ||
    lowerMessage.includes("need admin approval")
  ) {
    return res.status(403).json({
      message:
        "Tenant admin approval is required for Microsoft mail access. Ask your Microsoft 365 admin to grant tenant-wide consent for this app.",
    });
  }

  if (
    error?.statusCode === 401 ||
    error?.statusCode === 403 ||
    lowerMessage.includes("invalid_grant") ||
    lowerMessage.includes("invalid authentication token") ||
    lowerMessage.includes("invalid credentials") ||
    lowerMessage.includes("login required") ||
    lowerMessage.includes("token")
  ) {
    return res.status(401).json({
      message:
        "Mail access permission is missing or expired. Please login again and approve access.",
    });
  }

  if (
    error?.statusCode === 429 ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("quota")
  ) {
    return res.status(429).json({
      message: "Rate limit reached while reading mails. Please try again shortly.",
    });
  }

  if (
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("etimedout")
  ) {
    return res.status(503).json({
      message: "Mail provider is temporarily unreachable. Please try again in a moment.",
    });
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      message: "A user with this account already exists.",
    });
  }

  return res.status(500).json({
    message: fallbackMessage || "Internal server error",
    error: message,
  });
}

function googleAuth(req, res, next) {
  if (!googleEnabled) {
    return res.status(503).json({
      message:
        "Google login is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
  }

  return passport.authenticate("google", {
    scope: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    accessType: "offline",
    prompt: "consent",
    includeGrantedScopes: true,
    session: false,
  })(req, res, next);
}

function googleCallback(req, res, next) {
  if (!googleEnabled) {
    return res.redirect(`${FRONTEND_URL}/login`);
  }

  return passport.authenticate("google", {
    session: false,
    failureRedirect: `${FRONTEND_URL}/login`,
  })(req, res, next);
}

async function googleCallbackSuccess(req, res) {
  try {
    const { email, name, googleId, accessToken, refreshToken } = req.user;

    let user = await User.findOne({ where: { google_id: googleId } });
    if (!user) {
      user = await User.findOne({ where: { email } });

      if (user) {
        user.google_id = googleId;
        await user.save();
      } else {
        user = await User.create({
          name,
          email,
          google_id: googleId,
        });
      }
    }

    user.google_access_token = accessToken || user.google_access_token;
    user.auth_provider = "google";
    if (refreshToken) {
      user.google_refresh_token = refreshToken;
    }

    await user.save();

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      provider: user.auth_provider || "google",
    };
    const token = createToken(publicUser);
    const redirectUrl = `${FRONTEND_URL}/oauth-success?token=${encodeURIComponent(token)}`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("googleCallbackSuccess error:", error);
    return res.redirect(`${FRONTEND_URL}/login`);
  }
}

function microsoftAuth(req, res, next) {
  if (!microsoftEnabled) {
    return res.status(503).json({
      message:
        "Microsoft login is not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.",
    });
  }

  return passport.authenticate("microsoft", {
    session: false,
    prompt: "select_account",
  })(req, res, next);
}

function microsoftCallback(req, res, next) {
  if (!microsoftEnabled) {
    return res.redirect(`${FRONTEND_URL}/login`);
  }

  return passport.authenticate("microsoft", {
    session: false,
    failureRedirect: `${FRONTEND_URL}/login`,
  })(req, res, next);
}

async function microsoftCallbackSuccess(req, res) {
  try {
    const { email, name, microsoftId, accessToken, refreshToken } = req.user;

    let user = await User.findOne({ where: { microsoft_id: microsoftId } });
    if (!user) {
      user = await User.findOne({ where: { email } });

      if (user) {
        user.microsoft_id = microsoftId;
        await user.save();
      } else {
        user = await User.create({
          name,
          email,
          microsoft_id: microsoftId,
        });
      }
    }

    user.microsoft_access_token = accessToken || user.microsoft_access_token;
    user.auth_provider = "microsoft";
    if (refreshToken) {
      user.microsoft_refresh_token = refreshToken;
    }
    await user.save();

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      provider: user.auth_provider || "microsoft",
    };
    const token = createToken(publicUser);
    const redirectUrl = `${FRONTEND_URL}/oauth-success?token=${encodeURIComponent(token)}`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("microsoftCallbackSuccess error:", error);
    return res.redirect(`${FRONTEND_URL}/login`);
  }
}

async function me(req, res) {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "name",
        "email",
        "auth_provider",
        "google_access_token",
        "microsoft_access_token",
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const provider =
      user.auth_provider ||
      (user.microsoft_access_token
        ? "microsoft"
        : user.google_access_token
          ? "google"
          : null);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        provider,
      },
    });
  } catch (error) {
    console.error("me error:", error);
    return sendMappedError(res, error, "Could not fetch user");
  }
}

async function getAuthorizedGmailClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL,
  );

  oauth2Client.setCredentials({
    access_token: user.google_access_token || undefined,
    refresh_token: user.google_refresh_token || undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) user.google_access_token = tokens.access_token;
    if (tokens.refresh_token) user.google_refresh_token = tokens.refresh_token;
    if (tokens.expiry_date)
      user.google_token_expiry = new Date(tokens.expiry_date);
    await user.save();
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function fetchEmailMetadata(gmail, max = 10, filter = "bills") {
  const gmailQueryByFilter = {
    bills:
      "in:inbox (subject:invoice OR subject:bill OR subject:receipt OR invoice OR bill OR receipt OR payment OR due)",
    subscription:
      "in:inbox (subscription OR renew OR renewal OR recurring OR invoice OR bill OR payment OR trial)",
    all: "in:inbox",
  };

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults: max,
    q: gmailQueryByFilter[filter] || gmailQueryByFilter.bills,
  });

  const ids = (listRes.data.messages || []).map((m) => m.id);

  const details = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      }),
    ),
  );

  return details.map((item) => {
    const headers = item.data.payload?.headers || [];
    const getHeader = (headerName) =>
      headers.find((h) => h.name?.toLowerCase() === headerName.toLowerCase())
        ?.value || "";

    return {
      id: item.data.id,
      threadId: item.data.threadId,
      snippet: item.data.snippet || "",
      from: getHeader("From"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
    };
  });
}

async function getMyEmails(req, res) {
  try {
    const max = Number(req.query.max || 10);
    const filter = String(req.query.filter || "bills").toLowerCase();

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.google_refresh_token && !user.google_access_token) {
      return res
        .status(400)
        .json({ message: "Google account not connected with Gmail scope" });
    }

    const gmail = await getAuthorizedGmailClient(user);
    const emails = await fetchEmailMetadata(gmail, max, filter);

    const billKeywords = [
      "invoice",
      "bill",
      "receipt",
      "payment",
      "amount due",
      "due date",
      "tax invoice",
      "statement",
      "order total",
    ];

    const filteredEmails =
      filter === "bills"
        ? emails.filter((mail) => {
            const haystack =
              `${mail.subject} ${mail.snippet} ${mail.from}`.toLowerCase();
            return billKeywords.some((keyword) => haystack.includes(keyword));
          })
        : emails;

    return res.json({ emails: filteredEmails });
  } catch (error) {
    console.error("getMyEmails error:", error);
    return sendMappedError(res, error, "Failed to fetch Gmail messages");
  }
}

async function getSubscriptionEmails(req, res) {
  try {
    const max = Number(req.query.max || 40);

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.google_refresh_token && !user.google_access_token) {
      return res
        .status(400)
        .json({ message: "Google account not connected with Gmail scope" });
    }

    const gmail = await getAuthorizedGmailClient(user);
    const emails = await fetchEmailMetadata(gmail, max, "subscription");

    const result = await classifySubscriptionEmailsWithAI(emails);

    return res.json({
      source_count: emails.length,
      subscriptions: result.subscriptions,
      summary: result.summary,
      ai_used: result.ai_used,
      model_used: result.model_used,
      warning: result.warning || null,
    });
  } catch (error) {
    console.error("getSubscriptionEmails error:", error);
    return sendMappedError(res, error, "Failed to fetch subscription emails");
  }
}

async function fetchMicrosoftEmailMetadata(accessToken, max = 40) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$top=${max}&$select=id,subject,from,receivedDateTime,bodyPreview`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const graphMessage = payload.error?.message || "Failed to fetch Microsoft emails";
    const error = new Error(graphMessage);
    error.statusCode = response.status;
    throw error;
  }

  const rows = payload.value || [];
  return rows.map((mail) => ({
    id: mail.id,
    threadId: mail.conversationId || mail.id,
    snippet: mail.bodyPreview || "",
    from: mail.from?.emailAddress?.address || "",
    subject: mail.subject || "",
    date: mail.receivedDateTime || "",
  }));
}

async function getMicrosoftSubscriptionEmails(req, res) {
  try {
    const max = Number(req.query.max || 40);

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.microsoft_access_token) {
      return res.status(400).json({
        message: "Microsoft account not connected with Mail.Read scope",
      });
    }

    const emails = await fetchMicrosoftEmailMetadata(
      user.microsoft_access_token,
      max,
    );

    // console.log("emails", emails);
    const result = await classifySubscriptionEmailsWithAI(emails);

    return res.json({
      source_count: emails.length,
      subscriptions: result.subscriptions,
      summary: result.summary,
      ai_used: result.ai_used,
      model_used: result.model_used,
      warning: result.warning || null,
    });
  } catch (error) {
    console.error("getMicrosoftSubscriptionEmails error:", error);
    return sendMappedError(
      res,
      error,
      "Failed to fetch Microsoft subscription emails",
    );
  }
}

module.exports = {
  googleAuth,
  googleCallback,
  googleCallbackSuccess,
  microsoftAuth,
  microsoftCallback,
  microsoftCallbackSuccess,
  getMyEmails,
  getSubscriptionEmails,
  getMicrosoftSubscriptionEmails,
  me,
};
