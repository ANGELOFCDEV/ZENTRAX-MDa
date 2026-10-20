
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

const BOT_NAME = "ZENTRAX MD";
const OWNER = "ANGEL OFC DEV";

// Configuración mediante variables de entorno.
// AUTH_METHOD: qr o pairing
// PHONE_NUMBER: código de país + número, solo dígitos.
const AUTH_METHOD = (
  process.env.AUTH_METHOD || "qr"
).toLowerCase();

const PHONE_NUMBER = process.env.PHONE_NUMBER || "";

let reconnecting = false;

async function startBot() {
  if (reconnecting) return;
  reconnecting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState("sessions");

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["ZENTRAX MD", "Chrome", "1.0.0"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    let pairingRequested = false;

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && AUTH_METHOD === "qr") {
        console.log("Escanea este QR con WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (
        AUTH_METHOD === "pairing" &&
        !state.creds.registered &&
        !pairingRequested
      ) {
        if (!/^\d{8,15}$/.test(PHONE_NUMBER)) {
          console.log(
            "Configura PHONE_NUMBER con el número internacional, solo dígitos."
          );
          return;
        }

        pairingRequested = true;

        try {
          const code = await sock.requestPairingCode(
            PHONE_NUMBER
          );
          console.log("Código de vinculación:", code);
          console.log(
            "Introdúcelo en WhatsApp > Dispositivos vinculados."
          );
        } catch (error) {
          pairingRequested = false;
          console.error(
            "No se pudo solicitar el código de vinculación."
          );
        }
      }

      if (connection === "open") {
        console.log(`${BOT_NAME} está conectado.`);
        reconnecting = false;
      }

      if (connection === "close") {
        reconnecting = false;

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            "Sesión cerrada. Vuelve a vincular WhatsApp."
          );
          return;
        }

        console.log("Conexión cerrada. Reconectando...");
        setTimeout(startBot, 3000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages) {
        if (!message.message || message.key.fromMe) continue;

        const jid = message.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;

        const content = message.message;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          "";

        const command = text.trim().toLowerCase();

        if (command === "!ping") {
          await sock.sendMessage(jid, {
            text: "🏓 Pong! ZENTRAX MD está activo."
          });
        }

        if (command === "!menu") {
          await sock.sendMessage(jid, {
            text:
              `╭━━━〔 ${BOT_NAME} 〕━━━╮\n` +
              `┃ 👑 Creador: ${OWNER}\n` +
              `┃ ⚡ !ping — Comprobar estado\n` +
              `┃ 📋 !menu — Mostrar menú\n` +
              `┃ ℹ️ !estado — Estado del bot\n` +
              `╰━━━━━━━━━━━━━━━━━━╯`
          });
        }

        if (command === "!estado") {
          await sock.sendMessage(jid, {
            text: `✅ ${BOT_NAME}\nEstado: conectado\nVersión: 1.0.0`
          });
        }
      }
    });
  } catch (error) {
    reconnecting = false;
    console.error(
      "Error al iniciar el bot. Revisa la configuración y las dependencias."
    );
    setTimeout(startBot, 5000);
  }
}

console.log(`Iniciando ${BOT_NAME} — By ${OWNER}`);
startBot();
