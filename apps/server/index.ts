import { edenTreaty } from "@elysiajs/eden";

import { App } from "./src";
import { ChatRoom, Client } from "./src/routes/api/chat";

export const server = edenTreaty<App>("http://localhost:3000");

export type {
    App,
    ChatRoom,
    Client,
}