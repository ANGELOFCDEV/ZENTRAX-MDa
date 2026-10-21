

import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const candidates = [
  baileys.default,
  baileys.default?.default,
  baileys.makeWASocket,
  baileys.default?.makeWASocket
];

const makeWASocket = candidates.find(
  (candidate) => typeof candidate === "function"
);

const DisconnectReason =
  baileys.DisconnectReason ??
  baileys.default?.DisconnectReason;

const useMultiFileAuthState =
  baileys.useMultiFileAuthState ??
  baileys.default?.useMultiFileAuthState;

if (typeof makeWASocket !== "function") {
  console.error("❌ Baileys no exporta makeWASocket como función.");
  console.error("Versión:", baileys.VERSION ?? "no identificada");
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

const ask = (text) =>
  new Promise((resolve) => rl.question(text, resolve));

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

function banner() {
  console.log(`
╔══════════════════════════════════════╗
║                                      ║
║          Z E N T R A X               ║
║              M D                    ║
║                                      ║
║         BY ANGEL OFC DEV             ║
║                                      ║
║       WHATSAPP AUTOMATION BOT         ║
║                                      ║
╚══════════════════════════════════════╝

  Bienvenido a ${BOT_NAME}
  Creador: ${OWNER}

`);
}

async function loadPlugins() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  plugins.clear();

  for (const file of fs.readdirSync(PLUGINS_DIR)) {
    if (!file.endsWith(".js")) continue;

    try {
      const url = pathToFileURL(
        path.join(PLUGINS_DIR, file)
      ).href;

      const imported = await import(`${url}?v=${Date.now()}`);
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
      console.error(`❌ Error en ${file}:`, error.message);
    }
  }

  console.log(`📦 Plugins disponibles: ${plugins.size}\n`);
}

async function chooseMethod() {
  if (state.creds.registered) {
    method = "saved";
    console.log("🔐 Sesión guardada. Conectando...\n");
    return;
  }

  while (true) {
    console.log(`
╭────────────────────────────────────╮
│             ZENTRAX MD             │
├────────────────────────────────────┤
│  1. Conectar con QR                │
│  2. Código de vinculación          │
╰────────────────────────────────────╯
`);

    const option = (await ask("Elige 1 o 2: ")).trim();

    if (option === "1") {
      method = "qr";
      return;
    }

    if (option === "2") {
      const country = (
        await ask(
          "Código de país sin + (Perú 51, México 52): "
        )
      ).replace(/\D/g, "");

      const localNumber = (
        await ask("Número de teléfono sin prefijo: ")
      ).replace(/\D/g, "");

      const fullNumber = country + localNumber;

      if (
        !/^[1-9]\d{0,3}$/.test(country) ||
        !/^[1-9]\d{6,13}$/.test(localNumber) ||
        !/^[1-9]\d{7,14}$/.test(fullNumber)
      ) {
        console.log(
          "❌ Número inválido. Comprueba el país y el número.\n"
        );
        continue;
      }

      phoneNumber = fullNumber;
      method = "pairing";
      return;
    }

    console.log("❌ Opción incorrecta. Elige 1 o 2.\n");
  }
}

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
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (stopped || sock !== currentSock) {
      pairingRequested = false;
      return;
    }

    const code = await currentSock.requestPairingCode(phoneNumber);

    console.log(`
╔════════════════════════════════════╗
║       CÓDIGO DE VINCULACIÓN        ║
║                                    ║
║             ${code}                 ║
║                                    ║
╚════════════════════════════════════╝

En tu WhatsApp:
1. Abre Dispositivos vinculados.
2. Pulsa Vincular un dispositivo.
3. Selecciona vincular con número de teléfono.
4. Introduce el código mostrado.

No compartas este código con nadie.
`);
  } catch (error) {
    pairingRequested = false;
    console.error(
      "❌ Error generando el código:",
      error.message
    );
  }
}

async function createSocket() {
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

  currentSock.ev.on("connection.update", async (update) => {
    if (sock !== currentSock || stopped) return;

    const { connection, lastDisconnect, qr } = update;

    if (connection === "connecting") {
      console.log("🔄 Conectando con WhatsApp...");
    }

    if (qr && method === "qr" && !state.creds.registered) {
      console.log("\n📲 Escanea este QR con WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log(
        "WhatsApp → Dispositivos vinculados → Vincular dispositivo."
      );
    }

    if (
      method === "pairing" &&
      !state.creds.registered &&
      !pairingRequested
    ) {
      void requestPairingCode(currentSock);
    }

    if (connection === "open") {
      console.log(`\n✅ ${BOT_NAME} CONECTADO`);
      console.log(`👑 Propietario: ${OWNER}`);
      console.log(`⌨️ Prefijo de comandos: ${PREFIX}`);
      console.log("📦 Bot listo para recibir comandos.\n");
      reconnecting = false;
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;

      if (sock === currentSock) {
        sock = null;
      }

      if (status === DisconnectReason.loggedOut) {
        console.log(
          "❌ Sesión cerrada. Debes vincular WhatsApp nuevamente."
        );
        stopped = true;
        rl.close();
        return;
      }

      if (stopped || reconnecting) return;

      reconnecting = true;
      console.log("⚠️ Conexión interrumpida. Reintentando...");

      clearTimeout(reconnectTimer);

      reconnectTimer = setTimeout(async () => {
        try {
          if (!stopped) {
            await createSocket();
          }
        } catch (error) {
          console.error(
            "❌ Error al reconectar:",
            error.message
          );
        } finally {
          reconnecting = false;
        }
      }, 3000);
    }
  });

  currentSock.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {
      if (type !== "notify" || sock !== currentSock) return;

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
            error.message
          );

          await currentSock.sendMessage(jid, {
            text: "❌ Ocurrió un error al ejecutar el comando."
          });
        }
      }
    }
  );
}

async function main() {
  banner();

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  await loadPlugins();

  const session = await useMultiFileAuthState(SESSION_DIR);

  state = session.state;
  saveCreds = session.saveCreds;

  await chooseMethod();
  await createSocket();
}

process.on("SIGINT", () => {
  stopped = true;
  clearTimeout(reconnectTimer);
  console.log("\nCerrando ZENTRAX MD...");
  rl.close();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error(
    "❌ Error asíncrono:",
    error?.message || error
  );
});

main().catch((error) => {
  console.error(
    "❌ Error iniciando ZENTRAX MD:",
    error.stack || error
  );

  rl.close();
  process.exitCode = 1;
});
