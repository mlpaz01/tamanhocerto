// Notificações ao owner — versão self-hosted (stub).
// A plataforma Manus oferecia um serviço de notificação; aqui apenas registramos
// no log. Para enviar e-mail/Slack, integre seu provedor preferido neste ponto.

export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const title = (payload.title ?? "").trim();
  const content = (payload.content ?? "").trim();
  if (!title || !content) return false;
  console.log(`[Notification] (owner) ${title}: ${content}`);
  return true;
}
