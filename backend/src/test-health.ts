import { handler } from "./health.js";

async function main() {
  if (typeof handler !== "function") {
    throw new Error("Health handler is not a function");
  }

  const result = await handler();

  console.log(result);
}

main().catch(console.error);
