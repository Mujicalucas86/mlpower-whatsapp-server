const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const VERIFY_TOKEN = "mlpower2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VF_API_KEY = process.env.VF_API_KEY;
const VF_PROJECT_VERSION = "production";
// ─────────────────────────────────────────────────────────────────────────────

// Verificación del webhook (Meta lo llama una sola vez al configurar)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recibe mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const userPhone = message.from;
    const userText = message.text.body;

    console.log(`Mensaje de ${userPhone}: ${userText}`);

    // Mandar mensaje a Voiceflow
    const vfResponse = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${userPhone}/interact`,
      {
        action: { type: "text", payload: userText },
        config: { tts: false, stripSSML: true },
      },
      {
        headers: {
          Authorization: VF_API_KEY,
          versionID: VF_PROJECT_VERSION,
          "Content-Type": "application/json",
        },
      }
    );

    // Juntar todos los mensajes de texto que devuelve Voiceflow
    const traces = vfResponse.data;
    const textos = traces
      .filter((t) => t.type === "text" && t.payload?.message)
      .map((t) => t.payload.message);

    if (textos.length === 0) return;

    const respuesta = textos.join("\n\n");

    // Mandar respuesta al cliente por WhatsApp
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: userPhone,
        type: "text",
        text: { body: respuesta },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`Respuesta enviada a ${userPhone}`);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
