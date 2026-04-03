const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const MicrosoftStrategy = require("passport-microsoft").Strategy;

const googleEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET);
const microsoftEnabled =
  Boolean(process.env.MICROSOFT_CLIENT_ID) &&
  Boolean(process.env.MICROSOFT_CLIENT_SECRET);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL ||
          "http://localhost:5000/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Google account has no email."));
          }

          return done(null, {
            email: profile.emails?.[0]?.value,
            name: profile.displayName || email.split("@")[0],
            googleId: profile.id,
            accessToken,
            refreshToken,
          });
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

if (microsoftEnabled) {
  passport.use(
    new MicrosoftStrategy(
      {
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL:
          process.env.MICROSOFT_CALLBACK_URL ||
          "http://localhost:5002/microsoft-redirectLogin",
        scope: ["user.read"],
        tenant: process.env.MICROSOFT_TENANT || "common",
      },
      async (accessToken, _refreshToken, profile, done) => {
        try {
          const email =
            profile.emails?.[0]?.value ||
            profile._json?.mail ||
            profile._json?.userPrincipalName;

          if (!email) {
            return done(new Error("Microsoft account has no email."));
          }

          return done(null, {
            email,
            name: profile.displayName || email.split("@")[0],
            microsoftId: profile.id,
            accessToken,
          });
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

module.exports = {
  passport,
  googleEnabled,
  microsoftEnabled,
};
