import { task, logger } from "@trigger.dev/sdk";

export const helloWorld = task({
  id: "hello-world",
  run: async (payload: { name?: string }) => {
    const name = payload.name ?? "World";
    logger.info(`Hello, ${name}!`);
    return { message: `Hello, ${name}!` };
  },
});
