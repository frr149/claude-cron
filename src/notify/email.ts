import type { NotificationAdapter, NotificationPayload } from "./types.js";
import * as tls from "node:tls";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName?: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const user = process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  return {
    host: "smtp.gmail.com",
    port: 465,
    user,
    pass,
    from: user,
    fromName: process.env.GMAIL_SENDER_NAME ?? "Claude Cron",
  };
}

// SMTP mínimo sobre TLS directo (puerto 465)
async function sendSmtp(
  config: SmtpConfig,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ port: config.port, host: config.host }, () => {
      let buffer = "";

      const waitForCode = (expected: number): Promise<string> =>
        new Promise((res, rej) => {
          const check = () => {
            const lineEnd = buffer.indexOf("\r\n");
            if (lineEnd === -1) return;
            const line = buffer.slice(0, lineEnd);
            buffer = buffer.slice(lineEnd + 2);
            const code = parseInt(line.slice(0, 3));
            if (code === expected) {
              res(line);
            } else {
              rej(new Error(`SMTP expected ${expected}, got: ${line}`));
            }
          };
          // Puede que ya esté en buffer
          check();
          socket.on("data", () => check());
        });

      socket.on("data", (data: Buffer) => {
        buffer += data.toString();
      });

      const send = (cmd: string) => socket.write(cmd + "\r\n");

      (async () => {
        await waitForCode(220);
        send(`EHLO localhost`);
        await waitForCode(250);
        send(`AUTH LOGIN`);
        await waitForCode(334);
        send(Buffer.from(config.user).toString("base64"));
        await waitForCode(334);
        send(Buffer.from(config.pass).toString("base64"));
        await waitForCode(235);
        send(`MAIL FROM:<${config.from}>`);
        await waitForCode(250);
        send(`RCPT TO:<${to}>`);
        await waitForCode(250);
        send("DATA");
        await waitForCode(354);

        const fromHeader = config.fromName
          ? `"${config.fromName}" <${config.from}>`
          : config.from;

        const msg = [
          `From: ${fromHeader}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          `Date: ${new Date().toUTCString()}`,
          `X-Mailer: claude-cron`,
          "",
          body,
          ".",
        ].join("\r\n");

        send(msg);
        await waitForCode(250);
        send("QUIT");
        socket.end();
        resolve();
      })().catch((err) => {
        socket.destroy();
        reject(err);
      });
    });

    socket.on("error", reject);
  });
}

export class EmailNotificationAdapter implements NotificationAdapter {
  readonly name = "email";
  private targetEmail: string | null;

  constructor(targetEmail?: string) {
    this.targetEmail = targetEmail ?? null;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    const config = getSmtpConfig();
    if (!config) {
      console.error("[email] GMAIL_ADDRESS / GMAIL_APP_PASSWORD no configurados");
      return false;
    }

    const to = this.targetEmail ?? config.from;
    const subject = `[Claude Cron] ${payload.title}`;
    const body = [
      `Tarea: ${payload.taskName} (${payload.taskId})`,
      "",
      payload.message,
      "",
      "---",
      "Enviado por claude-cron",
    ].join("\n");

    try {
      await sendSmtp(config, to, subject, body);
      return true;
    } catch (err) {
      console.error("[email] Error enviando:", err);
      return false;
    }
  }
}
