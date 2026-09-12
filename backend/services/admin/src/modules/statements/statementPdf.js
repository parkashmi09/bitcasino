'use strict';

const PDFDocument = require('pdfkit');

/**
 * The printable statement.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ONE RENDERER, OVER THE PAYLOAD THE JSON ENDPOINTS RETURN
 *
 * Legacy had two: `statementPdf.js` (380 lines) and `playerReportPdf.js` (147),
 * each running its OWN queries and doing its OWN arithmetic to draw the same
 * numbers. `playerReportPdf` computed sports P&L as
 *
 *     result_status === 'win' ? (odds - 1) * stake : -stake
 *
 * from the bet rows, while the statement took it from `credits_ledger`. Those
 * two disagree whenever a bet was voided, partially settled or manually
 * adjusted — so the printed report and the on-screen statement could show
 * different profit for the same player and period, with nothing to say which
 * was right.
 *
 * This takes the built payload and draws it. A disagreement between the
 * download and the screen is not expressible, which is the property legacy's
 * own comment claimed ("same builder, so print and screen can never disagree")
 * for only one of its two renderers.
 * ═════════════════════════════════════════════════════════════════════════
 */

const COLOURS = {
  ink: '#15182B',
  body: '#2D3142',
  muted: '#6B7280',
  rule: '#E3E7F0',
  headerBg: '#0E1831',
  zebra: '#F7F9FC',
  positive: '#0E9F5B',
  negative: '#D64560',
};

const PAGE = { margin: 40, width: 595.28, height: 841.89 };

/** Indian-format money, with the sign in front rather than in brackets. */
function inr(value) {
  const amount = Number(value ?? 0);
  const sign = amount < 0 ? '-' : '';
  return `${sign}Rs ${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const pnlColour = (value) => (Number(value) > 0 ? COLOURS.positive : Number(value) < 0 ? COLOURS.negative : COLOURS.body);

const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Stream a statement PDF to an Express response.
 *
 * @param {import('express').Response} res
 * @param {object} statement The payload from `agentStatement` or `userStatement`.
 */
function renderStatement(res, statement, { generatedAt = new Date() } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });

  const filename = `statement_${statement.subject.type.toLowerCase()}_${statement.subject.id}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  /**
   * The subject id is a validated integer and the type is one of two literals,
   * so there is nothing caller-controlled in this header. Saying so because a
   * filename built from user input is how header injection gets in.
   */
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  header(doc, statement, generatedAt);
  balanceBlock(doc, statement);
  gamingBlock(doc, statement);
  ledgerTable(doc, statement);
  if (statement.downline?.length) downlineTable(doc, statement);

  pageNumbers(doc);
  doc.end();

  return doc;
}

function header(doc, statement, generatedAt) {
  doc.rect(0, 0, PAGE.width, 96).fill(COLOURS.headerBg);

  doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold');
  doc.text('Account Statement', PAGE.margin, 26);

  doc.fontSize(10).font('Helvetica');
  const period =
    statement.period.from || statement.period.to
      ? `${statement.period.from ?? 'start'} to ${statement.period.to ?? 'today'}`
      : 'All time';

  doc.text(`${statement.subject.name ?? statement.subject.id} · ${statement.subject.role ?? statement.subject.type}`, PAGE.margin, 52);
  doc.fillColor('#B9C2D6').fontSize(9);
  doc.text(`Period: ${period}   ·   Generated: ${shortDate(generatedAt)}`, PAGE.margin, 70);

  doc.fillColor(COLOURS.body).font('Helvetica');
  doc.y = 116;
}

function balanceBlock(doc, statement) {
  const { balance } = statement;

  sectionTitle(doc, 'Balance');

  const pairs = [
    ['Opening (brought forward)', balance.opening],
    ['Movement in period', balance.movement],
    ['Closing', balance.closing],
    ['Live wallet', balance.live],
    ['Open exposure', balance.openExposure],
  ];

  for (const [label, value] of pairs) keyValue(doc, label, inr(value));

  /**
   * `unexplained` is printed only when it is non-zero, and it is printed in
   * red. It means money reached this wallet by a path the statement does not
   * read; hiding it would make the statement look tidier and less true.
   */
  if (Number(balance.unexplained) !== 0) {
    doc.moveDown(0.3);
    doc.fillColor(COLOURS.negative).fontSize(9).font('Helvetica-Bold');
    doc.text(`Unreconciled: ${inr(balance.unexplained)}`, PAGE.margin);
    doc.font('Helvetica').fontSize(9).fillColor(COLOURS.muted);
    doc.text('Money moved by a path this statement does not read. Shown rather than absorbed into the opening figure.', {
      width: PAGE.width - PAGE.margin * 2,
    });
    doc.fillColor(COLOURS.body);
  }

  doc.moveDown(0.8);
}

function gamingBlock(doc, statement) {
  const { gaming } = statement;
  if (!gaming) return;

  sectionTitle(doc, `Profit & loss (${gaming.total.headlineFor === 'AGENT' ? 'agent view' : 'player view'})`);

  keyValue(doc, 'Sports', inr(gaming.total.headlineSports), pnlColour(gaming.total.headlineSports));
  keyValue(doc, 'Casino', inr(gaming.total.headlineCasino), pnlColour(gaming.total.headlineCasino));

  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(pnlColour(gaming.total.headlinePnl));
  doc.text(`Total: ${inr(gaming.total.headlinePnl)}`, PAGE.margin);
  doc.font('Helvetica').fontSize(9).fillColor(COLOURS.body);

  if (gaming.counts) {
    doc.fillColor(COLOURS.muted);
    doc.text(
      `${gaming.counts.settledBets} settled sports bets · ${gaming.counts.openBets} open · ${gaming.counts.casinoBets} casino rounds`,
      PAGE.margin
    );
    doc.fillColor(COLOURS.body);
  }

  doc.moveDown(0.8);
}

function ledgerTable(doc, statement) {
  sectionTitle(doc, 'Ledger');

  const columns = [
    { key: 'ts', title: 'Date', width: 70, format: shortDate },
    { key: 'label', title: 'Description', width: 170 },
    { key: 'party', title: 'Party', width: 110 },
    { key: 'amount', title: 'Amount', width: 80, align: 'right', format: inr },
    { key: 'balance', title: 'Balance', width: 85, align: 'right', format: inr },
  ];

  table(doc, columns, statement.rows ?? []);

  const { pagination } = statement;
  if (pagination && pagination.total > (statement.rows?.length ?? 0)) {
    doc.moveDown(0.3).fillColor(COLOURS.muted).fontSize(8);
    doc.text(
      // Never let a printed page imply it is the whole story.
      `Showing ${statement.rows.length} of ${pagination.total} rows (page ${pagination.page} of ${pagination.totalPages}).`,
      PAGE.margin
    );
    doc.fillColor(COLOURS.body).fontSize(9);
  }

  doc.moveDown(0.8);
}

function downlineTable(doc, statement) {
  if (doc.y > PAGE.height - 200) doc.addPage();
  sectionTitle(doc, 'Downline');

  table(
    doc,
    [
      { key: 'name', title: 'Agent', width: 200 },
      { key: 'players', title: 'Players', width: 70, align: 'right' },
      { key: 'agentPnl', title: 'Earned', width: 100, align: 'right', format: inr },
    ],
    statement.downline
  );
}

// ── drawing primitives ──────────────────────────────────────────────────

function sectionTitle(doc, text) {
  if (doc.y > PAGE.height - 120) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOURS.ink);
  doc.text(text, PAGE.margin, doc.y);
  doc.moveTo(PAGE.margin, doc.y + 2).lineTo(PAGE.width - PAGE.margin, doc.y + 2).strokeColor(COLOURS.rule).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(COLOURS.body);
}

function keyValue(doc, label, value, colour = COLOURS.body) {
  const y = doc.y;
  doc.fillColor(COLOURS.muted).text(label, PAGE.margin, y, { width: 260 });
  doc.fillColor(colour).text(value, PAGE.margin + 260, y, { width: 200, align: 'right' });
  doc.fillColor(COLOURS.body);
  doc.y = y + 14;
}

function table(doc, columns, rows) {
  const startX = PAGE.margin;
  let y = doc.y;

  const drawHeader = () => {
    doc.rect(startX, y, PAGE.width - PAGE.margin * 2, 18).fill(COLOURS.headerBg);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    let x = startX + 4;
    for (const column of columns) {
      doc.text(column.title, x, y + 5, { width: column.width - 8, align: column.align ?? 'left' });
      x += column.width;
    }
    y += 18;
    doc.font('Helvetica').fontSize(8).fillColor(COLOURS.body);
  };

  drawHeader();

  if (!rows.length) {
    doc.fillColor(COLOURS.muted).text('No rows in this period.', startX + 4, y + 4);
    doc.fillColor(COLOURS.body);
    doc.y = y + 20;
    return;
  }

  rows.forEach((row, index) => {
    if (y > PAGE.height - 70) {
      doc.addPage();
      y = PAGE.margin;
      drawHeader();
    }

    if (index % 2 === 1) doc.rect(startX, y, PAGE.width - PAGE.margin * 2, 14).fill(COLOURS.zebra);

    let x = startX + 4;
    for (const column of columns) {
      const raw = row[column.key];
      const text = column.format ? column.format(raw) : raw == null ? '—' : String(raw);
      const colour = column.key === 'amount' || column.key === 'agentPnl' ? pnlColour(raw) : COLOURS.body;
      doc.fillColor(colour).text(text, x, y + 4, {
        width: column.width - 8,
        align: column.align ?? 'left',
        // One line per cell. A long description that wraps would push every
        // subsequent row out of alignment with the zebra stripes.
        lineBreak: false,
        ellipsis: true,
      });
      x += column.width;
    }

    doc.fillColor(COLOURS.body);
    y += 14;
  });

  doc.y = y + 6;
}

function pageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(COLOURS.muted);
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin, PAGE.height - 30, {
      width: PAGE.width - PAGE.margin * 2,
      align: 'center',
    });
  }
}

module.exports = { renderStatement, inr };
