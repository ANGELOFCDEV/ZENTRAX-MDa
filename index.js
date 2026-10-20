
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_NAME = process.env.BOT_NAME || "ZENTRAX MD";
const OWNER = "ANGEL OFC DEV";
const PREFIX = "!";

const AUTH_METHOD = (
  process.env.AUTH_METHOD || "qr"
).toLowerCase();

const PHONE_NUMBER = process.env.PHONE_NUMBER || "";

const plugins = new Map();

async function loadPlugins() {
  const dir = path.join(__dirname, "plugins");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;

    try {
      const fileUrl = pathToFileURL(path.join(dir, file)).href;
      const imported = await import(fileUrl + `?v=${Date.now()}`);
      const plugin = imported.default;

      if (!plugin?.name || typeof plugin.execute !== "function") {
        console.log(`Plugin ignorado: ${file}`);
        continue;
      }

      plugins.set(plugin.name.toLowerCase(), plugin);

      for (const alias of plugin.aliases || []) {
        plugins.set(alias.toLowerCase(), plugin);
      }

      console.log(`Plugin cargado: ${plugin.name}`);
    } catch {
      console.log(`Error cargando plugin: ${file}`);
    }
  }
}

let starting = false;
let reconnectTimer;

async function startBot() {
  if (starting) return;
  starting = true;

  try {
    await loadPlugins();

    const { state, saveCreds } =
      await useMultiFileAuthState("sessions");

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      browser: [BOT_NAME, "Chrome", "1.0.0"],
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
          const code = await sock.requestPairingCode(PHONE_NUMBER);
          console.log("Código de vinculación:", code);
        } catch {
          pairingRequested = false;
          console.log("No se pudo solicitar el código de vinculación.");
        }
      }

      if (connection === "open") {
        console.log(`${BOT_NAME} conectado.`);
        starting = false;
      }

      if (connection === "close") {
        starting = false;

        const status =
          lastDisconnect?.error?.output?.statusCode;

        if (status === DisconnectReason.loggedOut) {
          console.log("Sesión cerrada. Debes vincular WhatsApp de nuevo.");
          return;
        }

        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startBot, 3000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages) {
        if (!message.message || message.key.fromMe) continue;

        const jid = message.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;

        const content = message.message;
        const body =
          content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          "";

        if (!body.startsWith(PREFIX)) continue;

        const parts = body.slice(PREFIX.length).trim().split(/\s+/);
        const command = (parts.shift() || "").toLowerCase();

        if (!command) continue;

        const plugin = plugins.get(command);
        if (!plugin) continue;

        try {
          await plugin.execute(sock, message, {
            args: parts,
            command,
            prefix: PREFIX,
            botName: BOT_NAME,
            owner: OWNER
          });
        } catch {
          await sock.sendMessage(jid, {
            text: "❌ Ocurrió un error al ejecutar el comando."
          });
        }
      }
    });
  } catch (error) {
    starting = false;
    console.error("Error al iniciar ZENTRAX MD.");
    console.error(error?.message || error);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(startBot, 5000);
  }
}

console.log(`${BOT_NAME} — By ${OWNER}`);
startBot();
