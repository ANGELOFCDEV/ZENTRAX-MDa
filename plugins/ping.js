
export default {
  name: "ping",
  aliases: [],
  description: "Comprueba si ZENTRAX MD está activo",

  async execute(sock, message) {
    const jid = message.key.remoteJid;

    await sock.sendMessage(jid, {
      text: "🏓 Pong!\n⚡ ZENTRAX MD está activo.\n👑 By ANGEL OFC DEV"
    });
  }
};
