"use strict";

const manifest = require("./module.manifest.json");

async function registerExampleModule() {
  const endpoint =
    process.env.MODULE_REGISTRY_URL ?? "http://localhost:3001/api/v1/modules";
  const token = process.env.MODULE_REGISTRY_TOKEN;
  if (!token) {
    throw new Error(
      "MODULE_REGISTRY_TOKEN is required because module registration is admin-only",
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      manifest,
      description:
        "A minimal grant-funded module demonstrating registry lifecycle hooks.",
      author: "GrantFox example contributor",
    }),
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      `Example module registration failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  process.stdout.write(
    `Registered ${body.module?.name}@${body.module?.version} (${body.module?.id})\n`,
  );
}

registerExampleModule().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
