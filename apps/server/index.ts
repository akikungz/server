import { edenTreaty } from "@elysiajs/eden";

import { App } from "./src";
import { ChatRoom, Client } from "./src/routes/api/chat";

export const server = edenTreaty<App>("/");

export type {
    App,
    ChatRoom,
    Client,
}