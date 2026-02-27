import type { NotificationAdapter, NotificationPayload } from "./types.js";

interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
}

function getNtfyConfig(): NtfyConfig | null {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;

  return {
    url: process.env.NTFY_URL ?? "https://ntfy.sh",
    topic,
    token: process.env.NTFY_TOKEN,
  };
}

export class PushNotificationAdapter implements NotificationAdapter {
  readonly name = "push";

  async send(payload: NotificationPayload): Promise<boolean> {
    const config = getNtfyConfig();
    if (!config) {
      console.error("[push] NTFY_TOPIC no configurado");
      return false;
    }

    const url = `${config.url}/${config.topic}`;
    const headers: Record<string, string> = {
      Title: payload.title,
      Priority: "high",
      Tags: "robot",
    };

    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: payload.message,
      });
      return resp.ok;
    } catch (err) {
      console.error("[push] Error enviando:", err);
      return false;
    }
  }
}
