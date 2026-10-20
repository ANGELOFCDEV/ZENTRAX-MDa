
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_NAME = process.env.BOT_NAME || "ZENTRAX MD";
const OWNER = "ANGEL OFC DEV";
const PREFIX = "!";
const SESSION_DIR = path.join(__dirname, "sessions");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, resolve));

const plugins = new Map();

let sock;
let state;
let saveCreds;
let method = "";
let phoneNumber = "";
let pairingRequested = false;
let reconnectTimer;
let reconnecting = false;
let stopped = false;

async function loadPlugins() {
  const dir = path.join(__dirname, "plugins");
  fs.mkdirSync(dir, { recursive: true });

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;

    try {
      const fileUrl = pathToFileURL(path.join(dir, file)).href;
      const imported = await import(fileUrl);
      const plugin = imported.default;

      if (!plugin?.name || typeof plugin.execute !== "function") {
        console.log(`⚠️ Plugin ignorado: ${file}`);
        continue;
      }

      plugins.set(plugin.name.toLowerCase(), plugin);

      for (const alias of plugin.aliases || []) {
        plugins.set(alias.toLowerCase(), plugin);
      }

      console.log(`✅ Plugin cargado: ${plugin.name}`);
    } catch (error) {
      console.error(`❌ Error en ${file}: ${error.message}`);
    }
  }
}

function banner() {
  console.log(`
╔══════════════════════════════════════╗
║                                      ║
║             ZENTRAX MD               ║
║           BY ANGEL OFC DEV           ║
║                                      ║
║       WHATSAPP AUTOMATION BOT         ║
╚══════════════════════════════════════╝
`);
}

async function chooseMethod() {
  if (state.creds.registered) {
    console.log("🔐 Sesión existente detectada.");
    console.log("Intentando reconectar con esa sesión...\n");
    method = "saved";
    return;
  }

  console.log("Selecciona cómo conectar WhatsApp:\n");
  console.log("  1. Conectar con código QR");
  console.log("  2. Conectar con código de vinculación\n");

  const option = (await ask("Selecciona una opción (1/2): ")).trim();

  if (option === "1") {
    method = "qr";
    return;
  }

  if (option !== "2") {
    console.log("❌ Opción no válida. Intenta de nuevo.\n");
    return chooseMethod();
  }

  console.log("\nIntroduce tu número sin el prefijo del país.");
  console.log("Ejemplo: 987654321 para Perú.\n");

  let dial = (await ask("Código de país (51 para Perú, 52 para México): "))
    .replace(/\D/g, "");

  const local = (await ask("Número de teléfono: "))
    .replace(/\D/g, "");

  const fullNumber = dial + local;

  if (!dial || !local || !/^\d{8,15}$/.test(fullNumber)) {
    console.log("❌ Número no válido. Vuelve a intentarlo.\n");
    return chooseMethod();
  }

  method = "pairing";
  phoneNumber = fullNumber;
}

async function createSocket() {
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: [BOT_NAME, "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !state.creds.registered) {
      if (method === "qr") {
        console.log("\n📲 Escanea este QR desde WhatsApp:");
        qrcode.generate(qr, { small: true });
        console.log("WhatsApp → Dispositivos vinculados → Vincular dispositivo\n");
      } else if (method === "pairing" && !pairingRequested) {
        pairingRequested = true;

        try {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log("\n╔════════════════════════════════╗");
          console.log(`║ Código de vinculación: ${code} ║`);
          console.log("╚════════════════════════════════╝");
          console.log("Abre WhatsApp → Dispositivos vinculados");
          console.log("→ Vincular dispositivo → Vincular con número de teléfono.");
          console.log("Introduce el código que aparece arriba.\n");
        } catch (error) {
          pairingRequested = false;
          console.error("❌ No se pudo generar el código:", error.message);
        }
      }
    }

    if (connection === "connecting") {
      console.log("🔄 Conectando con WhatsApp...");
    }

    if (connection === "open") {
      console.log(`\n✅ ${BOT_NAME} conectado correctamente.`);
      console.log(`👑 Propietario: ${OWNER}`);
      console.log(`⌨️ Prefijo de comandos: ${PREFIX}\n`);
      reconnecting = false;
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;

      sock = null;

      if (status === DisconnectReason.loggedOut) {
        console.log("❌ Sesión cerrada. Debes vincular WhatsApp de nuevo.");
        stopped = true;
        rl.close();
        return;
      }

      if (stopped || reconnecting) return;

      reconnecting = true;
      console.log("⚠️ Conexión interrumpida. Reintentando en 3 segundos...");

      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(async () => {
        try {
          if (!stopped) await createSocket();
        } catch (error) {
          console.error("Error al reconectar:", error.message);
        } finally {
          reconnecting = false;
        }
      }, 3000);
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
      } catch (error) {
        console.error(`Error en !${command}:`, error.message);

        await sock.sendMessage(jid, {
          text: "❌ Ocurrió un error al ejecutar el comando."
        });
      }
    }
  });
}

async function main() {
  banner();
  await loadPlugins();

  const session = await useMultiFileAuthState(SESSION_DIR);
  state = session.state;
  saveCreds = session.saveCreds;

  await chooseMethod();
  await createSocket();
}

process.on("SIGINT", async () => {
  console.log("\nCerrando ZENTRAX MD...");
  stopped = true;
  clearTimeout(reconnectTimer);
  rl.close();
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Error iniciando ZENTRAX MD:", error.message);
  process.exitCode = 1;
  rl.close();
});
