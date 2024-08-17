import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import staticPlugin from "@elysiajs/static";
import routes from "./routes";

const app = new Elysia()
  .use(swagger())
  .use(staticPlugin({ prefix: "/" }))
  .use(cors())
  .use(routes)
  .onAfterResponse(({ path }) => console.log(`Request ${path} is done`))
  .onStart(() => Bun.$`bun run css:dev`)
  .get("/", () => Bun.file("public/index.html"))
  .listen(3000, (server) => console.log(`Server is running on ${server.hostname}:${server.port}`));

export type App = typeof app;