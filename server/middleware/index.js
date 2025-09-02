// middleware/index.js
module.exports = {
  requireAuth: require("./requireAuth"),
  requireTenant: require("./requireTenant"),
  requireRole: require("./requireRole"),
};
