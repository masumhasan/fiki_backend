import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.OTP_EMAIL || "info@fikitransit.com",
    pass: process.env.OTP_APP_PASSWORD || "2esu-8aum-4do6-7w4r",
  },
  tls: {
    rejectUnauthorized: false,
  },
});

/**
 * Send Password Reset OTP Email via Hostinger SMTP
 */
export async function sendPasswordResetOtpEmail(
  toEmail: string,
  otp: string,
  recipientName = "Valued User"
): Promise<boolean> {
  const fromEmail = process.env.OTP_EMAIL || "info@fikitransit.com";

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Fiki Transit Password Reset OTP</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fb; margin: 0; padding: 20px; color: #172033; }
        .card { max-width: 520px; margin: 30px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(8, 37, 82, 0.08); border: 1px solid #e1e6ee; }
        .header { background: #082552; padding: 28px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
        .body { padding: 32px 28px; text-align: center; }
        .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #172033; text-align: left; }
        .text { font-size: 14px; line-height: 1.6; color: #52647e; margin-bottom: 24px; text-align: left; }
        .otp-box { background: #f0f4fa; border: 2px dashed #082552; border-radius: 12px; padding: 18px; margin: 24px 0; text-align: center; }
        .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #082552; font-family: monospace; }
        .expiry { font-size: 12px; font-weight: 600; color: #ef4444; margin-top: 8px; }
        .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #8b95a7; border-top: 1px solid #edf2f7; }
        .footer p { margin: 4px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>FIKI TRANSIT</h1>
        </div>
        <div class="body">
          <div class="greeting">Hello ${recipientName},</div>
          <div class="text">
            We received a request to reset the password for your <strong>Fiki Transit</strong> account. Use the 6-digit verification code below to complete your password reset:
          </div>
          
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
            <div class="expiry">Expires in 10 minutes</div>
          </div>
          
          <div class="text">
            If you did not request a password reset, please ignore this email or contact support if you have concerns about your account security.
          </div>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Fiki Transit. All rights reserved.</p>
          <p>This is an automated security message. Please do not reply directly to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Fiki Transit Security" <${fromEmail}>`,
      to: toEmail,
      subject: `${otp} is your Fiki Transit password reset code`,
      html: htmlContent,
    });

    console.log(`[EMAIL] Password reset OTP email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("[EMAIL ERROR] Failed to send OTP email via Hostinger SMTP:", error, toEmail);
    return false;
  }
}
