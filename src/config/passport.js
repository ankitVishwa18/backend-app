const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const googleEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET);

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

module.exports = {
  passport,
  googleEnabled,
};
