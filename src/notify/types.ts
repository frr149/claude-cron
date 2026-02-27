export interface NotificationPayload {
  title: string;
  message: string;
  taskId: string;
  taskName: string;
}

export interface NotificationAdapter {
  readonly name: string;
  send(payload: NotificationPayload): Promise<boolean>;
}
