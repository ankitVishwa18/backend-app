require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { passport } = require("./config/passport");
const { sequelize } = require("./models");
const authRoutes = require("./routes/authRoutes");
const healthRoutes = require("./routes/healthRoutes");

const app = express();

const PORT = process.env.PORT || 5003;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(passport.initialize());

app.use(healthRoutes);
app.use("/auth", authRoutes);
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});
app.use((error, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled server error:", error);
  res.status(500).json({ message: "Unexpected server error" });
});

sequelize
  .sync()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to connect/sync database", error);
    process.exit(1);
  });
