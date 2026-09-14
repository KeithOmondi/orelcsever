import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env';

const brevo = new BrevoClient({ apiKey: env.BREVO_API_KEY });

// Existing OTP email function - unchanged
export const sendOtpEmail = async (
  to: string,
  fullName: string,
  otp: string,
  expiryMinutes: number,
  logoUrl?: string
): Promise<void> => {
  const defaultLogo = logoUrl || 'https://res.cloudinary.com/do0yflasl/image/upload/v1784363826/ORHC_L_crclut.jpg';

  await brevo.transactionalEmails.sendTransacEmail({
    sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
    to: [{ email: to, name: fullName }],
    subject: `${otp} is your ORHC verification code`,
    textContent: `Hi ${fullName},\n\nYour verification code is: ${otp}\n\nThis code will expire in ${expiryMinutes} minutes.\n\nIf you did not request this code, please ignore this email.`,
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verification Code</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 40px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
                
                <!-- HEADER / BRANDING -->
                <tr>
                  <td align="center" style="background-color: #2D6A37; padding: 32px 20px 24px 20px;">
                    <img src="${defaultLogo}" alt="ORHC Logo" width="140" style="display: block; max-width: 140px; height: auto; margin-bottom: 12px;" />
                    <h1 style="color: #ffffff; font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.5px;">OFFICE OF THE REGISTRAR</h1>
                  </td>
                </tr>

                <!-- MAIN CONTENT -->
                <tr>
                  <td style="padding: 40px 32px 32px 32px; color: #333333;">
                    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1a1a1a;">Verification Code</h2>
                    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.5; color: #555555;">
                      Hi <strong>${fullName}</strong>,
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.5; color: #555555;">
                      Use the code below to complete your login verification.
                    </p>

                    <!-- OTP BOX -->
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                      <tr>
                        <td align="center" style="background-color: #F8F9FA; border: 2px dashed #C5A059; border-radius: 8px; padding: 20px;">
                          <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #2D6A37; display: block;">
                            ${otp}
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- EXPIRY WARNING -->
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #666666; line-height: 1.4;">
                      ⏱️ This code will expire in <strong style="color: #2D6A37;">${expiryMinutes} minutes</strong>.
                    </p>
                    
                    <p style="margin: 0; font-size: 13px; color: #888888; line-height: 1.4;">
                      If you did not request this login code, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="background-color: #fafafa; border-top: 1px solid #eeeeee; padding: 20px 32px; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #999999; line-height: 1.4;">
                      &copy; ${new Date().getFullYear()} Office of the Registrar. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });
};

// NEW: Submission confirmation email
export const sendSubmissionConfirmation = async (
  to: string,
  fullName: string,
  station: string,
  fileFoldersTotal: number,
  registersTotal: number,
  submissionId?: string,
  logoUrl?: string
): Promise<void> => {
  const defaultLogo = logoUrl || 'https://res.cloudinary.com/do0yflasl/image/upload/v1784363826/ORHC_L_crclut.jpg';

  await brevo.transactionalEmails.sendTransacEmail({
    sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
    to: [{ email: to, name: fullName }],
    subject: `Station Requirements Submission Confirmed - ${station}`,
    textContent: `Your Honor,\n\nYour station requirements submission for ${station} has been successfully submitted.\n\nSubmission Details:\n- Station: ${station}\n- File Folders Required: ${fileFoldersTotal}\n- Registers Required: ${registersTotal}\n- Submission ID: ${submissionId || 'N/A'}\n\nThank you for using the ORHC Station Requirements System.\n\nOffice of the Registrar`,
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Submission Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 40px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
                
                <!-- HEADER / BRANDING -->
                <tr>
                  <td align="center" style="background-color: #2D6A37; padding: 32px 20px 24px 20px;">
                    <img src="${defaultLogo}" alt="ORHC Logo" width="140" style="display: block; max-width: 140px; height: auto; margin-bottom: 12px;" />
                    <h1 style="color: #ffffff; font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.5px;">OFFICE OF THE REGISTRAR</h1>
                  </td>
                </tr>

                <!-- MAIN CONTENT -->
                <tr>
                  <td style="padding: 40px 32px 32px 32px; color: #333333;">
                    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1a1a1a;">Submission Confirmed</h2>
                    
                    <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.5; color: #555555;">
                      Your Honor,
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.5; color: #555555;">
                      Your station requirements submission for <strong style="color: #2D6A37;">${station}</strong> has been successfully submitted.
                    </p>

                    <!-- SUBMISSION DETAILS -->
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; background-color: #F8F9FA; border-radius: 8px; border-left: 4px solid #C5A059;">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666; width: 45%;">Station:</td>
                              <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333333;">${station}</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">File Folders Required:</td>
                              <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333333;">${fileFoldersTotal}</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Registers Required:</td>
                              <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333333;">${registersTotal}</td>
                            </tr>
                            ${submissionId ? `
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Submission ID:</td>
                              <td style="padding: 4px 0; font-size: 13px; font-weight: 500; color: #555555; word-break: break-all;">${submissionId}</td>
                            </tr>
                            ` : ''}
                            <tr>
                              <td style="padding: 4px 0; font-size: 14px; color: #666666;">Date Submitted:</td>
                              <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #333333;">${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- THANK YOU MESSAGE -->
                    <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.5; color: #555555;">
                      Thank you for using the ORHC Station Requirements System.
                    </p>
                    
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #666666; line-height: 1.4;">
                      A copy of this submission has been saved to the system. You may review it anytime by logging into your account.
                    </p>

                    <p style="margin: 0; font-size: 13px; color: #888888; line-height: 1.4;">
                      If you have any questions, please contact the Office of the Registrar.
                    </p>
                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="background-color: #fafafa; border-top: 1px solid #eeeeee; padding: 20px 32px; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #999999; line-height: 1.4;">
                      &copy; ${new Date().getFullYear()} Office of the Registrar. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });
};