
export default {
  name: "menu",
  aliases: ["help", "ayuda"],
  description: "Muestra el menú de ZENTRAX MD",

  async execute(sock, message) {
    const jid = message.key.remoteJid;

    const menu = `
╭━━━〔 ZENTRAX MD 〕━━━╮
┃ 👑 Creador: ANGEL OFC DEV
┃
┃ 📌 COMANDOS
┃ • !menu
┃ • !ping
┃ • !estado
┃
┃ 🛠️ PRÓXIMAMENTE
┃ • Stickers
┃ • Administración
┃ • Inteligencia artificial
╰━━━━━━━━━━━━━━━━━━╯
`.trim();

    await sock.sendMessage(jid, { text: menu });
  }
};
