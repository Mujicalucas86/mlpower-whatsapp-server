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
const DEBOUNCE_MS = 3000;
const LOGGING_URL = "https://script.google.com/macros/s/AKfycbyhjeV-B9CE9AnfS875zEPjlDIz2b-rcjA7sQoADngN_Hri3Y8_1Epg22RmDDIsTciMzg/exec";
// ─────────────────────────────────────────────────────────────────────────────

const timers = {};
const mensajesAcumulados = {};

// Verificación del webhook
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

// Reset de sesión de Voiceflow para un número
app.get("/reset", async (req, res) => {
  const { phone, key } = req.query;
  if (key !== VERIFY_TOKEN) return res.sendStatus(403);
  if (!phone) return res.status(400).send("Falta el parámetro phone");

  try {
    await axios.delete(
      `https://general-runtime.voiceflow.com/state/user/${phone}`,
      {
        headers: {
          Authorization: VF_API_KEY,
          versionID: VF_PROJECT_VERSION,
        },
      }
    );
    delete mensajesAcumulados[phone];
    delete timers[phone];
    console.log(`Sesión reseteada para ${phone}`);
    res.send(`✅ Sesión reseteada para ${phone}`);
  } catch (err) {
    console.error("Error reset:", err.response?.data || err.message);
    res.status(500).send("Error al resetear sesión");
  }
});

// Guarda la conversación en Google Sheets
async function logConversacion(numero, mensaje, respuesta) {
  try {
    await axios.post(LOGGING_URL, { numero, mensaje, respuesta });
  } catch (err) {
    console.error("Error logging:", err.message);
  }
}

// Procesa el mensaje completo y lo manda a Voiceflow
async function procesarMensajeCompleto(userPhone) {
  const userText = mensajesAcumulados[userPhone].join(" ");
  delete mensajesAcumulados[userPhone];
  delete timers[userPhone];

  console.log(`Procesando mensaje de ${userPhone}: ${userText}`);

  try {
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

    const traces = vfResponse.data;
    const textos = traces
      .filter((t) => t.type === "text" && t.payload?.message)
      .map((t) => t.payload.message);

    if (textos.length === 0) return;

    const respuesta = textos.join("\n\n");

    // Mandar respuesta al cliente
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

    // Guardar en Google Sheets
    await logConversacion(userPhone, userText, respuesta);

  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

// Recibe mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const userPhone = message.from;
    const userText = message.text.body;

    console.log(`Fragmento recibido de ${userPhone}: ${userText}`);

    if (!mensajesAcumulados[userPhone]) {
      mensajesAcumulados[userPhone] = [];
    }
    mensajesAcumulados[userPhone].push(userText);

    if (timers[userPhone]) {
      clearTimeout(timers[userPhone]);
    }
    timers[userPhone] = setTimeout(() => {
      procesarMensajeCompleto(userPhone);
    }, DEBOUNCE_MS);

  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
