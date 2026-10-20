
export default {
  name: "estado",
  aliases: ["status"],
  description: "Muestra el estado del bot",

  async execute(sock, message) {
    const jid = message.key.remoteJid;
    const isGroup = jid.endsWith("@g.us");

    const texto = `
╭━━━〔 ESTADO 〕━━━╮
┃ 🤖 Bot: ZENTRAX MD
┃ 🟢 Servicio: comando disponible
┃ 📡 Conexión: mensaje recibido
┃ 💬 Tipo de chat: ${isGroup ? "Grupo" : "Privado"}
┃ 👑 By: ANGEL OFC DEV
╰━━━━━━━━━━━━━━━━╯
`.trim();

    await sock.sendMessage(jid, { text: texto });
  }
};
