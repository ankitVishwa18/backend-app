const jwt = require("jsonwebtoken");

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider || null,
    },
    process.env.JWT_SECRET || "dev-jwt-secret-change-me",
    { expiresIn: "7d" }
  );
}

module.exports = {
  createToken,
};
