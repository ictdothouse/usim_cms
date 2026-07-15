import http from "node:http";
import { handler } from "./dist/server/entry.mjs";

const port = process.env.PORT ? Number(process.env.PORT) : 4321;
const server = http.createServer(handler);

server.listen(port, () => {
  console.log(`frontend listening on :${port}`);
});

// Native http.Server#close: stop accepting new connections, let in-flight
// ones finish, then callback — the graceful drain "standalone" mode lacked.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
