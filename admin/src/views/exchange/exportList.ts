/**
 * Zip jaisa export: Excel (HTML table ko .xls) aur PDF (jspdf, landscape, title beech me).
 */

/** Excel — zip ka `handleExportExcel`. */
export function exportExcel(fileName: string, head: string[], rows: (string | number)[][]) {
  const th = head.map(c => `<th>${c}</th>`).join('')
  const body = rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></body></html>`
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' })
  const a = document.createElement('a')

  a.href = URL.createObjectURL(blob)
  a.download = `${fileName}.xls`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** PDF — zip ka `handleExportPdf`. */
export async function exportPdf(fileName: string, title: string, head: string[], rows: (string | number)[][]) {
  const { default: JsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new JsPDF('l', 'pt')
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(14)
  doc.setTextColor(51, 51, 51)
  doc.text(title, pageWidth / 2, 30, { align: 'center' })
  autoTable(doc, {
    head: [head],
    body: rows,
    startY: 45,
    theme: 'striped',
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { textColor: [85, 85, 85] }
  })
  doc.save(`${fileName}.pdf`)
}
