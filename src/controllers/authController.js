const bcrypt = require("bcryptjs");
const { passport, googleEnabled } = require("../config/passport");
const { User } = require("../models");
const { createToken } = require("../utils/token");
const { google } = require("googleapis");
const { classifySubscriptionEmailsWithAI } = require("../utils/subscriptionClassifier");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Name, email and password are required" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });
  }

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password_hash: passwordHash,
    });

    const publicUser = { id: user.id, name: user.name, email: user.email };
    const token = createToken(publicUser);

    return res.status(201).json({ token, user: publicUser });
  } catch (error) {
    console.error("register error:", error);
    return res.status(500).json({ message: "Could not register user" });
  }
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ where: { email } });

    if (!user || !user.password_hash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const publicUser = { id: user.id, name: user.name, email: user.email };
    const token = createToken(publicUser);

    return res.json({ token, user: publicUser });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ message: "Could not log in" });
  }
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
    if (refreshToken) {
      user.google_refresh_token = refreshToken;
    }

    await user.save();

    const publicUser = { id: user.id, name: user.name, email: user.email };
    const token = createToken(publicUser);
    const redirectUrl = `${FRONTEND_URL}/oauth-success?token=${encodeURIComponent(token)}`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("googleCallbackSuccess error:", error);
    return res.redirect(`${FRONTEND_URL}/login`);
  }
}

async function me(req, res) {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "name", "email"],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user });
  } catch (error) {
    console.error("me error:", error);
    return res.status(500).json({ message: "Could not fetch user" });
  }
}

async function getAuthorizedGmailClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    access_token: user.google_access_token || undefined,
    refresh_token: user.google_refresh_token || undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) user.google_access_token = tokens.access_token;
    if (tokens.refresh_token) user.google_refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) user.google_token_expiry = new Date(tokens.expiry_date);
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
      })
    )
  );

  return details.map((item) => {
    const headers = item.data.payload?.headers || [];
    const getHeader = (headerName) =>
      headers.find((h) => h.name?.toLowerCase() === headerName.toLowerCase())?.value || "";

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
            const haystack = `${mail.subject} ${mail.snippet} ${mail.from}`.toLowerCase();
            return billKeywords.some((keyword) => haystack.includes(keyword));
          })
        : emails;

    return res.json({ emails: filteredEmails });
  } catch (error) {
    console.error("getMyEmails error:", error);
    return res.status(500).json({
      message: "Failed to fetch Gmail messages",
      error: error.message,
    });
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
    return res.status(500).json({
      message: "Failed to fetch subscription emails",
      error: error.message,
    });
  }
}

module.exports = {
  register,
  login,
  googleAuth,
  googleCallback,
  googleCallbackSuccess,
  getMyEmails,
  getSubscriptionEmails,
  me,
};
