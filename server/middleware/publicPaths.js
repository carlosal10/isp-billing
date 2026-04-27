function isPublicRequestPath(url) {
  const path = url || "";
  const isPaylink = path.startsWith("/api/paylink");
  const isPaylinkAdmin = path.startsWith("/api/paylink/admin");

  return (
    path.startsWith("/api/auth") ||
    (isPaylink && !isPaylinkAdmin) ||
    path.startsWith("/api/payment/callback") ||
    path.startsWith("/api/payments/callback") ||
    path.startsWith("/api/payment/stripe") ||
    path === "/api/health" ||
    path === "/api/docs/openapi.yaml"
  );
}

module.exports = { isPublicRequestPath };
