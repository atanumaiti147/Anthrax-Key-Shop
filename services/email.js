const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

// Create transporter using Hostinger SMTP (SSL/TLS on port 465)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'host3.xhost.co.in',
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: true, // use SSL (port 465)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

module.exports.sendEmail = async (to, subject, templateData) => {
  try {
    // Render the email template
    const templatePath = path.join(__dirname, '../views/emails/purchase.ejs');
    const html = await ejs.renderFile(templatePath, templateData);

    const mailOptions = {
      from: `"${process.env.SHOP_NAME || 'Key Shop'}" <${process.env.EMAIL_USER}>`,
      to,
      subject: subject,
      html: html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId);
    return info;
  } catch (err) {
    console.error('❌ Email error:', err);
    throw err;
  }
};