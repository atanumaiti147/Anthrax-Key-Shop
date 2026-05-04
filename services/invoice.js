const PDFDocument = require('pdfkit');
const axios = require('axios');   // 🆕 for fetching image as buffer

module.exports.generateInvoice = async (res, order, settings) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.razorpayOrderId}.pdf`);
  doc.pipe(res);

  const shopName = settings.siteName || 'Key Shop';
  const logoUrl = process.env.INVOICE_LOGO_URL || settings.logoUrl || null;
  const createdDate = new Date(order.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const days = Math.ceil((new Date(order.keyDetails.expiryDate) - new Date(order.createdAt)) / (1000 * 60 * 60 * 24));

  const primary = '#ef1f1f';
  const dark = '#1e293b';
  const grey = '#64748b';
  const lightGrey = '#cbd5e1';

  // ---------- Logo (fetch buffer for reliability) ----------
  const logoX = 50, logoY = 45, logoWidth = 40;
  let logoBuffer = null;

  if (logoUrl) {
    try {
      const response = await axios.get(logoUrl, {
        responseType: 'arraybuffer',
        timeout: 5000
      });
      if (response.status === 200) {
        logoBuffer = Buffer.from(response.data);
        doc.image(logoBuffer, logoX, logoY, { width: logoWidth });
        console.log('✅ Invoice logo loaded from buffer');
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch logo URL:', logoUrl, err.message);
    }
  }

  // Fallback monogram
  if (!logoBuffer) {
    doc.circle(logoX + logoWidth / 2, logoY + logoWidth / 2, logoWidth / 2)
       .fillAndStroke(primary, primary);
    doc.fontSize(16).fillColor('white').font('Helvetica-Bold');
    const text = shopName.substring(0, 2).toUpperCase() || 'KS';
    const textWidth = doc.widthOfString(text);
    doc.text(text, logoX + (logoWidth - textWidth) / 2, logoY + 8);
  }

  // Company name
  doc.fontSize(22).fillColor(primary).font('Helvetica-Bold');
  doc.text(shopName, 100, 50);
  doc.fontSize(9).fillColor(grey).font('Helvetica');
  doc.text('Premium License Keys', 100, 75);

  // Right side block
  doc.fontSize(28).fillColor(dark).font('Helvetica-Bold');
  doc.text('INVOICE', 300, 50, { align: 'right', width: 240 });
  doc.fontSize(9).fillColor(grey).font('Helvetica');
  doc.text(`Order ID: ${order.razorpayOrderId}`, 300, 80, { align: 'right', width: 240 });
  doc.text(`Date: ${createdDate}`, 300, 92, { align: 'right', width: 240 });

  doc.moveTo(50, 110).lineTo(545, 110).strokeColor(primary).lineWidth(1).stroke();

  // Bill To
  doc.fontSize(10).fillColor(dark).font('Helvetica-Bold');
  doc.text('Bill To:', 50, 125, { underline: true });
  doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
  doc.text(`Email: ${order.email || 'N/A'}`, 50, 143);
  doc.text(`Discord: ${order.discordUsername || order.discordId || 'N/A'}`, 50, 159);

  // Table
  const tableTop = 195;
  doc.fontSize(9).fillColor(grey).font('Helvetica-Bold');
  doc.text('Description', 50, tableTop, { width: 200 });
  doc.text('Qty', 280, tableTop, { width: 40, align: 'center' });
  doc.text('Unit Price', 340, tableTop, { width: 70, align: 'right' });
  doc.text('Amount', 450, tableTop, { width: 80, align: 'right' });
  doc.moveTo(50, tableTop + 12).lineTo(545, tableTop + 12).strokeColor(lightGrey).stroke();

  let y = tableTop + 22;
  const unitPrice = (order.amount / Math.max(1, days)).toFixed(2);
  const formatPrice = (val) => `Rs.${Number(val).toFixed(2)}`;

  doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
  doc.text(`License Key (${days} day${days > 1 ? 's' : ''})`, 50, y, { width: 200 });
  doc.text('1', 280, y, { width: 40, align: 'center' });
  doc.text(formatPrice(unitPrice), 340, y, { width: 70, align: 'right' });
  doc.text(formatPrice(order.amount), 450, y, { width: 80, align: 'right' });

  y += 22;
  if (order.discountAmount > 0) {
    doc.text(`Coupon: ${order.couponCode}`, 50, y, { width: 200 });
    doc.text('', 280, y);
    doc.text(`-${formatPrice(order.discountAmount)}`, 340, y, { width: 70, align: 'right' });
    doc.text(`-${formatPrice(order.discountAmount)}`, 450, y, { width: 80, align: 'right' });
    y += 20;
  }

  y += 8;
  doc.moveTo(350, y).lineTo(545, y).strokeColor(primary).lineWidth(1.5).stroke();
  y += 10;
  doc.fontSize(12).fillColor(dark).font('Helvetica-Bold');
  doc.text('Total', 350, y, { width: 100 });
  doc.text(formatPrice(order.amount), 450, y, { width: 80, align: 'right' });

  doc.moveDown(3);
  doc.fontSize(8).fillColor(grey).font('Helvetica');
  doc.text('This is a computer‑generated invoice.', { align: 'center' });
  doc.text(`Generated on ${new Date().toLocaleString()}`, { align: 'center' });
  doc.text(`Thank you for choosing ${shopName}!`, { align: 'center', margin: 5 });

  doc.end();
};