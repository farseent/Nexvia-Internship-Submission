import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const port = Number(process.env.PORT ?? "4100");
const documentName = process.env.DOCUMENT_NAME;
const token = process.env.SPIKE_TOKEN;
const userId = process.env.USER_ID;

if (!documentName || !token || !userId) {
  throw new Error("DOCUMENT_NAME, SPIKE_TOKEN and USER_ID are required");
}

const provider = new HocuspocusProvider({
  url: `ws://127.0.0.1:${port}`,
  name: documentName,
  document: new Y.Doc(),
  token,
  broadcast: false,
  onSynced: () => {
    provider.awareness?.setLocalStateField("user", { id: userId, name: userId });
    process.stdout.write("READY\n");
  },
});

process.on("SIGTERM", () => {
  provider.destroy();
  process.exit(0);
});
