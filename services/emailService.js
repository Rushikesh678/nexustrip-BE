const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = async () => {
  if (cachedTransporter) return cachedTransporter;

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });
    return cachedTransporter;
  }

  // Dev fallback: Ethereal Email test transport
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log(`[EmailService] Created temporary Ethereal test account: ${testAccount.user}`);
    cachedTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      }
    });
    return cachedTransporter;
  } catch (err) {
    console.error('[EmailService] Failed to create test email transporter:', err.message);
    return null;
  }
};

const sendWelcomeEmail = async (user) => {
  try {
    const transporter = await getTransporter();
    if (!transporter) return;

    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || '"TripLedger Team" <welcome@tripledger.com>';
    
    const mailOptions = {
      from: fromAddress,
      to: user.email,
      subject: 'Welcome to TripLedger! 🚀 Your Expedition Begins',
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7f6f0; padding: 40px 20px; color: #122315;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #d4dec9; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
            <div style="background-color: #122315; padding: 32px 24px; text-align: center; color: #4ade80;">
              <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 1px;">TRIPLEDGER</h1>
              <p style="margin: 6px 0 0 0; color: #a3b899; font-size: 13px; text-transform: uppercase; letter-spacing: 2px;">EXPEDITION & EXPENSE MANAGER</p>
            </div>
            
            <div style="padding: 36px 32px;">
              <h2 style="font-size: 22px; color: #122315; margin-top: 0;">Welcome aboard, ${user.name}! 👋</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #4a5568;">
                Thank you for joining <strong>TripLedger</strong>. We're excited to help you plan trips, track shared expenses, and finalize group settlements effortlessly.
              </p>
              
              <div style="background-color: #f4f7f2; border-left: 4px solid #4ade80; padding: 16px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #122315;">Account Details:</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #4a5568;"><strong>Name:</strong> ${user.name}</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #4a5568;"><strong>Email:</strong> ${user.email}</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #4a5568;"><strong>Auth Provider:</strong> ${user.authProvider === 'google' ? 'Google OAuth 2.0' : 'Email & Password'}</p>
              </div>

              <div style="text-align: center; margin-top: 32px;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}" style="background-color: #4ade80; color: #122315; padding: 14px 28px; border-radius: 10px; font-weight: 700; text-decoration: none; display: inline-block; font-size: 15px;">
                  Open TripLedger Workspace →
                </a>
              </div>
            </div>

            <div style="background-color: #f7f6f0; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #718096;">
              © ${new Date().getFullYear()} TripLedger. Safe travels & clear ledgers.
            </div>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Welcome email sent to ${user.email}. MessageId: ${info.messageId}`);
    if (nodemailer.getTestMessageUrl(info)) {
      console.log(`[EmailService] Preview Email URL: ${nodemailer.getTestMessageUrl(info)}`);
    }
  } catch (err) {
    console.error(`[EmailService] Error sending welcome email to ${user.email}:`, err.message);
  }
};

const sendLoginAlertEmail = async (user, loginMethod = 'Standard') => {
  try {
    const transporter = await getTransporter();
    if (!transporter) return;

    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || '"TripLedger Security" <security@tripledger.com>';
    const now = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'medium' });

    const mailOptions = {
      from: fromAddress,
      to: user.email,
      subject: 'Security Alert: New Sign-in to your TripLedger Account 🔒',
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7f6f0; padding: 40px 20px; color: #122315;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #d4dec9; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
            <div style="background-color: #122315; padding: 24px; text-align: center; color: #4ade80;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px;">TRIPLEDGER SECURITY</h2>
            </div>
            
            <div style="padding: 32px;">
              <h3 style="font-size: 18px; color: #122315; margin-top: 0;">Hello ${user.name},</h3>
              <p style="font-size: 14px; line-height: 1.6; color: #4a5568;">
                We detected a successful sign-in to your <strong>TripLedger</strong> account.
              </p>
              
              <div style="background-color: #edf2f7; padding: 16px; border-radius: 8px; margin: 20px 0; font-size: 13px;">
                <p style="margin: 0 0 6px 0; color: #2d3748;"><strong>Sign-in Method:</strong> ${loginMethod}</p>
                <p style="margin: 0 0 6px 0; color: #2d3748;"><strong>Time:</strong> ${now} (UTC)</p>
                <p style="margin: 0; color: #2d3748;"><strong>Account Email:</strong> ${user.email}</p>
              </div>

              <p style="font-size: 13px; color: #718096; line-height: 1.5;">
                If this was you, no action is needed. If you did not sign in at this time, please secure your account immediately.
              </p>
            </div>

            <div style="background-color: #f7f6f0; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
              TripLedger Automated Security Notification
            </div>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Login alert sent to ${user.email}. MessageId: ${info.messageId}`);
    if (nodemailer.getTestMessageUrl(info)) {
      console.log(`[EmailService] Preview Email URL: ${nodemailer.getTestMessageUrl(info)}`);
    }
  } catch (err) {
    console.error(`[EmailService] Error sending login alert to ${user.email}:`, err.message);
  }
};

module.exports = {
  sendWelcomeEmail,
  sendLoginAlertEmail
};
