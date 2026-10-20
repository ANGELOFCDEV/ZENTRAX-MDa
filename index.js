
import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_NAME = process.env.BOT_NAME || "ZENTRAX MD";
const OWNER = "ANGEL OFC DEV";
const PREFIX = "!";
const PORT = Number(process.env.PORT || 3000);

const DASHBOARD_KEY =
  process.env.DASHBOARD_KEY ||
  crypto.randomBytes(24).toString("hex");

const plugins = new Map();

let sock = null;
let authState = null;
let saveCreds = null;
let botStatus = "Esperando que elijas un método";
let qrValue = "";
let pairingCode = "";
let connectionMethod = "";
let pairingNumber = "";
let pairingRequested = false;
let starting = false;
let reconnectTimer = null;
let pluginsLoaded = false;

async function loadPlugins() {
  if (pluginsLoaded) return;

  const dir = path.join(__dirname, "plugins");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;

    try {
      const fileUrl = pathToFileURL(path.join(dir, file)).href;
      const imported = await import(fileUrl);
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
    } catch (error) {
      console.error(`Error cargando ${file}:`, error.message);
    }
  }

  pluginsLoaded = true;
}

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#090d18">
<title>${BOT_NAME}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#090d18;color:#eef4ff;
font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;
padding:20px}
main{width:100%;max-width:480px}
.card{background:#111a2a;border:1px solid #263750;border-radius:22px;
padding:24px;margin-bottom:16px}
.logo{width:76px;height:76px;border-radius:22px;background:#172d48;
display:grid;place-items:center;margin:auto;font-size:38px}
h1{text-align:center;font-size:36px;margin:14px 0 5px;color:#59c8ff}
.subtitle{text-align:center;color:#9eb0c9;font-size:12px;letter-spacing:2px}
.description{text-align:center;color:#bdc9da;line-height:1.6;margin:18px 0}
.owner{text-align:center;color:#59c8ff;font-weight:bold}
h2{font-size:18px;margin-top:0}
button,select,input{width:100%;padding:14px;border-radius:12px;
font-size:15px;margin-top:10px}
button{border:0;background:#168bd0;color:white;font-weight:bold;cursor:pointer}
button.secondary{background:#1d2b40;border:1px solid #354a66}
button:disabled{opacity:.5}
select,input{background:#0a1220;color:white;border:1px solid #354a66}
label{display:block;color:#b8c7da;margin-top:14px;font-size:13px}
.small{font-size:12px;color:#91a2ba;line-height:1.6}
#status{padding:12px;background:#0a1220;border-radius:10px;
color:#a9dfff;margin-top:14px;overflow-wrap:anywhere}
#result{display:none;text-align:center;margin-top:18px}
#qrcode{display:flex;justify-content:center;background:white;padding:14px;
width:max-content;max-width:100%;margin:16px auto;border-radius:12px}
#qrcode img{max-width:100%}
#code{font-size:32px;letter-spacing:5px;color:#59c8ff;font-weight:bold;
margin:20px 0;overflow-wrap:anywhere}
.hidden{display:none}
</style>
</head>
<body>
<main>
<section class="card">
<div class="logo">🤖</div>
<h1>ZENTRAX MD</h1>
<div class="subtitle">WHATSAPP AUTOMATION BOT</div>
<p class="description">Tu asistente de WhatsApp con comandos,
herramientas y funciones automatizadas.</p>
<div class="owner">By ANGEL OFC DEV 🚀</div>
</section>

<section class="card" id="login">
<h2>🔐 Acceso al panel</h2>
<p class="small">Introduce la clave privada del panel configurada
en el servidor.</p>
<input id="key" type="password" placeholder="Clave del panel"
autocomplete="off">
<button onclick="enterPanel()">Entrar</button>
</section>

<section class="card hidden" id="panel">
<h2>Selecciona cómo conectar</h2>
<button onclick="connectBot('qr')">1 · Conectar con QR</button>
<button class="secondary" onclick="showPhone()">2 · Código de vinculación</button>

<div id="phoneBox" class="hidden">
<label for="country">País del número</label>
<select id="country">
<option value="51">Perú (+51)</option>
<option value="52">México (+52)</option>
<option value="1">Estados Unidos / Canadá (+1)</option>
<option value="34">España (+34)</option>
<option value="57">Colombia (+57)</option>
<option value="54">Argentina (+54)</option>
<option value="56">Chile (+56)</option>
<option value="593">Ecuador (+593)</option>
<option value="591">Bolivia (+591)</option>
<option value="58">Venezuela (+58)</option>
<option value="other">Otro país: introducir código manualmente</option>
</select>
<div id="otherBox" class="hidden">
<label for="dial">Código de país, solo números</label>
<input id="dial" inputmode="numeric" placeholder="Ejemplo: 51">
</div>
<label for="phone">Tu número, sin prefijo de país</label>
<input id="phone" inputmode="numeric" autocomplete="off"
placeholder="Ejemplo: 987654321">
<button onclick="connectBot('pairing')">Generar código</button>
<p class="small">El país se añade automáticamente al número.
Utiliza únicamente tu propia cuenta de WhatsApp.</p>
</div>

<div id="status">Esperando conexión...</div>
<div id="result">
<div id="qrcode"></div>
<div id="code"></div>
<button class="secondary" onclick="copyCode()">Copiar código</button>
</div>
</section>
<p class="small" style="text-align:center">
ZENTRAX MD · By ANGEL OFC DEV
</p>
</main>

<script>
let secret = "";
let timer = null;

function enterPanel(){
  const value = document.getElementById("key").value.trim();
  if(!value){alert("Introduce la clave del panel.");return;}
  secret = value;
  document.getElementById("login").classList.add("hidden");
  document.getElementById("panel").classList.remove("hidden");
  refreshStatus();
}

function showPhone(){
  document.getElementById("phoneBox").classList.remove("hidden");
}

document.getElementById("country").addEventListener("change",e=>{
  document.getElementById("otherBox").classList.toggle(
    "hidden",e.target.value!=="other"
  );
});

async function api(url,options={}){
  const response = await fetch(url,{
    ...options,
    headers:{
      "Content-Type":"application/json",
      "X-Dashboard-Key":secret,
      ...(options.headers||{})
    }
  });
  const data = await response.json();
  if(!response.ok) throw new Error(data.error||"Error del servidor");
  return data;
}

async function connectBot(method){
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  result.style.display="none";

  let phone = "";

  if(method==="pairing"){
    const local = document.getElementById("phone").value.replace(/\\D/g,"");
    let dial = document.getElementById("country").value;

    if(dial==="other"){
      dial = document.getElementById("dial").value.replace(/\\D/g,"");
    }

    if(!dial || !local){
      status.textContent="Introduce el código de país y tu número.";
      return;
    }

    phone = dial + local;

    if(!/^\\d{8,15}$/.test(phone)){
      status.textContent="Revisa el número y el código de país.";
      return;
    }
  }

  status.textContent="Iniciando conexión...";
  try{
    const data = await api("/api/connect",{
      method:"POST",
      body:JSON.stringify({method,phone})
    });
    status.textContent=data.message;
    poll();
  }catch(error){
    status.textContent=error.message;
  }
}

async function refreshStatus(){
  try{
    const data=await api("/api/status");
    document.getElementById("status").textContent=data.status;

    const result=document.getElementById("result");
    const qr=document.getElementById("qrcode");
    const code=document.getElementById("code");

    if(data.qr){
      result.style.display="block";
      code.textContent="";
      qr.innerHTML="";
      if(window.QRCode){
        new QRCode(qr,{text:data.qr,width:240,height:240});
      }else{
        qr.textContent="No se pudo cargar el generador QR.";
      }
    }else if(data.pairingCode){
      result.style.display="block";
      qr.innerHTML="";
      code.textContent=data.pairingCode;
    }
  }catch(error){
    document.getElementById("status").textContent=error.message;
  }
}

function poll(){
  if(timer) clearInterval(timer);
  refreshStatus();
  timer=setInterval(refreshStatus,2500);
}

async function copyCode(){
  const code=document.getElementById("code").textContent;
  if(!code)return;
  try{
    await navigator.clipboard.writeText(code);
    alert("Código copiado.");
  }catch{
    alert("Selecciona y copia el código manualmente.");
  }
}
</script>
</body>
</html>`;

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Solicitud demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  const supplied = req.headers["x-dashboard-key"];
  return typeof supplied === "string" &&
    supplied.length === DASHBOARD_KEY.length &&
    crypto.timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(DASHBOARD_KEY)
    );
}

async function createSocket() {
  if (!authState || !saveCreds) return;

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: authState,
    logger: pino({ level: "silent" }),
    browser: [BOT_NAME, "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !authState.creds.registered) {
      if (connectionMethod === "qr") {
        qrValue = qr;
        pairingCode = "";
        botStatus = "QR listo. Escanéalo desde Dispositivos vinculados.";
      } else if (
        connectionMethod === "pairing" &&
        pairingNumber &&
        !pairingRequested
      ) {
        pairingRequested = true;
        botStatus = "Solicitando código de vinculación...";

        try {
          const code = await sock.requestPairingCode(pairingNumber);
          pairingCode = code;
          qrValue = "";
          botStatus = "Código listo. Introdúcelo en tu WhatsApp.";
        } catch (error) {
          pairingRequested = false;
          botStatus = "No se pudo generar el código. Comprueba el número e inténtalo otra vez.";
          console.error("Error solicitando código:", error.message);
        }
      }
    }

    if (connection === "connecting") {
      botStatus = "Conectando con WhatsApp...";
    }

    if (connection === "open") {
      botStatus = `${BOT_NAME} conectado correctamente.`;
      qrValue = "";
      pairingCode = "";
      starting = false;
      console.log(`${BOT_NAME} conectado.`);
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      sock = null;

      if (status === DisconnectReason.loggedOut) {
        botStatus = "Sesión cerrada. Debes vincular WhatsApp nuevamente.";
        qrValue = "";
        pairingCode = "";
        starting = false;
        return;
      }

      botStatus = "Conexión interrumpida. Intentando reconectar...";
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(async () => {
        try {
          await createSocket();
        } catch (error) {
          botStatus = "Error al reconectar. Revisa los logs del servidor.";
          starting = false;
          console.error(error.message);
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

      const parts = body.slice(PREFIX.length).trim().split(/\\s+/);
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

async function connectBot(method, phone) {
  if (starting || sock) {
    throw new Error("Ya hay una conexión iniciada. Revisa su estado.");
  }

  if (!["qr", "pairing"].includes(method)) {
    throw new Error("Método de conexión no válido.");
  }

  if (authState?.creds?.registered) {
    throw new Error("Ya existe una sesión registrada. Reinicia el servicio si necesitas reconectarla.");
  }

  if (method === "pairing" && !/^\\d{8,15}$/.test(phone)) {
    throw new Error("El número debe incluir el código de país y solo dígitos.");
  }

  starting = true;
  connectionMethod = method;
  pairingNumber = phone;
  pairingRequested = false;
  qrValue = "";
  pairingCode = "";
  botStatus = "Preparando conexión...";

  try {
    await createSocket();
    return method === "qr"
      ? "Preparando el QR..."
      : "Preparando el código de vinculación...";
  } catch (error) {
    starting = false;
    sock = null;
    botStatus = "No se pudo iniciar el bot. Revisa los logs.";
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (url.pathname.startsWith("/api/") && !authorized(req)) {
    return sendJson(res, 401, {
      error: "Clave incorrecta. Introduce la clave privada del panel."
    });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, {
      status: botStatus,
      qr: qrValue,
      pairingCode
    });
  }

  if (req.method === "POST" && url.pathname === "/api/connect") {
    try {
      const body = await readBody(req);
      const message = await connectBot(
        body.method,
        String(body.phone || "")
      );
      return sendJson(res, 200, { message });
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message || "No se pudo iniciar la conexión."
      });
    }
  }

  sendJson(res, 404, { error: "Ruta no encontrada." });
});

async function main() {
  await loadPlugins();

  const session = await useMultiFileAuthState(
    path.join(__dirname, "sessions")
  );

  authState = session.state;
  saveCreds = session.saveCreds;

  server.listen(PORT, "0.0.0.0", () => {
    console.log("====================================");
    console.log(`       ${BOT_NAME}`);
    console.log(`       By ${OWNER}`);
    console.log("====================================");
    console.log(`Panel iniciado en el puerto ${PORT}`);
    console.log("Clave privada del panel:");
    console.log(DASHBOARD_KEY);
    console.log("Abre la URL pública asignada por Railway.");
    console.log("No compartas la clave, el QR ni el código.");
    botStatus = authState.creds.registered
      ? "Sesión guardada detectada. Reinicia el servicio para reconectar."
      : "Panel listo. Elige QR o código.";
  });
}

main().catch(error => {
  console.error("Error iniciando el servidor:", error);
  process.exitCode = 1;
});
