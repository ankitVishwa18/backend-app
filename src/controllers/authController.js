const bcrypt = require("bcryptjs");
const { passport, googleEnabled } = require("../config/passport");
const { User } = require("../models");
const { createToken } = require("../utils/token");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
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
  } catch (_error) {
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
  } catch (_error) {
    return res.status(500).json({ message: "Could not log in" });
  }
}

function googleAuth(req, res, next) {
  if (!googleEnabled) {
    return res.status(503).json({
      message: "Google login is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
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
    const { email, name, googleId } = req.user;

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

    const publicUser = { id: user.id, name: user.name, email: user.email };
    const token = createToken(publicUser);
    const redirectUrl = `${FRONTEND_URL}/oauth-success?token=${encodeURIComponent(token)}`;

    return res.redirect(redirectUrl);
  } catch (_error) {
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
  } catch (_error) {
    return res.status(500).json({ message: "Could not fetch user" });
  }
}

module.exports = {
  register,
  login,
  googleAuth,
  googleCallback,
  googleCallbackSuccess,
  me,
};
