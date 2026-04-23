import crypto from "node:crypto";
import readline from "node:readline";
import process from "node:process";

function cleanupHiddenPrompt(stdin, listener, wasRawModeEnabled) {
  stdin.removeListener("keypress", listener);
  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(Boolean(wasRawModeEnabled));
  }
  stdin.pause();
}

async function promptForHiddenInput(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive password prompt is unavailable here. Pass the password as an argument only on a trusted local machine.',
    );
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRawModeEnabled = process.stdin.isRaw;
  if (typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdout.write(label);

  return await new Promise((resolve, reject) => {
    let value = "";

    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        cleanupHiddenPrompt(process.stdin, onKeypress, wasRawModeEnabled);
        process.stdout.write("\n");
        reject(new Error("Password entry cancelled."));
        return;
      }

      if (key?.name === "return" || key?.name === "enter") {
        cleanupHiddenPrompt(process.stdin, onKeypress, wasRawModeEnabled);
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (key?.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }

      if (typeof character === "string" && !key?.meta && !key?.ctrl) {
        value += character;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

try {
  let password = process.argv[2];
  if (!password) {
    const enteredPassword = await promptForHiddenInput("Admin password: ");
    const confirmedPassword = await promptForHiddenInput("Confirm password: ");
    if (enteredPassword !== confirmedPassword) {
      throw new Error("Passwords did not match.");
    }
    password = enteredPassword;
  }

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
