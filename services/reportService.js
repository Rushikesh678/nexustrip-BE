const PDFDocument = require('pdfkit');

function formatCurrency(amount, currency = 'INR') {
  const num = Number(amount || 0);
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const currUpper = (currency || 'INR').toUpperCase();
  if (currUpper === 'INR' || currUpper === 'RS' || currUpper === 'RUPEE' || currUpper === 'USD') {
    return `Rs. ${formatted}`;
  } else if (currUpper === 'EUR') {
    return `EUR ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (currUpper === 'GBP') {
    return `GBP ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `Rs. ${formatted}`;
}

function formatDate(dateVal) {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function generateTripPDFReport(trip, participants = [], expenses = [], bookings = [], settlement = {}, res) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `TripLedger Report - ${trip?.name || 'Trip'}`,
      Author: 'TripLedger Financial System',
      Subject: 'Trip Expense Ledger & Settlement Statement'
    }
  });

  const tripName = trip?.name || 'Trip';
  const safeName = tripName.replace(/[^a-zA-Z0-9_-]/g, '_');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="TripLedger_${safeName}_Statement.pdf"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

  doc.pipe(res);

  const rawCurr = (trip?.currency || 'INR').toUpperCase();
  const currency = (rawCurr === 'USD' || !rawCurr) ? 'INR' : rawCurr;

  // Helper for checking page overflow before a section
  const ensureSpace = (neededHeight) => {
    if (doc.y + neededHeight > doc.page.height - 50) {
      doc.addPage();
    }
  };

  // --- HEADER SECTION ---
  doc.rect(40, 40, 515, 60).fill('#0f172a');

  doc.fontSize(18).fillColor('#ffffff').text('TRIPLEDGER FINANCIAL STATEMENT', 55, 52, {
    characterSpacing: 0.5
  });

  doc.fontSize(10).fillColor('#94a3b8').text(
    `Official Trip Expense & Settlement Audit Report`,
    55,
    76
  );

  doc.fontSize(9).fillColor('#cbd5e1').text(
    `Exported: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    350,
    76,
    { align: 'right', width: 190 }
  );

  doc.y = 115;

  // --- TRIP METADATA CARD ---
  doc.rect(40, 115, 515, 65).lineWidth(1).strokeColor('#e2e8f0').fillAndStroke('#f8fafc', '#e2e8f0');

  doc.fontSize(14).fillColor('#0f172a').text(tripName, 55, 125, { bold: true });

  const dateRangeStr = `${formatDate(trip?.start_date)}  to  ${formatDate(trip?.end_date)}`;
  doc.fontSize(10).fillColor('#475569')
    .text(`Destination: ${trip?.destination || 'Not Specified'}`, 55, 145)
    .text(`Dates: ${dateRangeStr}`, 55, 160)
    .text(`Currency: ${currency.toUpperCase()}`, 340, 145)
    .text(`Members: ${participants.length} registered`, 340, 160);

  doc.y = 195;

  // --- FINANCIAL EXECUTIVE SUMMARY ---
  const totalExpenseCost = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalBookingCost = bookings.reduce((sum, b) => sum + (Number(b.total_cost) || 0), 0);
  const grandTotal = totalExpenseCost + totalBookingCost;
  const perPersonAvg = participants.length > 0 ? grandTotal / participants.length : 0;
  const budget = Number(trip?.budget) || 0;

  doc.fontSize(12).fillColor('#1e293b').text('1. FINANCIAL EXECUTIVE SUMMARY', 40, doc.y);
  doc.moveDown(0.4);

  // 4 Metric Badges
  const badgeWidth = 120;
  const badgeGap = 11;
  const startX = 40;
  const badgeY = doc.y;

  const metrics = [
    { label: 'TOTAL EXPENSES', value: formatCurrency(totalExpenseCost, currency), sub: `${expenses.length} expense items` },
    { label: 'TOTAL BOOKINGS', value: formatCurrency(totalBookingCost, currency), sub: `${bookings.length} reservations` },
    { label: 'GRAND TOTAL', value: formatCurrency(grandTotal, currency), sub: budget > 0 ? `${Math.round((grandTotal / budget) * 100)}% of budget` : 'Consolidated cost' },
    { label: 'PER-PERSON SHARE', value: formatCurrency(perPersonAvg, currency), sub: `Across ${participants.length} members` }
  ];

  metrics.forEach((m, idx) => {
    const x = startX + idx * (badgeWidth + badgeGap);
    doc.rect(x, badgeY, badgeWidth, 54).lineWidth(1).strokeColor('#cbd5e1').fillAndStroke('#ffffff', '#cbd5e1');
    doc.fontSize(7.5).fillColor('#64748b').text(m.label, x + 6, badgeY + 8, { width: badgeWidth - 12, align: 'center' });
    doc.fontSize(11).fillColor('#0f172a').text(m.value, x + 6, badgeY + 22, { width: badgeWidth - 12, align: 'center' });
    doc.fontSize(7).fillColor('#94a3b8').text(m.sub, x + 6, badgeY + 38, { width: badgeWidth - 12, align: 'center' });
  });

  doc.y = badgeY + 68;

  // --- CATEGORY BREAKDOWN ---
  const byCategory = {
    ACCOMMODATION: 0,
    FOOD: 0,
    TRANSPORT: 0,
    ACTIVITY: 0,
    OTHER: 0
  };

  expenses.forEach(e => {
    const cat = (e.category || 'OTHER').toUpperCase();
    byCategory[cat] = (byCategory[cat] || 0) + (Number(e.amount) || 0);
  });

  bookings.forEach(b => {
    const cat = b.type === 'accommodation' ? 'ACCOMMODATION' :
                b.type === 'transportation' ? 'TRANSPORT' :
                b.type === 'activity' ? 'ACTIVITY' :
                b.type === 'meal' ? 'FOOD' : 'OTHER';
    byCategory[cat] = (byCategory[cat] || 0) + (Number(b.total_cost) || 0);
  });

  doc.fontSize(12).fillColor('#1e293b').text('2. SPENDING BREAKDOWN BY CATEGORY', 40, doc.y);
  doc.moveDown(0.4);

  const catY = doc.y;
  const catEntries = Object.entries(byCategory);
  const catCardWidth = (515 - (catEntries.length - 1) * 8) / catEntries.length;

  catEntries.forEach(([cat, amount], idx) => {
    const x = 40 + idx * (catCardWidth + 8);
    const pct = grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0;
    doc.rect(x, catY, catCardWidth, 42).lineWidth(1).strokeColor('#e2e8f0').fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fontSize(7.5).fillColor('#475569').text(cat, x + 4, catY + 6, { width: catCardWidth - 8, align: 'center' });
    doc.fontSize(9.5).fillColor('#0f172a').text(formatCurrency(amount, currency), x + 4, catY + 18, { width: catCardWidth - 8, align: 'center' });
    doc.fontSize(7).fillColor('#64748b').text(`${pct}% of total`, x + 4, catY + 30, { width: catCardWidth - 8, align: 'center' });
  });

  doc.y = catY + 54;

  // --- PARTICIPANT FINANCIAL LEDGER ---
  ensureSpace(120);

  doc.fontSize(12).fillColor('#1e293b').text('3. PARTICIPANT FINANCIAL LEDGER', 40, doc.y);
  doc.moveDown(0.4);

  // Table Header
  const tableHeaderY = doc.y;
  doc.rect(40, tableHeaderY, 515, 20).fill('#f1f5f9');
  doc.fontSize(8.5).fillColor('#475569')
    .text('MEMBER / EMAIL', 50, tableHeaderY + 5, { width: 170 })
    .text('TOTAL PAID', 230, tableHeaderY + 5, { width: 90, align: 'right' })
    .text('TOTAL OWED', 330, tableHeaderY + 5, { width: 90, align: 'right' })
    .text('NET POSITION', 430, tableHeaderY + 5, { width: 115, align: 'right' });

  doc.y = tableHeaderY + 22;

  participants.forEach((p, idx) => {
    ensureSpace(24);
    const rowY = doc.y;
    const isEven = idx % 2 === 0;

    if (isEven) {
      doc.rect(40, rowY, 515, 20).fill('#ffffff');
    } else {
      doc.rect(40, rowY, 515, 20).fill('#f8fafc');
    }

    const net = Math.round(((p.balance !== undefined ? p.balance : ((p.total_paid || 0) - (p.total_owed || 0)))) * 100) / 100;
    const netFormatted = formatCurrency(Math.abs(net), currency);

    let statusText = 'Settled (Even)';
    let statusColor = '#059669';

    if (net > 0.01) {
      statusText = `Gets back ${netFormatted}`;
      statusColor = '#059669';
    } else if (net < -0.01) {
      statusText = `Owes ${netFormatted}`;
      statusColor = '#dc2626';
    }

    doc.fontSize(9).fillColor('#0f172a').text(p.name || 'Member', 50, rowY + 5, { width: 170 });
    doc.fontSize(9).fillColor('#334155').text(formatCurrency(p.total_paid || 0, currency), 230, rowY + 5, { width: 90, align: 'right' });
    doc.fontSize(9).fillColor('#334155').text(formatCurrency(p.total_owed || 0, currency), 330, rowY + 5, { width: 90, align: 'right' });
    doc.fontSize(9).fillColor(statusColor).text(statusText, 430, rowY + 5, { width: 115, align: 'right' });

    doc.y = rowY + 20;
  });

  doc.y += 12;

  // --- REQUIRED SETTLEMENT TRANSACTIONS ---
  ensureSpace(100);

  doc.fontSize(12).fillColor('#1e293b').text('4. REQUIRED SETTLEMENT INSTRUCTIONS', 40, doc.y);
  doc.moveDown(0.4);

  const txList = settlement?.transactions_required || [];

  if (txList.length > 0) {
    txList.forEach((tx, idx) => {
      ensureSpace(26);
      const txY = doc.y;

      const fromName = participants.find(p => String(p._id) === String(tx.from_participant))?.name || 'Debtor';
      const toName = participants.find(p => String(p._id) === String(tx.to_participant))?.name || 'Creditor';

      doc.rect(40, txY, 515, 22).lineWidth(1).strokeColor('#e2e8f0').fillAndStroke('#ffffff', '#e2e8f0');

      doc.fontSize(9).fillColor('#0f172a').text(`${idx + 1}. ${fromName}`, 50, txY + 6);
      doc.fontSize(9).fillColor('#64748b').text('pays', 180, txY + 6);
      doc.fontSize(9).fillColor('#0f172a').text(toName, 215, txY + 6);
      doc.fontSize(9.5).fillColor('#059669').text(formatCurrency(tx.amount, currency), 360, txY + 5, { width: 90, align: 'right', bold: true });
      doc.fontSize(8).fillColor('#64748b').text(`[${tx.status || 'PENDING'}]`, 460, txY + 6, { width: 85, align: 'right' });

      doc.y = txY + 24;
    });
  } else {
    doc.rect(40, doc.y, 515, 26).fill('#ecfdf5');
    doc.fontSize(9.5).fillColor('#059669').text(
      'All balances are settled and balanced! No outstanding settlement transfers required.',
      50,
      doc.y + 7
    );
    doc.y += 30;
  }

  // --- FOOTER NOTE ---
  ensureSpace(40);
  doc.y += 10;
  doc.fontSize(8).fillColor('#94a3b8').text(
    `This report was generated securely by TripLedger. For inquiries or audit dispute logs, please visit your trip workspace dashboard.`,
    40,
    doc.y,
    { align: 'center', width: 515 }
  );

  doc.end();
}

module.exports = {
  generateTripPDFReport,
  formatCurrency
};
