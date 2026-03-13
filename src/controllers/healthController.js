const { googleEnabled } = require("../config/passport");

function health(_req, res) {
  return res.json({ ok: true, googleEnabled });
}

module.exports = {
  health,
};
