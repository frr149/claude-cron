import notifier from "node-notifier";
import type { NotificationAdapter, NotificationPayload } from "./types.js";

export class DesktopNotificationAdapter implements NotificationAdapter {
  readonly name = "notification";

  async send(payload: NotificationPayload): Promise<boolean> {
    return new Promise((resolve) => {
      notifier.notify(
        {
          title: payload.title,
          message: payload.message,
          sound: true,
          timeout: 10,
        },
        (err) => {
          resolve(!err);
        },
      );
    });
  }
}
