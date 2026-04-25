import { createAiClient } from "./src/config/aiClient.js";
import { PORT } from "./src/config/env.js";
import { createApp } from "./src/app.js";

const aiClient = createAiClient();
const app = createApp(aiClient);

app.listen(PORT, () => {
  console.log(`Emis backend corriendo en http://localhost:${PORT}`);
});
