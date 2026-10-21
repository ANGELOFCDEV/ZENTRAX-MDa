
import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================
// ZENTRAX MD - ANGEL OFC DEV
// ============================================

const candidates = [
  baileys.default,
  baileys.default?.default,
  baileys.makeWASocket,
  baileys.default?.makeWASocket
];

const makeWASocket = candidates.find(
  (item) => typeof item === "function"
);

const DisconnectReason =
  baileys.DisconnectReason ??
  baileys.default?.DisconnectReason;

const useMultiFileAuthState =
  baileys.useMultiFileAuthState ??
  baileys.default?.useMultiFileAuthState;

if (typeof makeWASocket !== "function") {
  console.error("❌ No se encontró makeWASocket.");
  console.error("Exportaciones:", Object.keys(baileys));
  process.exit(1);
}

if (typeof useMultiFileAuthState !== "function") {
  console.error("❌ No se encontró useMultiFileAuthState.");
  process.exit(1);
}

if (!DisconnectReason) {
  console.error("❌ No se encontró DisconnectReason.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_NAME = process.env.BOT_NAME || "ZENTRAX MD";
const OWNER = "ANGEL OFC DEV";
const PREFIX = "!";
const SESSION_DIR = path.join(__dirname, "sessions");
const PLUGINS_DIR = path.join(__dirname, "plugins");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, resolve));

const plugins = new Map();

let sock = null;
let state;
let saveCreds;
let method = "";
let phoneNumber = "";
let pairingRequested = false;
let reconnectTimer = null;
let stopped = false;
let reconnecting = false;
let connectionNumber = 0;

// ============================================
// BANNER
// ============================================

function banner() {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║             Z E N T R A X                ║
║                  M D                     ║
║                                          ║
║             BY ANGEL OFC DEV             ║
║                                          ║
║          WHATSAPP AUTOMATION BOT         ║
║                                          ║
╚══════════════════════════════════════════╝

  Bienvenido a ${BOT_NAME}
  Creador: ${OWNER}

`);
}

// ============================================
// CARGAR PLUGINS
// ============================================

async function loadPlugins() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  plugins.clear();

  for (const file of fs.readdirSync(PLUGINS_DIR)) {
    if (!file.endsWith(".js")) continue;

    try {
      const pluginUrl = pathToFileURL(
        path.join(PLUGINS_DIR, file)
      ).href;

      const imported = await import(
        `${pluginUrl}?v=${Date.now()}`
      );

      const plugin = imported.default;

      if (
        !plugin?.name ||
        typeof plugin.execute !== "function"
      ) {
        console.log(`⚠️ Plugin ignorado: ${file}`);
        continue;
      }

      plugins.set(plugin.name.toLowerCase(), plugin);

      for (const alias of plugin.aliases || []) {
        plugins.set(alias.toLowerCase(), plugin);
      }

      console.log(`✅ Plugin cargado: ${plugin.name}`);
    } catch (error) {
      console.error(
        `❌ Error en ${file}:`,
        error.message
      );
    }
  }

  console.log(`📦 Plugins disponibles: ${plugins.size}\n`);
}

// ============================================
// SELECCIONAR MÉTODO DE VINCULACIÓN
// ============================================

async function chooseMethod() {
  if (state.creds.registered) {
    method = "saved";
    console.log("🔐 Sesión guardada. Conectando...\n");
    return;
  }

  while (!stopped) {
    console.log(`
╭────────────────────────────────────────╮
│               ZENTRAX MD               │
├────────────────────────────────────────┤
│  1. Conectar con QR                    │
│  2. Código de vinculación              │
╰────────────────────────────────────────╯
`);

    const option = (await ask("Elige 1 o 2: ")).trim();

    if (option === "1") {
      method = "qr";
      return;
    }

    if (option === "2") {
      const country = (
        await ask("Código de país sin + (Perú 51): ")
      ).replace(/\D/g, "");

      const localNumber = (
        await ask("Número local sin código de país: ")
      ).replace(/\D/g, "");

      const fullNumber = country + localNumber;

      if (
        !/^[1-9]\d{0,3}$/.test(country) ||
        !/^[1-9]\d{6,13}$/.test(localNumber) ||
        !/^[1-9]\d{7,14}$/.test(fullNumber)
      ) {
        console.log(
          "❌ Número inválido. Revisa el código de país y el número.\n"
        );
        continue;
      }

      phoneNumber = fullNumber;
      method = "pairing";
      return;
    }

    console.log("❌ Opción incorrecta. Escribe 1 o 2.\n");
  }
}

// ============================================
// SOLICITAR CÓDIGO DE VINCULACIÓN
// ============================================

async function requestPairingCode(currentSock) {
  if (
    method !== "pairing" ||
    state.creds.registered ||
    pairingRequested ||
    stopped
  ) {
    return;
  }

  pairingRequested = true;

  try {
    console.log("\n📲 Preparando código de vinculación...");

    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (stopped || sock !== currentSock) {
      pairingRequested = false;
      return;
    }

    const code = await currentSock.requestPairingCode(
      phoneNumber
    );

    console.log(`
╔══════════════════════════════════════════╗
║         CÓDIGO DE VINCULACIÓN            ║
╠══════════════════════════════════════════╣
║                                          ║
║              ${String(code).padEnd(20)}  ║
║                                          ║
╚══════════════════════════════════════════╝

📱 En WhatsApp:
1. Abre Ajustes.
2. Entra en Dispositivos vinculados.
3. Pulsa Vincular un dispositivo.
4. Selecciona vincular con número de teléfono.
5. Introduce el código actual.

⏳ Esperando que WhatsApp confirme la vinculación...
`);

  } catch (error) {
    pairingRequested = false;

    console.error(
      "❌ No se pudo generar el código:",
      error?.message || error
    );
  }
}

// ============================================
// CREAR CONEXIÓN
// ============================================

async function createSocket() {
  if (stopped) return;

  connectionNumber++;

  const currentNumber = connectionNumber;

  console.log(
    `\n🔄 Iniciando conexión (intento ${currentNumber})...`
  );

  const currentSock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: [BOT_NAME, "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock = currentSock;
  pairingRequested = false;

  currentSock.ev.on("creds.update", saveCreds);

  // ==========================================
  // ESTADO DE CONEXIÓN
  // ==========================================

  currentSock.ev.on("connection.update", async (update) => {
    if (sock !== currentSock || stopped) return;

    const { connection, lastDisconnect, qr } = update;

    if (connection === "connecting") {
      console.log("🔄 Conectando con WhatsApp...");
    }

    // QR
    if (
      qr &&
      method === "qr" &&
      !state.creds.registered
    ) {
      console.log("\n📲 Escanea el QR con WhatsApp:\n");

      qrcode.generate(qr, { small: true });

      console.log(
        "WhatsApp → Dispositivos vinculados → Vincular un dispositivo."
      );
    }

    // Código de vinculación
    if (
      method === "pairing" &&
      !state.creds.registered &&
      !pairingRequested
    ) {
      void requestPairingCode(currentSock);
    }

    // CONEXIÓN EXITOSA
    if (connection === "open") {
      method = "saved";
      reconnecting = false;
      pairingRequested = false;

      console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║          ✅ CONEXIÓN EXITOSA             ║
║                                          ║
╚══════════════════════════════════════════╝

🤖 Bot: ${BOT_NAME}
👑 Creador: ${OWNER}
⌨️ Prefijo: ${PREFIX}
🟢 WhatsApp está conectado.
📦 El bot está listo para recibir comandos.

`);
    }

    // CONEXIÓN CERRADA
    if (connection === "close") {
      const status =
        lastDisconnect?.error?.output?.statusCode;

      const detail =
        lastDisconnect?.error?.message ||
        "Sin detalles adicionales";

      console.log("\n⚠️ La conexión se cerró.");
      console.log("Código de cierre:", status);
      console.log("Motivo:", detail);

      if (sock === currentSock) {
        sock = null;
      }

      if (status === DisconnectReason.loggedOut) {
        console.log(`
❌ WhatsApp cerró la sesión.
Debes volver a vincular el dispositivo.
`);

        stopped = true;
        rl.close();
        return;
      }

      if (stopped || reconnecting) return;

      reconnecting = true;

      console.log("🔄 Preparando una nueva conexión...");

      clearTimeout(reconnectTimer);

      reconnectTimer = setTimeout(async () => {
        try {
          if (!stopped) {
            // Volver a solicitar el código solo si aún
            // no se ha completado la vinculación.
            if (!state.creds.registered && method !== "qr") {
              method = "pairing";
            }

            await createSocket();
          }
        } catch (error) {
          console.error(
            "❌ Error al reconectar:",
            error?.message || error
          );
        } finally {
          reconnecting = false;
        }
      }, 4000);
    }
  });

  // ==========================================
  // RECIBIR MENSAJES Y EJECUTAR COMANDOS
  // ==========================================

  currentSock.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {
      if (
        type !== "notify" ||
        sock !== currentSock ||
        stopped
      ) {
        return;
      }

      for (const message of messages) {
        if (!message.message || message.key.fromMe) continue;

        const jid = message.key.remoteJid;

        if (
          !jid ||
          jid === "status@broadcast" ||
          jid.endsWith("@newsletter")
        ) {
          continue;
        }

        const content = message.message;

        const body =
          content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          content.documentMessage?.caption ||
          "";

        if (!body.startsWith(PREFIX)) continue;

        const parts = body
          .slice(PREFIX.length)
          .trim()
          .split(/\s+/);

        const command = (parts.shift() || "").toLowerCase();

        if (!command) continue;

        const plugin = plugins.get(command);

        if (!plugin) continue;

        try {
          await plugin.execute(currentSock, message, {
            args: parts,
            command,
            prefix: PREFIX,
            botName: BOT_NAME,
            owner: OWNER
          });
        } catch (error) {
          console.error(
            `❌ Error en ${PREFIX}${command}:`,
            error?.message || error
          );

          try {
            await currentSock.sendMessage(jid, {
              text: "❌ Ocurrió un error al ejecutar el comando."
            });
          } catch (sendError) {
            console.error(
              "No se pudo enviar el mensaje:",
              sendError.message
            );
          }
        }
      }
    }
  );
}

// ============================================
// INICIAR BOT
// ============================================

async function main() {
  banner();

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  await loadPlugins();

  const session = await useMultiFileAuthState(SESSION_DIR);

  state = session.state;
  saveCreds = session.saveCreds;

  await chooseMethod();

  if (!stopped) {
    await createSocket();
  }
}

// ============================================
// ERRORES Y CIERRE
// ============================================

process.on("SIGINT", () => {
  stopped = true;
  clearTimeout(reconnectTimer);

  console.log("\n👋 Cerrando ZENTRAX MD...");

  rl.close();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error(
    "❌ Error asíncrono:",
    error?.stack || error
  );
});

main().catch((error) => {
  console.error(
    "❌ Error iniciando ZENTRAX MD:",
    error?.stack || error
  );

  rl.close();
  process.exitCode = 1;
});
