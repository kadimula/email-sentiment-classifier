import { task, logger } from "@trigger.dev/sdk";
import { Resend } from "resend";

export const sendEmail = task({
  id: "send-email",
  run: async (payload: { to: string; name?: string }) => {
    const name = payload.name ?? "World";
    const from = process.env.EMAIL_FROM ?? "Acme <onboarding@resend.dev>";

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from,
      to: payload.to,
      subject: `Hello, ${name}!`,
      html: `<p>Hello, ${name}! 👋</p><p>Thanks for submitting the Hello World form.</p>`,
    });

    if (error) {
      logger.error("Failed to send email", { error, to: payload.to });
      throw new Error(error.message);
    }

    logger.info("Email sent", { id: data?.id, to: payload.to });
    return { id: data?.id, to: payload.to };
  },
});
