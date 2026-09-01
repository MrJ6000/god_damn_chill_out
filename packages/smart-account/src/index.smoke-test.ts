import { chainHealth, readSessionPermission } from "./index.js";

async function main() {
  console.log("=== chainHealth ===");
  console.log(await chainHealth());
  console.log("=== readSessionPermission ===");
  console.log(await readSessionPermission());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
