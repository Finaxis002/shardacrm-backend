import nodemailer from "nodemailer";
import logger from "./logger.js";

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 0);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(
    process.env.SMTP_FROM || process.env.SMTP_USER || "",
  ).trim();

  if (!host || !port || !user || !pass || !from) {
    throw new Error("SMTP settings are not fully configured");
  }

  return { host, port, user, pass, from };
};

const createTransporter = () => {
  const { host, port, user, pass } = getSmtpConfig();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

export const sendEmail = async ({ to, bcc = [], subject, text, html }) => {
  if (!to) throw new Error("Missing required email recipient");
  if (!subject) throw new Error("Missing required email subject");
  if (!text && !html) throw new Error("Missing email body text or html");

  const { from } = getSmtpConfig();
  const transporter = createTransporter();

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
  };

  if (Array.isArray(bcc) && bcc.length) {
    mailOptions.bcc = bcc;
  }

  const info = await transporter.sendMail(mailOptions);
  logger.info(
    `SMTP email sent to ${to}${Array.isArray(bcc) && bcc.length ? ` + ${bcc.length} bcc` : ""}`,
  );
  return info;
};

export const sendReminderEmails = async ({
  recipients,
  subject,
  message,
  actionUrl,
}) => {
  if (!Array.isArray(recipients) || recipients.length === 0) return [];

  const bodyHtml = [`<p>${String(message || "").replace(/\n/g, "<br/>")}</p>`];
  if (actionUrl) {
    bodyHtml.push(`<p><a href="${actionUrl}">View reminder</a></p>`);
  }

  const sendTasks = recipients
    .filter((recipient) => recipient?.email)
    .map(async (recipient) => {
      const personalizedText = `Hi ${recipient.name || "there"},\n\n${message}`;
      const personalizedHtml = `<p>Hi ${recipient.name || "there"},</p>${bodyHtml.join("")}`;

      return sendEmail({
        to: recipient.email,
        subject,
        text: personalizedText,
        html: personalizedHtml,
      });
    });

  const results = await Promise.allSettled(sendTasks);
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      logger.warn(
        `Reminder email failed for recipient ${recipients[idx]?.email}: ${result.reason?.message || result.reason}`,
      );
    }
  });

  return results.filter((result) => result.status === "fulfilled");
};
