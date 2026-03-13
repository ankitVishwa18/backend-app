const express = require("express");
const authMiddleware = require("../middleware/auth");
const authController = require("../controllers/authController");

const router = express.Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/google", authController.googleAuth);
router.get(
  "/google/callback",
  authController.googleCallback,
  authController.googleCallbackSuccess,
);
router.get("/me", authMiddleware, authController.me);
router.get("/gmail/messages", authMiddleware, authController.getMyEmails);
router.get(
  "/gmail/subscriptions",
  authMiddleware,
  authController.getSubscriptionEmails,
);

module.exports = router;
