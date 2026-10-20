
export default {
  name: "info",
  aliases: ["bot", "creador"],
  description: "Muestra información de ZENTRAX MD",

  async execute(sock, message) {
    const jid = message.key.remoteJid;

    const info = `
╭━━━〔 ZENTRAX MD 〕━━━╮
┃ 🤖 Bot: ZENTRAX MD
┃ 👑 Creador: ANGEL OFC DEV
┃ ⚙️ Tipo: WhatsApp Multi-Device
┃ 📦 Versión: 1.0.0
┃
┃ 🚀 Desarrollado para automatizar
┃ tareas y responder comandos.
╰━━━━━━━━━━━━━━━━━━╯
`.trim();

    await sock.sendMessage(jid, { text: info });
  }
};
