
export default {
  name: "tagall",
  aliases: ["invocar"],
  description: "Menciona a los participantes del grupo",

  async execute(sock, message) {
    const jid = message.key.remoteJid;

    if (!jid.endsWith("@g.us")) {
      await sock.sendMessage(jid, {
        text: "❌ Este comando solo funciona en grupos."
      });
      return;
    }

    const metadata = await sock.groupMetadata(jid);
    const sender = message.key.participant;
    const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";

    const admins = metadata.participants
      .filter(p => p.admin === "admin" || p.admin === "superadmin")
      .map(p => p.id);

    const isAdmin = admins.includes(sender);
    const botIsAdmin = metadata.participants.some(p =>
      p.id.split(":")[0] === sock.user.id.split(":")[0] &&
      (p.admin === "admin" || p.admin === "superadmin")
    );

    if (!isAdmin) {
      await sock.sendMessage(jid, {
        text: "⛔ Solo los administradores del grupo pueden usar este comando."
      });
      return;
    }

    if (!botIsAdmin) {
      await sock.sendMessage(jid, {
        text: "⚠️ Necesito ser administrador del grupo para utilizar esta función."
      });
      return;
    }

    const mentions = metadata.participants.map(p => p.id);

    await sock.sendMessage(jid, {
      text: "📢 Atención, participantes del grupo:\n\n" +
        mentions.map(id => `@${id.split("@")[0]}`).join("\n"),
      mentions
    });
  }
};
