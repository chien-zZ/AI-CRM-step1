const [major] = process.versions.node.split(".").map(Number);

if (major !== 24) {
  console.error(`Node 24 is required; received ${process.version}.`);
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent;
if (userAgent && !userAgent.startsWith("pnpm/9.15.0 ")) {
  console.error(`pnpm 9.15.0 is required; received ${userAgent.split(" ")[0]}.`);
  process.exit(1);
}
