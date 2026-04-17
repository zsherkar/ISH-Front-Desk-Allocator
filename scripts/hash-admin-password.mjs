import crypto from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error('Usage: node ./scripts/hash-admin-password.mjs "your-password"');
  process.exit(1);
}

try {
  const normalizedPassword = password.trim();
  if (normalizedPassword.length < 8) {
    throw new Error("Admin passwords must be at least 8 characters long.");
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto
    .scryptSync(normalizedPassword, salt, 64)
    .toString("base64url");
  const passwordHash = `scrypt$${salt}$${hash}`;
  const sample = [
    {
      email: "admin@example.com",
      name: "Front Desk Admin",
      passwordHash,
    },
  ];

  console.log("Password hash:");
  console.log(passwordHash);
  console.log("");
  console.log("ADMIN_USERS_JSON example:");
  console.log(JSON.stringify(sample));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
