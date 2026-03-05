import { initDb } from "./contacts.js";
import { startServer } from "./server.js";

initDb();
startServer();

console.log("[contacts-agent] Started.");
