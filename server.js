import { createAiClient } from "./src/config/aiClient.js";
import { PORT } from "./src/config/env.js";
import { createApp } from "./src/app.js";

const app = createApp(createAiClient);

app.listen(PORT, () => {
  console.log(`Hemis backend corriendo en http://localhost:${PORT}`);
});
